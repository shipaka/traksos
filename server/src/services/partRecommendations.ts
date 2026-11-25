import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import { maskPhones } from '../util.ts';
import { TECHBASE_ILLUSTRATED } from '../domain/techbaseIllustrated.ts';
import { partRefsForCard, samePart } from '../domain/techbasePartRefs.ts';
import { requireProfessionalTechAccess } from '../domain/techbaseAccess.ts';
import { requirePartActor,requirePartVehicle } from '../domain/partRecommendationAccess.ts';

type Origin='order'|'booking';
const sourceColumn=(origin:Origin)=>origin==='booking'?'source_booking_id':'source_order_id';
const repairStatuses=['arrived','diagnostics','in_work','waiting_part','agreeing','ready'];
const orderStatuses=['arrived','working','awaiting_confirmation','completed'];
type Proposal={brand:string;article:string;name:string;qty:number;reason:string;productId?:string|null;cardId?:string|null;fitmentConfirmed:boolean};
const clean=(s:string)=>maskPhones(s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email скрыт]')).text.trim();
const productCols='id,name,brand,article,price,stock,lead_days,photo_mime,updated_at';
const safeRow=(r:any)=>({id:r.id,source_order_id:r.source_order_id,source_booking_id:r.source_booking_id,vehicle_id:r.vehicle_id,
 brand:r.brand,article:r.article,name:r.name,qty:r.qty,reason:r.reason,status:r.status,
 product_id:r.product_id,created_at:r.created_at,decided_at:r.decided_at,
 sourcing_status:r.sourcing_status,sourcing_requested_at:r.sourcing_requested_at,sourcing_updated_at:r.sourcing_updated_at,sourcing_note:r.sourcing_note});
const productView=(p:any)=>({id:p.id,name:p.name,brand:p.brand,article:p.article,price:p.price,stock:p.stock,leadDays:p.lead_days,inStock:p.stock!=null&&p.stock>0,hasPhoto:!!p.photo_mime,photoVersion:p.updated_at?new Date(p.updated_at).getTime():0});
export class PartRecommendations {
 constructor(private db:Db,private settings:SettingsService,private notifier:Notifier){}
 private active(user:AuthUser){if(user.status!=='active')throw forbidden();}
 private async professional(user:AuthUser){
  await requireProfessionalTechAccess(this.db,user);
 }
 // The source, its actual parties and the current role/assignment must be
 // observed under the same transaction. A historical created_by is not ACL.
 private async context(user:AuthUser,id:string,q:Queryable,write=false,origin:Origin='order'){
  this.active(user);
  const o=origin==='booking'
   ?await q.one<any>('select b.id,b.client_id,b.created_by,b.vehicle_id,b.status,b.number,c.owner_id as performer_id,c.verification as center_verification from service_bookings b join service_centers c on c.id=b.center_id where b.id=$1'+(write?' for update of b,c':' for share of b,c'),[id])
   :await q.one<any>('select id,client_id,created_by,performer_id,vehicle_id,service,status,number from orders where id=$1'+(write?' for update':' for share'),[id]);
  if(!o)throw notFound('Заявка не найдена');
  type Party={id:string;roles:string[];owner_id:string|null;status:string;deleted_at:unknown};
  const parties=await q.query<Party>('select id,roles,owner_id,status,deleted_at from users where id=any($1::uuid[]) order by id for share',[[...new Set([user.id,o.client_id])]]);
  const live=(p:Party|undefined):p is Party=>!!p&&p.status==='active'&&p.deleted_at==null;
  const actor=parties.find(p=>p.id===user.id),client=parties.find(p=>p.id===o.client_id);
  if(!live(actor))throw forbidden();
  const roles=user.roles.filter(r=>actor.roles.includes(r));
  const staff=roles.some(r=>r==='admin'||r==='moderator');
  const liveClient=live(client)&&client.owner_id==null&&client.roles.includes('client');
  const owner=liveClient&&o.client_id===user.id&&!user.owner_id&&!actor.owner_id&&roles.includes('client');
  let driver=false,performer=false;
  if(liveClient&&o.created_by===user.id&&user.owner_id===o.client_id&&actor.owner_id===o.client_id&&roles.includes('driver')){
   // Same current assignment rule as orders; workshop bookings require the
   // actual vehicle, whereas a vehicle-less roadside order needs any live link.
   if(o.vehicle_id||origin==='order'){
    const assigned=await q.one('select id from vehicles where owner_id=$1 and driver_id=$2 and ($3::uuid is null or id=$3) order by id limit 1 for share',[o.client_id,user.id,o.vehicle_id]);
    driver=!!assigned;
   }
  }
  if(liveClient&&o.performer_id===user.id){
   if(origin==='booking')performer=roles.includes('service')&&o.center_verification==='approved';
   else if(roles.includes('master')&&o.service!=='tow'){
    performer=!!await q.one("select user_id from performer_profiles where user_id=$1 and kind in ('master','ecu') and verification='approved' for share",[user.id]);
   }
  }
  if(!owner&&!performer&&!driver&&!staff)throw forbidden('Нет доступа к заявке');
  return {o,owner,performer};
 }
 private canSuggest(c:{o:any;performer:boolean},origin:Origin){
  return c.performer&&(origin==='booking'?repairStatuses:orderStatuses).includes(c.o.status);
 }
 private async recordEvent(q:Queryable,origin:Origin,id:string,userId:string,event:string,data:Record<string,unknown>){
  if(origin==='booking'){
   await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',[userId,'booking.'+event,id,data]);
  }else{
   await q.query('insert into order_events(order_id,actor_id,type,data) values($1,$2,$3,$4)',[id,userId,event,data]);
  }
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
 async list(user:AuthUser,id:string,origin:Origin='order'){
  return this.db.tx(async q=>{
   const c=await this.context(user,id,q,false,origin);
   const rows=await q.query<any>('select * from part_recommendations where '+sourceColumn(origin)+'=$1 order by created_at desc,id',[id]);
   return {canSuggest:this.canSuggest(c,origin),canDecide:c.owner,items:rows.map(safeRow)};
  });
 }
 async propose(user:AuthUser,id:string,p:Proposal,origin:Origin='order'){
  const brand=p.brand.trim(),article=p.article.trim(),reason=clean(p.reason),name=clean(p.name);
  if(!p.fitmentConfirmed)throw bad('fitment_required','Сначала подтвердите применимость к машине по маркировке и документации');
  if(!brand||!article||name.length<2||reason.length<12)throw bad('missing_part','Укажите производителя, артикул, название и причину замены');
  if(p.cardId&&!TECHBASE_ILLUSTRATED.some(x=>x.id===p.cardId))throw notFound('Карточка не найдена');
  if(p.cardId&&partRefsForCard(p.cardId).length&&!partRefsForCard(p.cardId).some(ref=>samePart(ref,{brand,article})))throw bad('part_mismatch','Выберите артикул из карточки или предложите деталь отдельно из заявки');
  const result=await this.db.tx(async q=>{
   const c=await this.context(user,id,q,true,origin),{o,performer}=c;
   if(!performer)throw forbidden('Предложение отправляет назначенный специалист или обслуживающее СТО');
   if(origin==='order'){
    if(o.service==='tow')throw forbidden();
    if(!orderStatuses.includes(o.status))throw conflict('too_early','Сначала проведите диагностику');
   }else{
    if(!repairStatuses.includes(o.status))throw conflict('too_early','Сначала примите автомобиль в ремонт');
   }
   let product:any=null;
   if(p.productId){
    if(!(await this.settings.get('shop')).enabled)throw conflict('shop_closed','Магазин закрыт; сохраните рекомендацию без товара');
    product=await q.one<any>('select '+productCols+' from shop_products where id=$1 and active for update',[p.productId]);
    if(!product||!product.brand||!product.article||!samePart(product,{brand,article}))throw conflict('part_mismatch','Товар или артикул изменился. Повторите точный поиск');
   }
   const inserted=await q.query<any>(`insert into part_recommendations(${sourceColumn(origin)},client_id,suggested_by,vehicle_id,tech_card_id,product_id,brand,article,name,qty,reason)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing returning *`,
     [id,o.client_id,user.id,o.vehicle_id,p.cardId??null,product?.id??null,brand,article,product?.name??name,p.qty,reason]);
   if(!inserted.length){
    const prior=await q.one<any>('select * from part_recommendations where '+sourceColumn(origin)+'=$1 and lower(trim(brand))=lower(trim($2)) and lower(trim(article))=lower(trim($3))',[id,brand,article]);
    if(!prior)throw conflict('retry','Повторите запрос');
    return {row:prior,created:false,o};
   }
   await this.recordEvent(q,origin,id,user.id,'part_recommended',{recommendationId:inserted[0].id});
   return {row:inserted[0],created:true,o};
  });
  if(result.created){const context:Record<string,string>=origin==='booking'?{bookingId:id}:{orderId:id};
   await this.notifier.notify([result.o.client_id],{type:origin,...context,status:result.o.status},
   {kind:'normal',title:origin==='booking'?'СТО предложило замену детали':'Мастер предложил замену детали',body:'Рекомендация в заявке. Заказ и оплата не оформлены.',data:context}).catch(()=>{});}
  return {created:result.created,item:safeRow(result.row)};
 }
 async decide(user:AuthUser,id:string,recId:string,accept:boolean,origin:Origin='order'){
  const status=accept?'accepted':'declined';
  const result=await this.db.tx(async q=>{
   const {owner}=await this.context(user,id,q,true,origin);
   if(!owner)throw forbidden('Решение принимает владелец');
   const row=await q.one<any>('select * from part_recommendations where id=$1 and '+sourceColumn(origin)+'=$2 for update',[recId,id]);
   if(!row)throw notFound();
   if(row.status===status)return row;
   if(row.status!=='pending')throw conflict('already_decided','Решение уже принято');
   const updated=await q.one<any>('update part_recommendations set status=$2,decided_by=$3,decided_at=now() where id=$1 returning *',[recId,status,user.id]);
   await this.recordEvent(q,origin,id,user.id,'part_recommendation_decided',{recommendationId:recId,status});
   return updated;
  });
  if(result.suggested_by)this.notifier.live([result.suggested_by],{type:origin,...(origin==='booking'?{bookingId:id}:{orderId:id}),recommendationId:recId});
  return safeRow(result);
 }
 // The owner's request is a separate, non-billable action, even with the shop closed.
 async requestSourcing(user:AuthUser,id:string){
  const result=await this.db.tx(async q=>{
   await requirePartActor(q,user,'client');
   const row=await q.one<any>('select * from part_recommendations where id=$1 and client_id=$2 for update',[id,user.id]);
   if(!row)throw notFound();
   await requirePartVehicle(q,user.id,row.vehicle_id);
   if(row.status!=='accepted'||row.product_id)throw conflict('sourcing_not_needed','Сначала согласуйте замену; для уже подобранного товара используйте магазин');
   if(row.sourcing_status==='requested')return {row,changed:false};
   if(!['not_requested','unavailable','resolved'].includes(row.sourcing_status))throw conflict('sourcing_status','Запрос недоступен');
   const updated=await q.one<any>(`update part_recommendations set sourcing_status='requested',sourcing_requested_at=now(),
    sourcing_updated_at=now(),sourcing_updated_by=$2,sourcing_note=null where id=$1 returning *`,[id,user.id]);
   await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',[user.id,'part.sourcing_requested',id,{sourceOrderId:row.source_order_id,sourceBookingId:row.source_booking_id}]);
   return {row:updated,changed:true};
  });
  if(result.changed){
   const admins=await this.db.query<{id:string}>("select id from users where status='active' and deleted_at is null and roles && '{admin}'::text[]");
   await this.notifier.notify(admins.map(a=>a.id),{type:'part_sourcing',recommendationId:id},
    {kind:'normal',title:'Новый запрос подбора запчасти',body:'В магазине появился запрос на точный артикул.',data:{recommendationId:id}}).catch(()=>{});
  }
  return {item:safeRow(result.row),changed:result.changed};
 }
 async sourcingQueue(user:AuthUser,page:number,status:'requested'|'resolved'|'unavailable'){
  const shopEnabled=(await this.settings.get('shop')).enabled;
  return this.db.tx(async q=>{
   await requirePartActor(q,user,'admin');
   const rows=await q.query<any>(`select * from part_recommendations where sourcing_status=$1
    order by sourcing_requested_at asc,id limit 21 offset $2`,[status,page*20]);
   return {items:rows.slice(0,20).map(safeRow),hasMore:rows.length>20,shopEnabled};
  });
 }
 async sourcingCandidates(user:AuthUser,id:string){
  return this.db.tx(async q=>{
   await requirePartActor(q,user,'admin');
   const row=await q.one<any>("select brand,article from part_recommendations where id=$1 and sourcing_status='requested' for share",[id]);
  if(!row)throw notFound('Активный запрос не найден');
  // Internal catalogue lookup is permitted while the public storefront is closed.
  const matches=await q.query<any>('select '+productCols+' from shop_products where active and lower(trim(brand))=lower(trim($1)) and lower(trim(article))=lower(trim($2)) order by id limit 21',[row.brand,row.article]);
  return {products:matches.slice(0,20).map(productView),hasMore:matches.length>20};
  });
 }
 async resolveSourcing(user:AuthUser,id:string,input:{status:'resolved'|'unavailable';productId?:string;note?:string}){
  const note=input.note?clean(input.note):null;
  if(input.status==='resolved'&&!input.productId)throw bad('product_required','Выберите точный товар');
  if(input.status==='unavailable'&&(!note||note.length<8||input.productId))throw bad('sourcing_note','Укажите причину отсутствия детали');
  const result=await this.db.tx(async q=>{
   await requirePartActor(q,user,'admin');
   const row=await q.one<any>('select * from part_recommendations where id=$1 for update',[id]);
   if(!row)throw notFound();
   if(row.sourcing_status===input.status&&((input.status==='resolved'&&row.product_id===input.productId)||input.status==='unavailable'))
    return {row,changed:false};
   if(row.status!=='accepted'||row.sourcing_status!=='requested'||row.product_id)throw conflict('sourcing_not_open','Запрос уже обработан или изменился');
   let product:any=null;
   if(input.status==='resolved'){
    product=await q.one<any>('select '+productCols+' from shop_products where id=$1 and active for update',[input.productId]);
    if(!product||!product.brand||!product.article||!samePart(product,row))throw conflict('part_mismatch','Разрешён только точный производитель и артикул, не аналог');
   }
   const updated=await q.one<any>(`update part_recommendations set sourcing_status=$2,product_id=$3,
    sourcing_note=$4,sourcing_updated_at=now(),sourcing_updated_by=$5 where id=$1 returning *`,
    [id,input.status,product?.id??null,note,user.id]);
   await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',[user.id,'part.sourcing_'+input.status,id,{productId:product?.id??null}]);
   return {row:updated,changed:true};
  });
  if(result.changed)await this.notifier.notify([result.row.client_id],{type:'part_sourcing',recommendationId:id,orderId:result.row.source_order_id,bookingId:result.row.source_booking_id},
    {kind:'normal',title:input.status==='resolved'?'Запчасть подобрана':'Результат подбора запчасти',
     body:input.status==='resolved'?'Точный товар привязан к рекомендации. Проверьте актуальную цену в магазине. Заказ не создан.':'Пока не удалось подобрать точную деталь. Подробности в истории рекомендаций.',
     data:{...(result.row.source_booking_id?{bookingId:result.row.source_booking_id}:{orderId:result.row.source_order_id}),recommendationId:id}}).catch(()=>{});
  return {item:safeRow(result.row),changed:result.changed};
 }
 async checkout(user:AuthUser,id:string){
  const enabled=(await this.settings.get('shop')).enabled;
  return this.db.tx(async q=>{
   await requirePartActor(q,user,'client');
   const row=await q.one<any>('select * from part_recommendations where id=$1 and client_id=$2 for share',[id,user.id]);
  if(!row||row.status!=='accepted')throw forbidden('Сначала согласуйте рекомендацию');
  const prior=await q.one<any>('select id,number,status from shop_orders where part_recommendation_id=$1 and client_id=$2 and created_by=$2',[id,user.id]);
  if(prior)return {item:safeRow(row),order:prior,product:null};
  await requirePartVehicle(q,user.id,row.vehicle_id);
  if(!enabled)throw conflict('shop_closed','Магазин закрыт');
  if(!row.product_id)throw conflict('part_unavailable','Точный товар ещё не подобран');
  const product=await q.one<any>('select '+productCols+' from shop_products where id=$1 and active',[row.product_id]);
  if(!product||!product.brand||!product.article||!samePart(product,row))throw conflict('part_mismatch','Товар изменился. Необходимо повторно согласовать подбор');
  return {item:safeRow(row),product:productView(product),order:null};
  });
 }
 async history(user:AuthUser,vehicleId:string|null,page:number){
  return this.db.tx(async q=>{
   await requirePartActor(q,user,'client');
   await requirePartVehicle(q,user.id,vehicleId);
  const p=Number.isFinite(page)?Math.max(0,Math.min(1000,Math.floor(page))):0;
  const rows=await q.query<any>('select * from part_recommendations where client_id=$1 and ($2::uuid is null or vehicle_id=$2::uuid) order by created_at desc,id limit 21 offset $3',[user.id,vehicleId,p*20]);
  return {items:rows.slice(0,20).map(safeRow),hasMore:rows.length>20};
  });
 }
}
