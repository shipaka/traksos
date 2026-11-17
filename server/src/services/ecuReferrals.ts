import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Notifier} from './notify.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse,bad,conflict,forbidden,notFound} from '../http/router.ts';

const uuid=z.string().uuid();
const note=z.string().trim().min(20).max(800);
type Parent={
  id:string;number:number;service:string;status:string;
  client_id:string;created_by:string;performer_id:string|null
};
const eligible=new Set(['accepted','en_route','arrived','working',
  'awaiting_confirmation','completed']);
function isCustomer(c:AuthedCtx,o:Parent){
  if(!c.user.roles.some(r=>r==='client'||r==='driver'))return false;
  if(c.user.owner_id)return o.created_by===c.user.id&&o.client_id===c.user.owner_id;
  return o.client_id===c.user.id||o.created_by===c.user.id;
}
const fetchParent=async(db:Db,id:string)=>db.one<Parent>(
  'select id,number,service,status,client_id,created_by,performer_id from orders where id=$1',
  [id]);

export function registerEcuReferralRoutes(r:Router,db:Db,notify:Notifier){
  r.post('/api/orders/:id/recommend-ecu',['master','tow','service'],
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id),b=parse(z.object({reason:note}),c.body);
      const created=await db.tx(async q=>{
        const parent=await q.one<Parent>(
          'select id,number,service,status,client_id,created_by,performer_id '+
          'from orders where id=$1 for update',[id]);
        if(!parent)throw notFound('Заявка не найдена');
        if(parent.performer_id!==c.user.id)
          throw forbidden('Рекомендовать ЭБУ может только исполнитель этой заявки');
        if(!eligible.has(parent.status))
          throw conflict('not_eligible','Сначала примите заявку или завершите диагностику');
        if(parent.service==='ecu')
          throw bad('duplicate_specialty','Повторный вызов ЭБУ оформляется отдельно клиентом');
        const already=await q.one('select 1 from orders where additional_to=$1 and service=$2 '+
          "and status not in ('cancelled','no_performer')",[id,'ecu']);
        if(already)throw conflict('ecu_already_added','Дополнительный специалист уже подключён');
        const pending=await q.one<{id:string}>(
          "select id from order_ecu_referrals where source_order_id=$1 and status='pending'",
          [id]);
        if(pending)
          throw conflict('ecu_already_recommended','Рекомендация уже ждёт решения клиента');
        const saved=await q.one<{id:string}>(
          'insert into order_ecu_referrals(source_order_id,suggested_by,reason) '+
          'values($1,$2,$3) returning id',
          [id,c.user.id,b.reason]);
        await q.query(
          'insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'orders.ecu_recommended',saved!.id,{orderId:id,service:'ecu'}]);
        return {id:saved!.id,clientId:parent.client_id,creatorId:parent.created_by,
          sourceNumber:parent.number};
      });
      try{
        await notify.notify([...new Set([created.clientId,created.creatorId])],
          {type:'order',orderId:id,kind:'ecu_recommendation'},
          {kind:'normal',title:'Рекомендован специалист по ЭБУ',
            body:'Мастер предлагает дополнительный отдельный этап ремонта. Решение за вами.',
            data:{orderId:id}});
      }catch{ /* A sent recommendation must survive temporary push outages. */ }
      return {id:created.id,orderId:id,status:'pending',
        createsOrder:false,requiresClientConfirmation:true};
    });
  r.get('/api/orders/:id/ecu-recommendations',true,async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id),parent=await fetchParent(db,id);
    if(!parent)throw notFound('Заявка не найдена');
    const customer=isCustomer(c,parent);
    if(!customer&&parent.performer_id!==c.user.id&&!c.user.roles.includes('admin'))
      throw notFound('Заявка не найдена');
    const rows=await db.query<{
      id:string;source_order_id:string;reason:string;status:string;created_at:Date;
      linked_order_id:string|null;linked_created_by:string|null
    }>('select r.id,r.source_order_id,r.reason,r.status,r.created_at,r.linked_order_id, '+
      'child.created_by as linked_created_by from order_ecu_referrals r '+
      'left join orders child on child.id=r.linked_order_id '+
      'where r.source_order_id=$1 order by r.created_at desc limit 30',
      [id]);
    return {recommendations:rows.map(x=>({
      id:x.id,orderId:x.source_order_id,reason:x.reason,status:x.status,
      createdAt:x.created_at,
      // A fleet driver can read the original request they created, but must
      // not learn the ID of a separately contracted owner-created ECU stage.
      linkedOrderId:c.user.roles.includes('admin') ||
        (customer && (!c.user.owner_id || x.linked_created_by===c.user.id))
        ? x.linked_order_id : null
    })),canCreate:customer};
  });
  r.post('/api/orders/:id/ecu-recommendations/:refId/decline',true,
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id),ref=parse(uuid,c.params.refId);
      return db.tx(async q=>{
        const parent=await q.one<Parent>(
          'select id,number,service,status,client_id,created_by,performer_id '+
          'from orders where id=$1 for update',[id]);
        if(!parent)throw notFound('Заявка не найдена');
        if(!isCustomer(c,parent))throw forbidden();
        const row=await q.one<{status:string}>(
          'select status from order_ecu_referrals where source_order_id=$1 and id=$2 for update',
          [id,ref]);
        if(!row)throw notFound('Рекомендация не найдена');
        if(row.status!=='pending')
          throw conflict('recommendation_closed','Рекомендация уже обработана');
        await q.query(
          "update order_ecu_referrals set status='declined',resolved_at=now() where id=$1",
          [ref]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'orders.ecu_recommendation_declined',ref,{sourceOrderId:id}]);
        return {id:ref,status:'declined',createsOrder:false};
      });
    });
}
