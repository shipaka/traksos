import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {notFound,parse} from '../http/router.ts';
import type {OrdersService} from './orders.ts';

const uuid=z.string().uuid();

type Step={
 id:string;number:number;status:string;service:string;client_id:string;
 created_by:string;case_root_id:string|null;additional_to:string|null;
 continuation_of:string|null;created_at:Date;amount_proposed_at:Date|null;
 amount_confirmed_at:Date|null;payment_method:string;
 call_out_amount:number|null;work_amount:number|null;client_fee_pct:number;
 discount_amount:number|null;estimate:any
};
type Payment={
 order_id:string;kind:string;status:string;total:number;
 refunded_amount:number;created_at:Date
};
type Event={id:string;order_id:string;type:string;created_at:Date};

/** A safe customer/admin financial read model, not a second payment ledger.
 * Each ECU, tow or repair stage is a SEPARATE authorization and contract.
 * A completed service is not evidence of money captured by a bank.
 */
export function registerServiceCaseLedgerRoutes(r:Router,db:Db,orders:OrdersService){
 r.get('/api/orders/:id/case-ledger',true,async(c:AuthedCtx)=>{
  const id=parse(uuid,c.params.id);
  const anchor=await db.one<Step>(
   'select * from orders where id=$1',[id]);
  if(!anchor)throw notFound('Заявка не найдена');
  const staff=c.user.roles.includes('admin');
  const owner=anchor.client_id===c.user.id;
  const creator=anchor.created_by===c.user.id;
  // A fleet driver may read financial information about a stage THEY created
  // but not the owner's independent ECU stage or its private bill.
  if(!staff&&!owner&&!creator)throw notFound('Заявка не найдена');
  const rootId=anchor.case_root_id??anchor.id;
  const access=staff||owner;
  const rows=await db.query<Step>(
   "select id,number,status,service,client_id,created_by,case_root_id,"+
   "additional_to,continuation_of,created_at,amount_proposed_at,"+
   "amount_confirmed_at,payment_method,call_out_amount,work_amount,"+
   "client_fee_pct,discount_amount,estimate "+
   "from orders where (id=$1 or case_root_id=$1) "+
   (access?"":"and created_by=$2 ")+
   "order by created_at,number",
   access?[rootId]:[rootId,c.user.id]);
  const visible=rows.filter(x=>access||x.created_by===c.user.id);
  if(!visible.some(x=>x.id===id))throw notFound('Заявка не найдена');
  const ids=visible.map(x=>x.id);
  const payments=ids.length?await db.query<Payment>(
   "select order_id,kind,status,total,refunded_amount,created_at "+
   "from payments where order_id=any($1::uuid[]) order by created_at,id",
   [ids]):[];
  const events=ids.length?await db.query<Event>(
   "select id::text as id,order_id,type,created_at from order_events "+
   "where order_id=any($1::uuid[]) and type=any($2::text[]) "+
   "order by id desc limit 120",
   [ids,['accepted','amount_proposed','amount_disputed','amount_confirmed','cancelled']]
  ):[];
  const stages=visible.map(step=>{
   const money=orders.money(step);
   const bank=payments.filter(p=>p.order_id===step.id);
   const capturedNet=bank.reduce((sum,p)=>sum+
    (['captured','partially_refunded'].includes(p.status)
      ?Math.max(0,Number(p.total)-Number(p.refunded_amount)):0),0);
   const held=bank.reduce((sum,p)=>sum+(p.status==='held'?Number(p.total):0),0);
   const refunded=bank.reduce((sum,p)=>sum+Number(p.refunded_amount),0);
   const confirmed=step.status==='completed';
   const quotes=events.filter(e=>e.order_id===step.id);
   return {
    id:step.id,number:step.number,service:step.service,status:step.status,
    additionalTo:step.additional_to,continuationOf:step.continuation_of,
    paymentMethod:step.payment_method,
    price:{proposedTotal:step.status==='awaiting_confirmation'?money.total:null,
      confirmedTotal:confirmed?money.total:null,
      currency:'RUB',unit:'kopecks'},
    paymentEvidence:{capturedNetKopecks:capturedNet,
      heldKopecks:held,refundedKopecks:refunded,
      records:bank.map(p=>({kind:p.kind,status:p.status,
        totalKopecks:Number(p.total),refundedKopecks:Number(p.refunded_amount)})),
      cashOrInvoiceUnverified:step.payment_method!=='online'},
    needsCustomerApproval:step.status==='awaiting_confirmation',
    requiresPaymentReconciliation:confirmed&&step.payment_method==='online'&&
      (bank.length===0||bank.some(p=>
        !['captured','partially_refunded','refunded'].includes(p.status))),
    events:quotes.reverse().map(e=>({id:e.id,type:e.type,at:e.created_at}))
   };
  });
  return {
   rootId,requestedOrderId:id,limitedToCreator:!access,
   stages,
   totals:{
    confirmedKopecks:stages.reduce((s,x)=>s+(x.price.confirmedTotal??0),0),
    capturedNetKopecks:stages.reduce((s,x)=>s+x.paymentEvidence.capturedNetKopecks,0),
    heldKopecks:stages.reduce((s,x)=>s+x.paymentEvidence.heldKopecks,0),
    refundableNotInferred:true
   },
   pendingApprovals:stages.filter(x=>x.needsCustomerApproval).length,
   hasOpenPaymentReconciliation:stages.some(x=>x.requiresPaymentReconciliation),
   separateContracts:true,
   warning:'Подтверждённая стоимость работ, удержанный резерв и фактически проведённые банком платежи — разные величины. Наличные/счёт не подтверждены банковским реестром. Отдельные заказы СТО и запчастей в эту сводку не включены.'
  };
 });
}
