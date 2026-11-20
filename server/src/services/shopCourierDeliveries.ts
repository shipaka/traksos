/** Courier handoff for actual shop orders.
 * No fabricated deliveries, GPS tracking, unmasked phone numbers or silent
 * completion. All transitions are locked in PostgreSQL and audited.
 */
import type {Db} from '../db/index.ts';
import type {Notifier} from './notify.ts';
import type {AuthUser} from '../http/router.ts';
import {bad,conflict,forbidden,notFound,HttpError} from '../http/router.ts';
import {hmac} from '../util.ts';

type Stage='assigned'|'picked_up'|'en_route'|'arrived'|'code_verified'|'received'|'cancelled';
const NEXT:Record<string,string>={
  assigned:'picked_up',picked_up:'en_route',en_route:'arrived'
};
const ACTIVE=['assigned','picked_up','en_route','arrived','code_verified'];
function receiptCode(id:string,nonce:string):string {
  // Derived from a secret key and rotating random nonce: the six digits are
  // never stored in plaintext or returned to the courier.
  const digest=hmac('shop-courier-v1:'+id+':'+nonce);
  return String(Number(BigInt('0x'+digest.slice(0,12))%1000000n)).padStart(6,'0');
}
export function receiptCodeEquals(id:string,nonce:string,code:string):boolean {
  return /^\d{6}$/.test(code)&&receiptCode(id,nonce)===code;
}
export function courierNextStage(status:string):string|null{
  return NEXT[status]||null;
}
export class ShopCourierDeliveries {
  constructor(private db:Db,private notify:Notifier) {}
  async presence(courier:AuthUser){
    const row=await this.db.one<{online:boolean;updated_at:Date}>(
      'select online,updated_at from shop_courier_presence where courier_id=$1',
      [courier.id]);
    return {online:row?.online??false,updatedAt:row?.updated_at??null};
  }
  async setPresence(courier:AuthUser,online:boolean){
    const row=await this.db.one<{online:boolean;updated_at:Date}>(`
      insert into shop_courier_presence(courier_id,online) values ($1,$2)
      on conflict(courier_id) do update set online=excluded.online,updated_at=now()
      returning online,updated_at`,[courier.id,online]);
    await this.db.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
      [courier.id,'courier.availability',courier.id,{online}]);
    return {online:row!.online,updatedAt:row!.updated_at};
  }
  async candidates(){
    return this.db.query<{id:string;name:string|null}>(
      `select id,name from users where 'courier'=any(roles) and status='active'
         order by name nulls last,id limit 200`);
  }
  private view(d:any){
    return {
      id:d.id,shopOrderId:d.shop_order_id,orderNumber:d.order_number,
      status:d.status,items:d.items,deliveryAddress:d.address,
      vehicle:d.vehicle_snapshot??null,
      updatedAt:d.updated_at,assignedAt:d.created_at,
      codeVerified:d.code_verified_at!==null,
      receivedAt:d.received_at,codeAttemptsRemaining:Math.max(0,5-d.code_attempts),
      // No client phone, no receipt code and no fabricated route or ETA.
    };
  }
  async assign(actor:AuthUser,orderId:string,courierId:string){
    const row=await this.db.tx(async q=>{
      const o=await q.one<any>('select * from shop_orders where id=$1 for update',[orderId]);
      if(!o)throw notFound('Заказ магазина не найден');
      if(o.delivery!=='delivery'||o.status!=='ready'||!o.address)
        throw conflict('delivery_unavailable','Назначение возможно только для собранного заказа с адресной доставкой');
      const courier=await q.one<{id:string}>(
        `select id from users where id=$1 and 'courier'=any(roles) and status='active'`,[courierId]);
      if(!courier)throw bad('invalid_courier','Выберите активного курьера TrakSOS');
      const old=await q.one<{id:string;status:Stage}>(
        'select id,status from shop_courier_deliveries where shop_order_id=$1 for update',[orderId]);
      if(old&&old.status!=='assigned')
        throw conflict('already_in_progress','Маршрут уже начат. Для изменения курьера требуется отдельное разбирательство.');
      const d=old
        ?await q.one<any>(`update shop_courier_deliveries set courier_id=$2,assigned_by=$3,
            code_nonce=gen_random_uuid(),code_attempts=0,code_verified_at=null,
            code_expires_at=now()+interval '24 hours',updated_at=now()
            where id=$1 returning *`,[old.id,courierId,actor.id])
        :await q.one<any>(`insert into shop_courier_deliveries
            (shop_order_id,courier_id,assigned_by) values ($1,$2,$3) returning *`,
            [orderId,courierId,actor.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id,'courier.assign',d.id,{shopOrderId:orderId,courierId}]);
      return d;
    });
    await this.notify.notify([courierId],{type:'shop',shopOrderId:orderId},
      {kind:'normal',title:'Назначена доставка запчастей',
       body:'Откройте новый рейс в кабинете курьера',data:{shopOrderId:orderId}});
    return {id:row.id,shopOrderId:orderId,status:row.status};
  }
  async list(courier:AuthUser){
    const rows=await this.db.query<any>(
      `select d.*,o.number as order_number,o.items,o.address,o.vehicle_snapshot
         from shop_courier_deliveries d
         join shop_orders o on o.id=d.shop_order_id
        where d.courier_id=$1 order by
          case when d.status in ('received','cancelled') then 1 else 0 end,
          d.updated_at desc limit 100`,[courier.id]);
    return rows.map(d=>this.view(d));
  }
  async one(courier:AuthUser,id:string){
    const d=await this.db.one<any>(
      `select d.*,o.number as order_number,o.items,o.address,o.vehicle_snapshot
         from shop_courier_deliveries d
         join shop_orders o on o.id=d.shop_order_id
        where d.id=$1 and d.courier_id=$2`,[id,courier.id]);
    if(!d)throw notFound('Доставка не назначена этому курьеру');
    return this.view(d);
  }
  async progress(courier:AuthUser,id:string,status:Stage){
    const d=await this.db.tx(async q=>{
      const d=await q.one<any>(
        `select d.*,o.status as shop_status,o.client_id,o.created_by
         from shop_courier_deliveries d join shop_orders o on o.id=d.shop_order_id
        where d.id=$1 and d.courier_id=$2 for update of d,o`,[id,courier.id]);
      if(!d)throw notFound('Доставка не назначена этому курьеру');
      if(d.status===status)return {...d,unchanged:true}; // idempotent network retry
      if(courierNextStage(d.status)!==status)
        throw conflict('invalid_stage','Нельзя пропускать или откатывать этапы доставки');
      if(d.shop_status==='cancelled'||d.shop_status==='done')
        throw conflict('order_closed','Заказ магазина уже закрыт');
      const row=await q.one<any>(
        'update shop_courier_deliveries set status=$2,updated_at=now() where id=$1 returning *',
        [id,status]);
      if(status==='picked_up')await q.query(
        `update shop_orders set status='shipped',updated_at=now() where id=$1 and status='ready'`,
        [d.shop_order_id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [courier.id,'courier.stage',id,{status,shopOrderId:d.shop_order_id}]);
      return {...row,client_id:d.client_id,created_by:d.created_by};
    });
    if(!d.unchanged)await this.notify.notify([d.client_id,d.created_by],{type:'shop',shopOrderId:d.shop_order_id},
      {kind:'normal',title:'Доставка запчастей: новый этап',body:status==='arrived'?
        'Курьер прибыл — откройте заказ и покажите ему код получения':'Статус доставки обновлён',
        data:{shopOrderId:d.shop_order_id}});
    return this.one(courier,id);
  }
  async verify(courier:AuthUser,id:string,code:string){
    const result=await this.db.tx(async q=>{
      const d=await q.one<any>(`select d.*,o.status as shop_status,o.client_id,o.created_by
        from shop_courier_deliveries d join shop_orders o on o.id=d.shop_order_id
        where d.id=$1 and d.courier_id=$2 for update of d,o`,[id,courier.id]);
      if(!d)throw notFound('Доставка не назначена этому курьеру');
      if(d.status==='code_verified')return {ok:true,d,repeated:true};
      if(d.status!=='arrived'||d.shop_status!=='shipped')
        throw conflict('invalid_stage','Код можно проверить только после прибытия по открытой доставке');
      if(d.code_attempts>=5)throw new HttpError(429,'receipt_locked','Лимит попыток исчерпан. Обратитесь к администратору.');
      if(new Date(d.code_expires_at).getTime()<Date.now())
        throw conflict('receipt_expired','Код получения устарел. Нужна повторная выдача.');
      if(!receiptCodeEquals(d.id,d.code_nonce,code)){
        await q.query(`update shop_courier_deliveries set code_attempts=code_attempts+1,
          updated_at=now() where id=$1`,[id]);
        await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
          [courier.id,'courier.code_rejected',id,{attempt:d.code_attempts+1}]);
        // Return so attempts COMMIT instead of rolling back on a thrown error.
        return {ok:false,d};
      }
      const checked=await q.one<any>(`update shop_courier_deliveries
        set status='code_verified',code_verified_at=now(),updated_at=now()
        where id=$1 returning *`,[id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [courier.id,'courier.code_verified',id,{shopOrderId:d.shop_order_id}]);
      return {ok:true,d:{...checked,client_id:d.client_id,created_by:d.created_by}};
    });
    if(!result.ok)throw bad('wrong_receipt_code','Код не совпадает. Проверьте шесть цифр с получателем.');
    if(!('repeated' in result))await this.notify.notify([result.d.client_id,result.d.created_by],
      {type:'shop',shopOrderId:result.d.shop_order_id},
      {kind:'normal',title:'Подтвердите получение запчастей',
       body:'Курьер проверил код. Заказ завершится только после вашего подтверждения.',
       data:{shopOrderId:result.d.shop_order_id}});
    return this.one(courier,id);
  }
  /** Support-only receipt-code recovery after expiry or five failed attempts.
   * Never return the new code to administrator or courier. Every reset requires
   * a reason and is limited to three per shipment to avoid brute-force churn.
   */
  async resetReceipt(actor:AuthUser,orderId:string,reason:string){
    const result=await this.db.tx(async q=>{
      const o=await q.one<{id:string;created_by:string;status:string}>(
        'select id,created_by,status from shop_orders where id=$1 for update',[orderId]);
      if(!o)throw notFound('Заказ магазина не найден');
      const delivery=await q.one<any>(
        'select * from shop_courier_deliveries where shop_order_id=$1 for update',[orderId]);
      if(!delivery)throw notFound('Курьерская доставка для заказа не назначена');
      if(delivery.status!=='arrived'||o.status!=='shipped')
        throw conflict('receipt_reset_unavailable','Восстановить код можно только после прибытия курьера');
      if(delivery.code_attempts<5&&new Date(delivery.code_expires_at).getTime()>=Date.now())
        throw conflict('receipt_still_valid','Текущий код ещё действует и не заблокирован');
      if(delivery.code_resets>=3)
        throw conflict('receipt_reset_limit','Лимит восстановления исчерпан. Требуется разбирательство.');
      const updated=await q.one<any>(`update shop_courier_deliveries set
         code_nonce=gen_random_uuid(),code_attempts=0,code_resets=code_resets+1,
         code_expires_at=now()+interval '24 hours',code_verified_at=null,
         updated_at=now() where id=$1 returning *`,[delivery.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id,'courier.receipt_code_reset',delivery.id,{
          shopOrderId:orderId,reason,previousAttempts:delivery.code_attempts,
          resetCount:updated.code_resets
        }]);
      return {customer:o.created_by,id:delivery.id,expiresAt:updated.code_expires_at,
        resetCount:updated.code_resets};
    });
    await this.notify.notify([result.customer],{type:'shop',shopOrderId:orderId},{
      kind:'normal',title:'Для доставки обновлён код вручения',
      body:'Откройте историю покупки. Показывайте новый код только прибывшему курьеру.',
      data:{shopOrderId:orderId}
    });
    return {shopOrderId:orderId,expiresAt:result.expiresAt,
      resetCount:result.resetCount,codeReissued:true};
  }
  /** Only the authenticated user who actually placed the shop order may
   * reveal its receipt code or confirm receipt. A fleet owner must not
   * confirm a driver's parcel merely by owning the company. */
  async receiptCode(buyer:AuthUser,orderId:string){
    const d=await this.db.one<any>(`select d.*,o.client_id,o.created_by,o.status as shop_status
      from shop_courier_deliveries d join shop_orders o on o.id=d.shop_order_id
      where o.id=$1 and o.created_by=$2`,[orderId,buyer.id]);
    if(!d)throw notFound('Код для этого заказа недоступен');
    if(!ACTIVE.includes(d.status)||d.shop_status==='cancelled')
      throw conflict('no_active_delivery','Доставка сейчас не ожидает вручения');
    if(new Date(d.code_expires_at).getTime()<Date.now())
      throw conflict('receipt_expired','Код получения устарел. Обратитесь в поддержку.');
    return {shopOrderId:orderId,code:receiptCode(d.id,d.code_nonce),
      expiresAt:d.code_expires_at,verified:d.code_verified_at!==null,
      buyerConfirmationRequired:true};
  }
  async confirmReceived(buyer:AuthUser,orderId:string){
    const d=await this.db.tx(async q=>{
      const d=await q.one<any>(`select d.*,o.client_id,o.created_by,o.status as shop_status
        from shop_courier_deliveries d join shop_orders o on o.id=d.shop_order_id
       where o.id=$1 and o.created_by=$2 for update of d,o`,
       [orderId,buyer.id]);
      if(!d)throw notFound('Заказ не найден в ваших доставках');
      if(d.status==='received')return {...d,repeated:true}; // repeat request cannot double-close
      if(d.status!=='code_verified'||!d.code_verified_at||d.shop_status!=='shipped')
        throw conflict('not_verified','Сначала курьер должен прибыть и проверить код вручения');
      await q.query(`update shop_courier_deliveries set status='received',
        received_at=now(),updated_at=now() where id=$1`,[d.id]);
      await q.query(`update shop_orders set status='done',updated_at=now() where id=$1`,
        [d.shop_order_id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [buyer.id,'courier.customer_received',d.id,{shopOrderId:orderId}]);
      return {...d,status:'received'};
    });
    if(!d.repeated)await this.notify.notify([d.courier_id],{type:'shop',shopOrderId:orderId},
      {kind:'normal',title:'Получение подтверждено клиентом',
       body:'Доставка завершена. Заказ отмечен полученным покупателем.',
       data:{shopOrderId:orderId}});
    return {shopOrderId:orderId,status:'received',customerConfirmed:true};
  }
}
