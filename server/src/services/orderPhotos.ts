/**
 * Repair-evidence photos are always attached to a real order. Encrypted at
 * rest, authenticated on every read, and never sent to a third-party host.
 * A preview APK has no API session and cannot call these methods.
 */
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';
import type { OrdersService } from './orders.ts';
import { config } from '../config.ts';

const MAX_BYTES = 1_400_000;
const MAX_PER_ORDER = 12;
const ALLOWED = new Set(['image/jpeg','image/png','image/webp']);
const key = () => createHash('sha256').update('traksos-order-photos:' + config.secret).digest();

const asBuffer = (data: unknown): Buffer => {
  if(Buffer.isBuffer(data))return data;
  if(typeof data === 'string' && data.startsWith('\\x'))
    return Buffer.from(data.slice(2),'hex');
  throw new Error('Unknown PostgreSQL bytea encoding');
};
const bytea = (buf: Buffer) => '\\x' + buf.toString('hex');
const sniff = (mime: string, bytes: Buffer): boolean => {
  if(mime==='image/jpeg')return bytes.length>3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
  if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if(mime==='image/webp')return bytes.length>=12 &&
    bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  return false;
};

export class OrderPhotosService {
  constructor(private db: Db, private orders: OrdersService) {}

  private async orderForParticipant(user: AuthUser, orderId: string) {
    const order=await this.orders.mustSee(user,orderId);
    // A ringing or bidding candidate may know orderId but must not see images.
    if(!this.orders.actorOf(user,order))throw forbidden();
    return order;
  }

  async upload(user: AuthUser, orderId: string, dataUrl: string) {
    const order=await this.orderForParticipant(user,orderId);
    if(this.orders.actorOf(user,order)!=='performer')
      throw forbidden('Добавлять фото ремонта может только назначенный исполнитель');
    const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if(!match || !ALLOWED.has(match[1]))throw bad('bad_image','Нужна фотография JPEG, PNG или WEBP');
    const decoded=Buffer.from(match[2],'base64');
    if(decoded.length<1_000 || !sniff(match[1],decoded))throw bad('bad_image','Некорректный файл изображения');
    if(decoded.length>MAX_BYTES)throw bad('too_large','Фото слишком большое — уменьшите его');
    const sha=createHash('sha256').update(decoded).digest('hex');
    const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',key(),iv);
    const ciphertext=Buffer.concat([cipher.update(decoded),cipher.final()]);
    const tag=cipher.getAuthTag();
    return this.db.tx(async tx=>{
      // Lock the authoritative order before counting or accepting evidence.
      const current=await tx.one<any>('select * from orders where id=$1 for update',[orderId]);
      if(!current || current.performer_id!==user.id)
        throw forbidden('Эта заявка не назначена вам');
      if(['completed','cancelled','no_performer'].includes(current.status))
        throw conflict('order_closed','Завершённая заявка доступна только для просмотра');
      const count=await tx.one<{n:number}>('select count(*)::int as n from order_photos where order_id=$1',[orderId]);
      if(Number(count?.n??0)>=MAX_PER_ORDER)throw conflict('photos_limit','Не больше 12 фотографий на заявку');
      const photo=await tx.one<any>(
        `insert into order_photos(order_id,uploader_id,mime,size_bytes,sha256,iv,tag,ciphertext)
         values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(order_id,uploader_id,sha256) do nothing
         returning id,created_at`,
        [orderId,user.id,match[1],decoded.length,sha,bytea(iv),bytea(tag),bytea(ciphertext)]);
      if(photo)return {id:photo.id,createdAt:photo.created_at,duplicate:false};
      const existing=await tx.one<any>(
        'select id,created_at from order_photos where order_id=$1 and uploader_id=$2 and sha256=$3',
        [orderId,user.id,sha]);
      return {id:existing?.id,createdAt:existing?.created_at,duplicate:true};
    });
  }

  async list(user: AuthUser, orderId: string) {
    await this.orderForParticipant(user,orderId);
    return this.db.query(
      `select p.id,p.mime,p.size_bytes,p.created_at,u.name as uploader_name
         from order_photos p join users u on u.id=p.uploader_id
        where p.order_id=$1 order by p.created_at desc limit 12`,[orderId]);
  }

  async file(user: AuthUser, orderId: string, photoId: string) {
    await this.orderForParticipant(user,orderId);
    const row=await this.db.one<any>(
      'select * from order_photos where id=$1 and order_id=$2',[photoId,orderId]);
    if(!row)throw notFound('Фотография не найдена');
    const decipher=createDecipheriv('aes-256-gcm',key(),asBuffer(row.iv));
    decipher.setAuthTag(asBuffer(row.tag));
    const body=Buffer.concat([decipher.update(asBuffer(row.ciphertext)),decipher.final()]);
    if(!sniff(row.mime,body))throw bad('bad_image','Файл повреждён');
    return {mime:row.mime as string,body};
  }
}
