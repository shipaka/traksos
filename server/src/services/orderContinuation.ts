import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';
import type { Notifier } from './notify.ts';

type Target = 'tow' | 'sto' | 'master' | 'ecu';
const targetNames: Record<Target,string> = {
 tow:'эвакуатор',sto:'СТО',master:'выездной мастер',ecu:'специалист по ЭБУ',
};
const sensitive = (value:string) => maskPhones(value
 .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email скрыт]')).text.trim();

/**
 * Independent, non-billable advice from an assigned performer.
 * Only the fleet owner can agree to seek another paid performer.
 * This NEVER books/dispatches, creates a payment, or closes the source job.
 */
export class OrderContinuationService {
 constructor(private db:Db,private notifier:Notifier,private now:()=>Date){}
 private async source(q:Queryable,user:AuthUser,orderId:string) {
  // Serialize access with assignment/status changes; lock the actual driver
  // link before using it for either history or durable recipient selection.
  const order=await q.one<any>(
   'select id,client_id,created_by,performer_id,service,status,number,vehicle_id from orders where id=$1 for update',[orderId]);
  if(!order)throw notFound('Исходная заявка не найдена');
  const link=order.created_by && order.created_by!==order.client_id
    ? await q.one<{ok:number}>(`select 1 as ok from users u join vehicles v
        on v.owner_id=u.owner_id and v.driver_id=u.id
        where u.id=$1 and 'driver'=any(u.roles) and u.owner_id=$2
          and ($3::uuid is null or v.id=$3) limit 1 for share of v`,
        [order.created_by,order.client_id,order.vehicle_id])
    : null;
  order.current_driver_link=!!link;
  const owner=order.client_id===user.id && !user.owner_id;
  const origin=order.performer_id===user.id;
  const driver=order.created_by===user.id && user.roles.includes('driver') &&
    user.owner_id===order.client_id && order.current_driver_link===true;
  if(!owner&&!origin&&!driver&&!user.roles.includes('admin'))
   throw forbidden('Нет доступа к продолжению этого обращения');
  return {order,owner,origin,driver};
 }
 // A committed inbox entry was authorized under a row lock. Recheck
 // recipients immediately before optional external delivery as well, so
 // an intervening reassignment does not send a stale push or socket event.
 private async deliver(orderId:string,ids:string[],kind:'customer'|'performer',
   msg:Parameters<Notifier['deliverStored']>[2]) {
  const order=await this.db.one<{client_id:string;created_by:string;performer_id:string|null;status:string;linked:boolean}>(
   `select o.client_id,o.created_by,o.performer_id,o.status,exists (
      select 1 from users u join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
      where u.id=o.created_by and u.owner_id=o.client_id and 'driver'=any(u.roles)
        and (o.vehicle_id is null or v.id=o.vehicle_id)) as linked
     from orders o where o.id=$1`,[orderId]);
  if(!order)return;
  const eligible=ids.filter(id=>kind==='performer'
   ? id===order.performer_id : id===order.client_id||(id===order.created_by&&order.linked));
  await this.notifier.deliverStored(eligible,{type:'order',orderId,status:order.status},msg);
 }
 async list(user:AuthUser,orderId:string) {
  return this.db.tx(async q=>{
   await this.source(q,user,orderId);
   return q.query(
   `select r.id,r.source_order_id,r.target_kind,r.summary,r.status,
     r.created_at,r.decided_at,
     (select id from orders o where o.continuation_recommendation_id=r.id
       order by o.created_at desc limit 1) as next_order_id,
     (select id from service_bookings b where r.target_kind='sto'
       and b.continuation_recommendation_id=r.id
       order by b.created_at desc limit 1) as next_booking_id,
     (select id from ecu_handoffs h where r.target_kind='ecu'
       and h.continuation_recommendation_id=r.id
       order by h.created_at desc limit 1) as next_ecu_handoff_id
    from order_continuation_recommendations r
    where r.source_order_id=$1 order by r.created_at,r.id`,[orderId]);
  });
 }
 async propose(user:AuthUser,orderId:string,target:Target,reason:string) {
  const summary=sensitive(reason);
  if(summary.length<12||summary.length>1000)
   throw bad('bad_summary','Опишите причину продолжения (12–1000 символов)');
  const result=await this.db.tx(async q=>{
  const {order,origin}=await this.source(q,user,orderId);
  if(!origin)throw forbidden('Предложить продолжение может назначенный исполнитель');
  // An assigned tow driver can advise an STO en route, to reserve a future
  // reception slot. Neither advice nor booking implies physical delivery.
  const towToWorkshopInTransit=order.service==='tow' && target==='sto'
   && ['accepted','en_route'].includes(order.status);
  if(!towToWorkshopInTransit && !['arrived','working','awaiting_confirmation','completed'].includes(order.status))
   throw conflict('too_early','Сначала проведите консультацию или осмотрите машину');
  if(target==='master' && order.service!=='consult')
   throw bad('unsupported_transition','Выездного мастера после консультации можно предложить из консультации');
  if(target==='ecu' && order.service==='tow')
   throw bad('unsupported_transition','ЭБУ передают после консультации или технической диагностики');
  if(target==='tow' && order.service==='tow')
   throw bad('unsupported_transition','Повторный эвакуатор требует отдельного обращения');
   const inserted=await q.query<{id:string}>(
    `insert into order_continuation_recommendations
      (source_order_id,client_id,suggested_by,target_kind,summary)
     values($1,$2,$3,$4,$5)
     on conflict(source_order_id,target_kind) do nothing returning id`,
    [orderId,order.client_id,user.id,target,summary]);
   if(inserted.length){
    await q.query(
     "insert into order_events(order_id,actor_id,type,data) values($1,$2,'continuation_recommended',$3)",
     [orderId,user.id,{recommendationId:inserted[0].id,target}]);
    const ids=[...new Set<string>([order.client_id,...(order.current_driver_link && order.created_by!==order.client_id
       ? [order.created_by]:[])].filter((id:string)=>id!==user.id))];
    const msg={kind:'normal' as const,title:'Исполнитель рекомендует продолжить обращение',
     body:`По заявке №${order.number} предложен ${targetNames[target]}. Владелец решает, запускать ли поиск; новая платная заявка ещё не создана.`,
     data:{orderId,recommendationId:inserted[0].id}};
    for(const id of ids)await q.query(
     "insert into notifications(user_id,kind,title,body,data) values($1,'order',$2,$3,$4)",
     [id,msg.title,msg.body,msg.data]);
    return {id:inserted[0].id,created:true,delivery:{ids,msg}};
   }
   const prior=await q.one<{id:string;suggested_by:string;status:string}>(
    'select id,suggested_by,status from order_continuation_recommendations where source_order_id=$1 and target_kind=$2',
    [orderId,target]);
   if(prior?.suggested_by!==user.id)
    throw conflict('already_recommended','Это продолжение уже предложено другим участником');
   return {id:prior.id,created:false,delivery:null};
  });
  if(result.delivery)await this.deliver(orderId,result.delivery.ids,'customer',result.delivery.msg)
   .catch(e=>console.warn('[continuation proposal delivery]',e));
  return {id:result.id,created:result.created};
 }
 async decide(user:AuthUser,orderId:string,recommendationId:string,approve:boolean) {
  const desired=approve?'approved':'declined';
  const result=await this.db.tx(async q=>{
   const {order,owner}=await this.source(q,user,orderId);
   if(!owner)throw forbidden('Следующую платную услугу согласовывает владелец автопарка');
   const r=await q.one<{id:string;status:string;target_kind:Target;suggested_by:string}>(
    'select id,status,target_kind,suggested_by from order_continuation_recommendations where id=$1 and source_order_id=$2 for update',
    [recommendationId,orderId]);
   if(!r)throw notFound('Рекомендация не найдена');
   if(r.status!== 'pending'){
    if(r.status===desired)return null;
    throw conflict('already_decided','Решение уже принято, обновите карточку');
   }
   await q.query(
    'update order_continuation_recommendations set status=$2,decided_by=$3,decided_at=$4 where id=$1',
    [recommendationId,desired,user.id,this.now()]);
   await q.query(
    "insert into order_events(order_id,actor_id,type,data) values($1,$2,'continuation_decided',$3)",
    [orderId,user.id,{recommendationId,approved:approve,target:r.target_kind}]);
   // Historical performers cannot receive new private order events after
   // reassignment. The owner's decision itself remains valid and recorded.
   if(r.suggested_by!==order.performer_id)return null;
   const msg={kind:'normal' as const,title:approve?'Клиент согласовал поиск следующего исполнителя':'Клиент отказался от продолжения',
    body:approve?'Клиент может оформить отдельную связанную заявку с ценой и условиями.':'Текущая заявка остаётся без изменений.',
    data:{orderId,recommendationId}};
   await q.query("insert into notifications(user_id,kind,title,body,data) values($1,'order',$2,$3,$4)",
    [r.suggested_by,msg.title,msg.body,msg.data]);
   return {id:r.suggested_by,msg};
  });
  if(result)await this.deliver(orderId,[result.id],'performer',result.msg)
   .catch(e=>console.warn('[continuation decision delivery]',e));
  return {id:recommendationId,status:desired};
 }
 async validateForOrder(user:AuthUser,recommendationId:string,sourceOrderId:string,service:string){
  const rec=await this.db.one<{client_id:string;status:string;target_kind:Target}>(
   'select client_id,status,target_kind from order_continuation_recommendations where id=$1 and source_order_id=$2',
   [recommendationId,sourceOrderId]);
  if(!rec||rec.client_id!==user.id||user.owner_id||rec.status!=='approved')
   throw forbidden('Сначала подтвердите рекомендацию от имени владельца автопарка');
  if((rec.target_kind==='tow' && service!=='tow')||
     (rec.target_kind==='master' && !['diag','electric','air','autonomy','tyre'].includes(service)))
   throw bad('wrong_next_stage','Рекомендация относится к другому виду помощи');
  if(rec.target_kind==='sto'||rec.target_kind==='ecu')throw bad('specialist_booking_only','СТО и ЭБУ оформляются по собственному защищённому процессу');
 }
}
