import type { Db } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';
import type { Notifier } from './notify.ts';

const safe = (v:string) => maskPhones(v
 .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email скрыт]')
 .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi,'[VIN скрыт]')
 .replace(/[АВЕКМНОРСТУХABEKMHOPCTYX]\s?\d{3}\s?[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\s?\d{2,3}/gi,'[госномер скрыт]')
).text.trim();
const repairServices = new Set(['electric','diag','air','autonomy','tyre','consult']);
type Handoff = {
 id:string;root_order_id:string;source_order_id:string;client_id:string;
 created_by:string;summary:string;state:string;selected_performer_id:string|null;
 selected_quote_id:string|null;selected_at:Date|null;created_at:Date;
 service:string;source_number:number;source_performer_id:string|null;
 source_created_by:string;number:number;
 brand:string|null;model:string|null;year:number|null;vehicle_id:string|null;
};
type Access = 'owner'|'driver'|'origin'|'expert'|'candidate'|'admin';

export class EcuHandoffService {
 constructor(private db:Db,private notifier:Notifier,private now:()=>Date){}
 private async verified(id:string){
  return this.db.one<{performer_id:string;public_name:string;address:string}>(
   "select s.performer_id,s.public_name,s.address from ecu_stations s" +
   " join performer_profiles p on p.user_id=s.performer_id" +
   " join users u on u.id=p.user_id where s.performer_id=$1" +
   " and s.approved_at is not null and p.kind='ecu'" +
   " and p.verification='approved' and u.status='active'",[id]);
 }
 async station(user:AuthUser){
  const p=await this.db.one<{kind:string;verification:string}>(
   'select kind,verification from performer_profiles where user_id=$1',[user.id]);
  if(p?.kind!=='ecu')throw forbidden('Нужен профиль специалиста ЭБУ');
  const station=await this.db.one(
   'select public_name,address,approved_at,updated_at from ecu_stations where performer_id=$1',[user.id]);
  return {station,profileVerification:p.verification};
 }
 async saveStation(user:AuthUser,publicName:string,address:string){
  const p=await this.db.one<{kind:string}>(
   'select kind from performer_profiles where user_id=$1',[user.id]);
  if(p?.kind!=='ecu')throw forbidden('Нужен профиль специалиста ЭБУ');
  await this.db.query(
   'insert into ecu_stations(performer_id,public_name,address) values($1,$2,$3)' +
   ' on conflict(performer_id) do update set public_name=excluded.public_name,' +
   ' address=excluded.address,approved_by=null,approved_at=null,updated_at=$4',
   [user.id,publicName.trim(),address.trim(),this.now()]);
  return this.station(user);
 }
 async stationQueue(){
  return this.db.query(
   'select s.performer_id,s.public_name,s.address,s.approved_at,s.updated_at,' +
   ' p.verification,u.name from ecu_stations s' +
   ' join performer_profiles p on p.user_id=s.performer_id' +
   ' join users u on u.id=s.performer_id order by (s.approved_at is null) desc,s.updated_at desc limit 200');
 }
 async verifyStation(admin:AuthUser,performerId:string,approved:boolean){
  return this.db.tx(async q=>{
   const station=await q.one<{verification:string}>(
    "select p.verification from ecu_stations s join performer_profiles p on p.user_id=s.performer_id" +
    " where s.performer_id=$1 and p.kind='ecu' for update",[performerId]);
   if(!station)throw notFound('Стационарная точка не найдена');
   if(approved && station.verification!=='approved')
    throw conflict('profile_pending','Сначала проверьте документы специалиста');
   await q.query(
    'update ecu_stations set approved_by=$2,approved_at=$3,updated_at=$4 where performer_id=$1',
    [performerId,admin.id,approved?this.now():null,this.now()]);
   await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
    [admin.id,'ecu.station_verify',performerId,{approved}]);
   return {ok:true,approved};
  });
 }

 async open(user:AuthUser,sourceOrderId:string,note:string,recommendationId?:string){
  const source=await this.db.one<any>('select * from orders where id=$1',[sourceOrderId]);
  if(!source)throw notFound('Исходная заявка не найдена');
  if(!repairServices.has(source.service))
   throw bad('unsupported_handoff','Передача ЭБУ возможна после консультации или диагностики, но не из эвакуации и страховки');
  const origin=source.performer_id===user.id;
  const owner=source.client_id===user.id && user.roles.includes('client');
  if(!owner&&!origin)throw forbidden('Передачу создаёт участник диагностики или владелец');
  if(origin && (source.service==='consult'
   ? !['awaiting_confirmation','completed'].includes(source.status)
   : !['arrived','working','awaiting_confirmation','completed'].includes(source.status)))
   throw conflict('not_diagnosed','Сначала зафиксируйте работу или завершите консультацию');
  if(owner && !['awaiting_confirmation','completed'].includes(source.status))
   throw conflict('not_diagnosed','Для передачи нужно заключение специалиста');
  // A direct free technical handoff by the assigned performer remains allowed.
  // Only an explicit owner action may consume an approved recommendation.
  if(recommendationId){
   if(!owner || user.owner_id)
    throw forbidden('Рекомендацию ЭБУ подтверждает только владелец автопарка');
   const rec=await this.db.one<{id:string}>(
    "select id from order_continuation_recommendations where id=$1" +
    " and source_order_id=$2 and client_id=$3 and target_kind='ecu'" +
    " and status='approved'",[recommendationId,sourceOrderId,user.id]);
   if(!rec)throw forbidden('Сначала согласуйте рекомендацию ЭБУ');
  }
  const clean=safe(note);
  if(clean.length<10)throw bad('need_summary','Напишите техническое заключение (от 10 символов)');
  const root=source.case_root_id??source.id;
  const created=await this.db.tx(async q=>{
   await q.query('select pg_advisory_xact_lock(hashtext($1))',['ecu-case:'+root]);
   const fromSameSource=await q.one<{
    id:string;continuation_recommendation_id:string|null;state:string
   }>('select id,continuation_recommendation_id,state from ecu_handoffs where source_order_id=$1',
    [sourceOrderId]);
   if(fromSameSource){
    if(recommendationId && fromSameSource.continuation_recommendation_id!==recommendationId){
     if(fromSameSource.continuation_recommendation_id)
      throw conflict('recommendation_already_used','Передача уже связана с другим согласием');
     if(fromSameSource.state==='closed')
      throw conflict('handoff_closed','Эта техническая передача уже закрыта');
     // The owner explicitly attaches an existing free handoff to their
     // approved advice; the old record itself is not duplicated or charged.
     await q.query('update ecu_handoffs set continuation_recommendation_id=$2 where id=$1',
      [fromSameSource.id,recommendationId]);
     await q.query(
      "insert into order_events(order_id,actor_id,type,data) values($1,$2,'ecu_handoff_recommendation_linked',$3)",
      [sourceOrderId,user.id,{handoffId:fromSameSource.id,recommendationId}]);
    }
    return {id:fromSameSource.id,isNew:false};
   }
   const previous=await q.one<{id:string;source_order_id:string}>(
    "select id,source_order_id from ecu_handoffs where root_order_id=$1 and state in ('pending','selected')",[root]);
   if(previous){
    if(previous.source_order_id===sourceOrderId)return {id:previous.id,isNew:false};
    throw conflict('handoff_exists','По этому обращению уже создана передача ремонтникам ЭБУ');
   }
   const row=await q.one<{id:string}>(
    'insert into ecu_handoffs(root_order_id,source_order_id,client_id,created_by,summary,continuation_recommendation_id)' +
    ' values($1,$2,$3,$4,$5,$6) returning id',
    [root,sourceOrderId,source.client_id,user.id,clean,recommendationId??null]);
   await q.query("insert into order_events(order_id,actor_id,type,data) values($1,$2,'ecu_handoff_created',$3)",
    [sourceOrderId,user.id,{handoffId:row!.id}]);
   return {id:row!.id,isNew:true};
  });
  if(created.isNew){
   await this.notifier.notify([source.client_id,source.created_by].filter(id=>id!==user.id),
    {type:'ecu_handoff',handoffId:created.id,orderId:sourceOrderId},
    {kind:'normal',title:'Заключение направлено специалистам ЭБУ',
     body:'Передано техническое заключение без оплаты. Предложения по диагностике согласуются отдельно.',
     data:{handoffId:created.id,orderId:sourceOrderId}}).catch(()=>{});
   const specialists=await this.db.query<{performer_id:string}>(
    "select s.performer_id from ecu_stations s join performer_profiles p on p.user_id=s.performer_id" +
    " join users u on u.id=s.performer_id where s.approved_at is not null" +
    " and p.kind='ecu' and p.verification='approved' and u.status='active' limit 200");
   await this.notifier.notify(specialists.map(x=>x.performer_id),
    {type:'ecu_handoff',handoffId:created.id},
    {kind:'normal',title:'Новая передача ЭБУ',
     body:'Получено заключение из цепочки обращения. Можно предложить стоимость диагностики.',
     data:{handoffId:created.id}}).catch(()=>{});
  }
  return {id:created.id,created:created.isNew};
 }

 async byOrder(user:AuthUser,orderId:string){
  const source=await this.db.one<any>(
   'select client_id,created_by,performer_id,case_root_id from orders where id=$1',[orderId]);
  if(!source)throw notFound('Заявка не найдена');
  if(![source.client_id,source.created_by,source.performer_id].includes(user.id)
    && !user.roles.includes('admin'))throw forbidden();
  return this.db.one(
   'select id,source_order_id,state,created_at,selected_at from ecu_handoffs' +
   ' where root_order_id=$1 order by created_at desc limit 1',[source.case_root_id??orderId]);
 }
 async inbox(user:AuthUser){
  if(!await this.verified(user.id))return [];
  return this.db.query(
   "select h.id,h.summary,h.created_at,h.state,o.number as source_number," +
   " o.brand,o.model,o.year,o.service from ecu_handoffs h join orders o on o.id=h.source_order_id" +
   " where h.state='pending' or (h.state in ('selected','closed') and h.selected_performer_id=$1)" +
   ' order by h.created_at desc limit 100',[user.id]);
 }
 private async access(user:AuthUser,id:string):Promise<{h:Handoff;actor:Access}>{
  const h=await this.db.one<Handoff>(
   'select h.*,o.service,o.number as source_number,o.performer_id as source_performer_id,' +
   ' o.created_by as source_created_by,' +
   ' o.brand,o.model,o.year,o.vehicle_id from ecu_handoffs h' +
   ' join orders o on o.id=h.source_order_id where h.id=$1',[id]);
  if(!h)throw notFound('Передача не найдена');
  if(user.roles.includes('admin'))return{h,actor:'admin'};
  if(user.id===h.client_id)return{h,actor:'owner'};
  if(user.id===h.source_created_by && user.owner_id===h.client_id)return{h,actor:'driver'};
  if(user.id===h.source_performer_id)return{h,actor:'origin'};
  if(['selected','closed'].includes(h.state) && h.selected_performer_id===user.id && user.roles.includes('master'))
   return{h,actor:'expert'}; // historical selected cases stay readable if station verification lapses
  if(await this.verified(user.id)){
   if(h.state==='pending')return{h,actor:'candidate'};
  }
  throw forbidden('Нет доступа к передаче');
 }
 async detail(user:AuthUser,id:string){
  const {h,actor}=await this.access(user,id);
  const full=actor!=='candidate';
  const [quotes,history,workshops,notes,station,vin]=await Promise.all([
   full ? this.db.query(
    'select q.id,q.performer_id,q.diagnosis_price,q.explanation,q.version,q.updated_at,'+
    's.public_name,s.address from ecu_quotes q join ecu_stations s on s.performer_id=q.performer_id'+
    ' where q.handoff_id=$1 order by q.updated_at desc',[id])
    : this.db.query(
    'select id,performer_id,diagnosis_price,explanation,version,updated_at from ecu_quotes'+
    ' where handoff_id=$1 and performer_id=$2',[id,user.id]),
   full ? this.db.query(
    'select o.id,o.number,o.service,o.status,o.description,o.result,o.result_note,o.consult_hint,'+
    'o.created_at,o.completed_at,u.name as performer_name from orders o'+
    ' left join users u on u.id=o.performer_id where o.id=$1 or o.case_root_id=$1'+
    ' order by o.created_at,o.number',[h.root_order_id]) : Promise.resolve([]),
   // The shop publishes only technical notes explicitly marked public.
   // Internal notes, customer details, chats and financials are never shared.
   full ? this.db.query(
    'select b.id,b.number,b.need,b.status,b.comment,b.works,b.notes,b.notes_public,'+
    'b.created_at,b.closed_at,c.name as center_name from service_bookings b'+
    ' join service_centers c on c.id=b.center_id where b.case_root_id=$1'+
    ' order by b.created_at,b.number',[h.root_order_id]) : Promise.resolve([]),
   full ? this.db.query(
    'select n.id,n.body,n.created_at,u.name as author_name from ecu_handoff_notes n'+
    ' join users u on u.id=n.author_id where n.handoff_id=$1 order by n.id',[id]) : Promise.resolve([]),
   full && h.selected_performer_id ? this.db.one(
    'select public_name,address from ecu_stations where performer_id=$1',[h.selected_performer_id])
    : Promise.resolve(null),
   full && h.vehicle_id && ['owner','driver','expert','admin'].includes(actor)
    ? this.db.one<{vin:string|null}>(
      'select vin from vehicles where id=$1 and owner_id=$2',[h.vehicle_id,h.client_id])
    : Promise.resolve(null),
  ]);
  return {
   id:h.id,number:h.number,rootOrderId:h.root_order_id,sourceOrderId:h.source_order_id,
   sourceNumber:h.source_number,sourceService:h.service,
   summary:safe(h.summary),state:h.state,actor,
   vehicle:{brand:h.brand,model:h.model,year:h.year,vin:vin?.vin??null},
   history:history.map((r:any)=>({
    id:r.id,number:r.number,service:r.service,status:r.status,
    description:safe(r.description??''),result:r.result,
    resultNote:safe(r.result_note??''),
    consultHint:r.consult_hint?{hints:r.consult_hint.hints,confidence:r.consult_hint.confidence,
      note:safe(r.consult_hint.note??'')}:null,
    performerName:r.performer_name??'Не назначен',
    createdAt:r.created_at,completedAt:r.completed_at,
   })),
   workshops:workshops.map((b:any)=>({
    id:b.id,number:b.number,kind:'sto',status:b.status,need:b.need,
    centerName:b.center_name,comment:safe(b.comment??''),
    works:Array.isArray(b.works)?b.works.map((v:any)=>safe(String(v))):[],
    publicNotes:b.notes_public && Array.isArray(b.notes)
      ? b.notes.map((n:any)=>({text:safe(String(n.text??'')),at:n.at??null})):[],
    createdAt:b.created_at,closedAt:b.closed_at,
   })),
   quotes,notes,station,selectedQuoteId:h.selected_quote_id,selectedAt:h.selected_at,
   disclaimer:'Техническая передача бесплатна. Согласование суммы — не оплата и не автоматическая запись на ремонт.',
  };
 }
 async quote(user:AuthUser,id:string,price:number,explanation:string){
  if(!await this.verified(user.id))
   throw forbidden('Предложение может дать только проверенная стационарная точка ЭБУ');
  const clean=safe(explanation);
  if(clean.length<10)throw bad('need_explanation','Опишите, что входит в стоимость диагностики');
  const result=await this.db.tx(async q=>{
   const h=await q.one<{client_id:string;state:string}>(
    'select client_id,state from ecu_handoffs where id=$1 for update',[id]);
   if(!h)throw notFound();
   if(h.state!=='pending')throw conflict('closed_for_quotes','Предложение уже выбрано');
   const qrow=await q.one(
    'insert into ecu_quotes(handoff_id,performer_id,diagnosis_price,explanation) values($1,$2,$3,$4)'+
    ' on conflict(handoff_id,performer_id) do update set diagnosis_price=excluded.diagnosis_price,'+
    ' explanation=excluded.explanation,version=ecu_quotes.version+1,updated_at=$5 returning *',
    [id,user.id,price,clean,this.now()]);
   return {quote:qrow,clientId:h.client_id};
  });
  await this.notifier.notify([result.clientId],{type:'ecu_handoff',handoffId:id},
   {kind:'normal',title:'Специалист ЭБУ прислал цену диагностики',
    body:'Цена и описание доступны для отдельного подтверждения.',data:{handoffId:id}}).catch(()=>{});
  return result.quote;
 }
 async choose(user:AuthUser,id:string,quoteId:string,version:number,price:number,agree:boolean){
  if(!agree)throw bad('need_approval','Подтвердите именно эту сумму диагностики');
  const answer=await this.db.tx(async q=>{
   const h=await q.one<{client_id:string;state:string;source_order_id:string}>(
    'select client_id,state,source_order_id from ecu_handoffs where id=$1 for update',[id]);
   if(!h)throw notFound();
   if(user.owner_id || h.client_id!==user.id)
    throw forbidden('Согласование новой цены доступно владельцу автопарка');
   if(h.state!=='pending')throw conflict('already_chosen','Предложение уже выбрано');
   const qrow=await q.one<{performer_id:string;version:number;diagnosis_price:number}>(
    'select performer_id,version,diagnosis_price from ecu_quotes where id=$1 and handoff_id=$2 for update',
    [quoteId,id]);
   if(!qrow)throw notFound('Предложение не найдено');
   if(qrow.version!==version || Number(qrow.diagnosis_price)!==price)
    throw conflict('price_changed','Специалист изменил цену. Подтвердите свежую версию');
   const approved=await q.one(
    "select 1 from ecu_stations s join performer_profiles p on p.user_id=s.performer_id" +
    " join users u on u.id=p.user_id where s.performer_id=$1 and s.approved_at is not null" +
    " and p.kind='ecu' and p.verification='approved' and u.status='active'",[qrow.performer_id]);
   if(!approved)throw conflict('station_unavailable','Точка больше не подтверждена');
   await q.query(
    "update ecu_handoffs set state='selected',selected_quote_id=$2,selected_performer_id=$3,"+
    ' selected_at=$4 where id=$1',[id,quoteId,qrow.performer_id,this.now()]);
   await q.query("insert into order_events(order_id,actor_id,type,data) values($1,$2,'ecu_quote_selected',$3)",
    [h.source_order_id,user.id,{handoffId:id,quoteId,version,price}]);
   return {id,selectedPerformerId:qrow.performer_id,price,version};
  });
  await this.notifier.notify([answer.selectedPerformerId],{type:'ecu_handoff',handoffId:id},
   {kind:'normal',title:'Клиент выбрал вашу диагностику ЭБУ',
    body:'Согласована указанная цена, платёж не создавался. Обсудите передачу блока через защищённый диалог.',
    data:{handoffId:id}}).catch(()=>{});
  return answer;
 }
 async close(user:AuthUser,id:string,reason:string) {
  const clean=safe(reason);
  if(clean.length<10)throw bad('need_reason','Укажите итог или причину закрытия');
  const info=await this.db.tx(async q=>{
   const h=await q.one<{client_id:string;state:string;source_order_id:string;selected_performer_id:string|null;created_by:string}>(
    'select client_id,state,source_order_id,selected_performer_id,created_by from ecu_handoffs where id=$1 for update',[id]);
   if(!h)throw notFound();
   if(user.id!==h.client_id && !user.roles.includes('admin'))
    throw forbidden('Передачу закрывает владелец или администратор');
   if(h.state==='closed')return {changed:false,sourceId:h.source_order_id,worker:h.selected_performer_id};
   await q.query("update ecu_handoffs set state='closed' where id=$1",[id]);
   await q.query('insert into ecu_handoff_notes(handoff_id,author_id,body) values($1,$2,$3)',
    [id,user.id,'Закрыто: '+clean]);
   await q.query("insert into order_events(order_id,actor_id,type,data) values($1,$2,'ecu_handoff_closed',$3)",
    [h.source_order_id,user.id,{handoffId:id}]);
   return {changed:true,sourceId:h.source_order_id,worker:h.selected_performer_id};
  });
  if(info.changed)await this.notifier.notify([info.worker],{type:'ecu_handoff',handoffId:id},
   {kind:'normal',title:'Передача ЭБУ закрыта',
    body:'В обращении сохранено итоговое заключение.',data:{handoffId:id}}).catch(()=>{});
  return {ok:true,state:'closed'};
 }

 async note(user:AuthUser,id:string,body:string){
  const {h,actor}=await this.access(user,id);
  if(h.state!=='selected'||!['owner','driver','expert','admin'].includes(actor))
   throw forbidden('Переписка доступна только участникам согласованной передачи');
  const clean=safe(body);
  if(clean.length<2)throw bad('empty','Введите сообщение');
  const m=await this.db.one(
   'insert into ecu_handoff_notes(handoff_id,author_id,body) values($1,$2,$3) returning id,body,created_at',
   [id,user.id,clean]);
  await this.notifier.notify([h.client_id,h.source_created_by,h.selected_performer_id].filter(x=>x!==user.id),
   {type:'ecu_handoff',handoffId:id},{kind:'normal',title:'Новое сообщение по передаче ЭБУ',
    body:'Доступна новая техническая запись в цепочке обращения.',data:{handoffId:id}}).catch(()=>{});
  return m;
 }
}
