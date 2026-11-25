import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import { maskPhones } from '../util.ts';
import { TECHBASE_ILLUSTRATED } from '../domain/techbaseIllustrated.ts';
import { partRefsForCard, samePart } from '../domain/techbasePartRefs.ts';

type Proposal={brand:string;article:string;name:string;qty:number;reason:string;productId?:string|null;cardId?:string|null;fitmentConfirmed:boolean};
const clean=(s:string)=>maskPhones(s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email скрыт]')).text.trim();
const productCols='id,name,brand,article,price,stock,lead_days';
const safeRow=(r:any)=>({id:r.id,source_order_id:r.source_order_id,vehicle_id:r.vehicle_id,
 brand:r.brand,article:r.article,name:r.name,qty:r.qty,reason:r.reason,status:r.status,
 product_id:r.product_id,created_at:r.created_at,decided_at:r.decided_at});
const productView=(p:any)=>({id:p.id,name:p.name,brand:p.brand,article:p.article,price:p.price,stock:p.stock,leadDays:p.lead_days});
export class PartRecommendations {
 constructor(private db:Db,private settings:SettingsService,private notifier:Notifier){}
 private active(user:AuthUser){if(user.status!=='active')throw forbidden();}
 private async approved(user:AuthUser,q:Queryable=this.db){
  this.active(user);
  if(!user.roles.some(x=>x==='master'||x==='service'))throw forbidden('Требуется профиль мастера или СТО');
  const p=await q.one<{verification:string}>('select verification from performer_profiles where user_id=$1',[user.id]);
  if(p?.verification!=='approved')throw forbidden('Требуется подтверждённый профиль');
 }
 private async professional(user:AuthUser){
  this.active(user);
  if(user.roles.some(x=>x==='admin'||x==='moderator'))return;
  await this.approved(user);
 }
 private async context(user:AuthUser,id:string,q:Queryable=this.db,lock=false){
  this.active(user);
  const o=await q.one<any>('select id,client_id,created_by,performer_id,vehicle_id,service,status,number from orders where id=$1'+(lock?' for update':''),[id]);
  if(!o)throw notFound('Заявка не найдена');
  const owner=o.client_id===user.id&&!user.owner_id&&user.roles.includes('client');
  const performer=o.performer_id===user.id;
  const driver=o.created_by===user.id&&user.owner_id===o.client_id&&user.roles.includes('driver');
  const staff=user.roles.some(x=>x==='admin'||x==='moderator');
  if(!owner&&!performer&&!driver&&!staff)throw forbidden('Нет доступа к заявке');
  return {o,owner,performer};
 }
 async refs(user:AuthUser,cardId:string){
  await this.professional(user);
  if(!TECHBASE_ILLUSTRATED.some(x=>x.id===cardId))throw notFound('Карточка не найдена');
  return {refs:partRefsForCard(cardId)};
 }
 async lookup(user:AuthUser,brand:string,article:string){
  await this.professional(user);
  const settings=await this.settings.get('shop');
  if(!settings.enabled)return {enabled:false,products:[]};
  const rows=await this.db.query<any>('select '+productCols+' from shop_products where active and lower(trim(brand))=lower(trim($1)) and lower(trim(article))=lower(trim($2)) order by id limit 21',[brand,article]);
  return {enabled:true,products:rows.slice(0,20).map(productView),ambiguous:rows.length>1};
 }
 async list(user:AuthUser,id:string){
  const c=await this.context(user,id);
  const rows=await this.db.query<any>('select * from part_recommendations where source_order_id=$1 order by created_at desc,id',[id]);
  return {canSuggest:c.performer&&user.roles.some(x=>x==='master'||x==='service')&&c.o.service!=='tow'&&['arrived','working','awaiting_confirmation','completed'].includes(c.o.status),canDecide:c.owner,items:rows.map(safeRow)};
 }
 async propose(user:AuthUser,id:string,p:Proposal){
  const brand=p.brand.trim(),article=p.article.trim(),reason=clean(p.reason),name=clean(p.name);
  if(!p.fitmentConfirmed)throw bad('fitment_required','Сначала подтвердите применимость к машине по маркировке и документации');
  if(!brand||!article||name.length<2||reason.length<12)throw bad('missing_part','Укажите производителя, артикул, название и причину замены');
  if(p.cardId&&!TECHBASE_ILLUSTRATED.some(x=>x.id===p.cardId))throw notFound('Карточка не найдена');
  if(p.cardId&&partRefsForCard(p.cardId).length&&!partRefsForCard(p.cardId).some(ref=>samePart(ref,{brand,article})))throw bad('part_mismatch','Выберите артикул из карточки или предложите деталь отдельно из заявки');
  const result=await this.db.tx(async q=>{
   const {o,performer}=await this.context(user,id,q,true);
   if(!performer||o.service==='tow')throw forbidden('Предложение отправляет назначенный специалист');
   await this.approved(user,q);
   if(!['arrived','working','awaiting_confirmation','completed'].includes(o.status))throw conflict('too_early','Сначала проведите диагностику');
   let product:any=null;
   if(p.productId){
    if(!(await this.settings.get('shop')).enabled)throw conflict('shop_closed','Магазин закрыт; сохраните рекомендацию без товара');
    product=await q.one<any>('select '+productCols+' from shop_products where id=$1 and active for update',[p.productId]);
    if(!product||!product.brand||!product.article||!samePart(product,{brand,article}))throw conflict('part_mismatch','Товар или артикул изменился. Повторите точный поиск');
   }
   const inserted=await q.query<any>(`insert into part_recommendations(source_order_id,client_id,suggested_by,vehicle_id,tech_card_id,product_id,brand,article,name,qty,reason)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing returning *`,
     [id,o.client_id,user.id,o.vehicle_id,p.cardId??null,product?.id??null,brand,article,product?.name??name,p.qty,reason]);
   if(!inserted.length){
    const prior=await q.one<any>('select * from part_recommendations where source_order_id=$1 and lower(trim(brand))=lower(trim($2)) and lower(trim(article))=lower(trim($3))',[id,brand,article]);
    if(!prior)throw conflict('retry','Повторите запрос');
    return {row:prior,created:false,o};
   }
   await q.query("insert into order_events(order_id,actor_id,type,data) values($1,$2,'part_recommended',$3)",[id,user.id,{recommendationId:inserted[0].id}]);
   return {row:inserted[0],created:true,o};
  });
  if(result.created)await this.notifier.notify([result.o.client_id],{type:'order',orderId:id,status:result.o.status},
   {kind:'normal',title:'Мастер предложил замену детали',body:'Рекомендация в заявке. Заказ и оплата не оформлены.',data:{orderId:id}}).catch(()=>{});
  return {created:result.created,item:safeRow(result.row)};
 }
 async decide(user:AuthUser,id:string,recId:string,accept:boolean){
  const status=accept?'accepted':'declined';
  const result=await this.db.tx(async q=>{
   const {owner}=await this.context(user,id,q,true);
   if(!owner)throw forbidden('Решение принимает владелец');
   const row=await q.one<any>('select * from part_recommendations where id=$1 and source_order_id=$2 for update',[recId,id]);
   if(!row)throw notFound();
   if(row.status===status)return row;
   if(row.status!=='pending')throw conflict('already_decided','Решение уже принято');
   const updated=await q.one<any>('update part_recommendations set status=$2,decided_by=$3,decided_at=now() where id=$1 returning *',[recId,status,user.id]);
   await q.query("insert into order_events(order_id,actor_id,type,data) values($1,$2,'part_recommendation_decided',$3)",[id,user.id,{recommendationId:recId,status}]);
   return updated;
  });
  return safeRow(result);
 }
 async history(user:AuthUser,vehicleId:string|null,page:number){
  this.active(user);
  if(user.owner_id||!user.roles.includes('client'))throw forbidden('История рекомендаций доступна владельцу');
  if(vehicleId&&!await this.db.one('select id from vehicles where id=$1 and owner_id=$2',[vehicleId,user.id]))throw forbidden();
  const p=Number.isFinite(page)?Math.max(0,Math.min(1000,Math.floor(page))):0;
  const rows=await this.db.query<any>('select * from part_recommendations where client_id=$1 and ($2::uuid is null or vehicle_id=$2::uuid) order by created_at desc,id limit 21 offset $3',[user.id,vehicleId,p*20]);
  return {items:rows.slice(0,20).map(safeRow),hasMore:rows.length>20};
 }
}
