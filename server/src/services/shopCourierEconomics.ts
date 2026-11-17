import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx } from '../http/router.ts';
import { parse, conflict, notFound } from '../http/router.ts';
import type { Notifier } from './notify.ts';
import { warehouseProgress } from './shopWarehouse.ts';
import {supplierReceiptReadiness} from './shopSupplierReceiving.ts';

const uuid=z.string().uuid();
const cost=z.number().int().min(0).max(1_000_000_000);
const budgetSchema=z.object({
  courierPayKopecks:cost,fuelKopecks:cost,packingKopecks:cost,
  acquiringKopecks:cost,taxesKopecks:cost,otherKopecks:cost,
  note:z.string().trim().min(10).max(1000),
});
type QueryDb=Pick<Db,'one'|'query'>;
type Run={id:string;status:string;courier_id:string;dispatch_approved_at:Date|null;
  packing_required:boolean;supplier_receipt_required:boolean};
type Line={id:string;items:any[];goods_total:number;delivery_price:number;status:string};
type Snapshot={shop_order_id:string;product_id:string;qty:number;purchase_unit_kopecks:number};
type Budget={courier_pay_kopecks:number;fuel_kopecks:number;packing_kopecks:number;
  acquiring_kopecks:number;taxes_kopecks:number;other_kopecks:number};

async function economics(db:QueryDb,runId:string){
  const run=await db.one<Run>('select id,status,courier_id,dispatch_approved_at,packing_required,supplier_receipt_required from shop_courier_runs where id=$1',[runId]);
  if(!run)throw notFound('Курьерский рейс не найден');
  const orders=await db.query<Line>(
    'select o.id,o.items,o.goods_total,o.delivery_price,o.status from shop_courier_stops st '+
    'join shop_orders o on o.id=st.shop_order_id where st.run_id=$1 order by st.seq',[runId]);
  const snapshots=await db.query<Snapshot>(
    'select c.shop_order_id,c.product_id,c.qty,c.purchase_unit_kopecks::integer from shop_order_cost_snapshots c '+
    'join shop_courier_stops st on st.shop_order_id=c.shop_order_id where st.run_id=$1',[runId]);
  const budget=await db.one<Budget>(
    'select courier_pay_kopecks::integer,fuel_kopecks::integer,packing_kopecks::integer,'+
    'acquiring_kopecks::integer,taxes_kopecks::integer,other_kopecks::integer '+
    'from shop_courier_run_budgets where run_id=$1',[runId]);
  const expected=new Map<string,number>();
  for(const o of orders)for(const item of o.items??[])
    expected.set(o.id+'|'+item.productId,Number(item.qty));
  const seen=new Set<string>();
  let costsKnown=expected.size>0;
  for(const snap of snapshots){
    const key=snap.shop_order_id+'|'+snap.product_id;
    if(seen.has(key)||expected.get(key)!==Number(snap.qty))costsKnown=false;
    seen.add(key);
  }
  if(seen.size!==expected.size)costsKnown=false;
  const goods=orders.reduce((n,o)=>n+Number(o.goods_total),0);
  const delivery=orders.reduce((n,o)=>n+Number(o.delivery_price),0);
  const purchase=costsKnown?snapshots.reduce((n,x)=>n+Number(x.qty)*Number(x.purchase_unit_kopecks),0):null;
  const tradingMarkup=purchase==null?null:goods-purchase;
  const expenses=budget?Number(budget.courier_pay_kopecks)+Number(budget.fuel_kopecks)+
    Number(budget.packing_kopecks)+Number(budget.acquiring_kopecks)+
    Number(budget.taxes_kopecks)+Number(budget.other_kopecks):null;
  const contribution=tradingMarkup!=null&&expenses!=null?tradingMarkup+delivery-expenses:null;
  const issue=await db.one<{n:number}>(
    'select count(*)::integer as n from shop_courier_stops st '+
    'join shop_supplier_order_issues i on i.shop_order_id=st.shop_order_id '+
    'where st.run_id=$1 and i.needs_review=true',[runId]);
  const supplierIssues=(issue?.n??0)>0;
  const ready=orders.length>0&&orders.every(o=>o.status==='ready');
  const supplierReceiptReady=!run.supplier_receipt_required||(
    orders.length>0&&(await Promise.all(orders.map(o=>
      supplierReceiptReadiness(db,o.id)))).every(x=>x.ready));
  return {
    runId,status:run.status,stops:orders.length,goodsRevenueKopecks:goods,
    deliveryRevenueKopecks:delivery,procurementKnown:costsKnown,
    procurementTotalKopecks:purchase,tradingMarkupKopecks:tradingMarkup,
    forecastExpensesKopecks:expenses,courierPayKopecks:budget?Number(budget.courier_pay_kopecks):null,
    routeContributionKopecks:contribution,budgetDocumented:Boolean(budget),
    supplierIssuesOpen:supplierIssues,ordersReady:ready,
    supplierReceiptRequired:run.supplier_receipt_required,supplierReceiptReady,
    canApprove:Boolean(budget)&&costsKnown&&!supplierIssues&&ready&&supplierReceiptReady,
    platformCommissionRatePct:5,platformCommissionEstimateKopecks:Math.round(goods*0.05),
    platformCommissionBookedKopecks:0,feeIncludedInContribution:false,
    profitable:contribution==null?null:contribution>=0,
    approved:Boolean(run.dispatch_approved_at),
    warning:'Расчёт использует подтверждённые закупки и расходы, введённые администратором. Комиссия платформы 5% учитывается отдельно и не включена в прибыльность доставки. Финальные затраты нужно сверить.'
  };
}

export function registerShopCourierEconomicsRoutes(r:Router,db:Db,notifier:Notifier){
  r.get('/api/admin/shop/courier-runs/:id/economics',['admin'],async(c:AuthedCtx)=>
    economics(db,parse(uuid,c.params.id)));
  r.put('/api/admin/shop/courier-runs/:id/budget',['admin'],async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id),b=parse(budgetSchema,c.body);
    await db.tx(async q=>{
      const run=await q.one<Run>('select * from shop_courier_runs where id=$1 for update',[id]);
      if(!run)throw notFound('Курьерский рейс не найден');
      if(run.status!=='planned'||run.dispatch_approved_at)
        throw conflict('run_already_approved','Смету можно менять только до утверждения рейса');
      await q.query(
        'insert into shop_courier_run_budgets(run_id,courier_pay_kopecks,fuel_kopecks,packing_kopecks,'+
        'acquiring_kopecks,taxes_kopecks,other_kopecks,estimate_note,reviewed_by) '+
        'values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(run_id) do update set '+
        'courier_pay_kopecks=excluded.courier_pay_kopecks,fuel_kopecks=excluded.fuel_kopecks,'+
        'packing_kopecks=excluded.packing_kopecks,acquiring_kopecks=excluded.acquiring_kopecks,'+
        'taxes_kopecks=excluded.taxes_kopecks,other_kopecks=excluded.other_kopecks,'+
        'estimate_note=excluded.estimate_note,reviewed_by=excluded.reviewed_by,reviewed_at=now()',
        [id,b.courierPayKopecks,b.fuelKopecks,b.packingKopecks,b.acquiringKopecks,
         b.taxesKopecks,b.otherKopecks,b.note,c.user.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_budget_updated',id,b]);
    });
    return economics(db,id);
  });
  r.post('/api/admin/shop/courier-runs/:id/approve-dispatch',['admin'],async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id);
    const {exceptionReason}=parse(z.object({
      exceptionReason:z.string().trim().min(30).max(700).optional()
    }),c.body);
    const approved=await db.tx(async q=>{
      const run=await q.one<Run>('select * from shop_courier_runs where id=$1 for update',[id]);
      if(!run)throw notFound('Курьерский рейс не найден');
      if(run.status!=='planned'||run.dispatch_approved_at)
        throw conflict('run_already_approved','Маршрут уже утверждён или выполняется');
      await q.query('select o.id from shop_orders o join shop_courier_stops s on s.shop_order_id=o.id where s.run_id=$1 for update of o',[id]);
      if(run.packing_required){
        const packing=await warehouseProgress(q,id);
        if(!packing.ready)
          throw conflict('packing_incomplete',
            'Нельзя отправить рейс: склад не сверил все артикулы и количества');
      }
      const stats=await economics(q,id);
      if(run.supplier_receipt_required&&!stats.supplierReceiptReady)
        throw conflict('supplier_receipt_incomplete',
          'Нельзя отправить рейс: не все товары подтверждены актами физической приёмки поставщика');
      if(!stats.canApprove||stats.routeContributionKopecks==null)
        throw conflict('route_economics_incomplete',
          'Нет проверенной закупки, сметы или поставщик отменил заказ');
      if(stats.routeContributionKopecks<0&&!exceptionReason)
        throw conflict('route_unprofitable',
          'Нужна обоснованная ручная санкция администратора на убыточный рейс');
      await q.query('update shop_courier_runs set dispatch_approved_at=now(),dispatch_approved_by=$2,dispatch_exception_reason=$3 where id=$1',
        [id,c.user.id,stats.routeContributionKopecks<0?exceptionReason??null:null]);
      // Assignments and in-app notifications are persisted in the SAME
      // transaction as approval. They cannot precede actual finance approval,
      // and an HTTP retry cannot generate duplicate "courier assigned" alerts.
      const assigned=await q.query<{id:string;number:number;client_id:string;created_by:string}>(
        "select o.id,o.number,o.client_id,o.created_by from shop_orders o "+
        "join shop_courier_stops st on st.shop_order_id=o.id "+
        "where st.run_id=$1 order by st.seq",[id]);
      await q.query(
        "insert into shop_delivery_events(shop_order_id,run_id,status,actor_id) "+
        "select shop_order_id,run_id,'assigned',$2 from shop_courier_stops "+
        "where run_id=$1",[id,c.user.id]);
      for(const item of assigned){
        const recipients=[...new Set([item.client_id,item.created_by])];
        for(const userId of recipients)
          await q.query(
            "insert into notifications(user_id,kind,title,body,data) "+
            "values($1,'shop',$2,$3,$4)",
            [userId,'Доставка заказа №'+item.number,
              'Маршрут доставки утверждён. Ожидайте подтверждения курьера и отправки со склада.',
              {shopOrderId:item.id}]);
      }
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_dispatch_approved',id,
          {contributionKopecks:stats.routeContributionKopecks,
           customerAssignments:assigned.length,
           exceptionReason:stats.routeContributionKopecks<0?exceptionReason??null:null}]);
      return {courierId:run.courier_id,stats,assigned};
    });
    notifier.live([approved.courierId],{type:'courier_route_assigned',runId:id});
    // A push is best-effort. The stored customer notification and audit
    // event are already committed and remain visible if push delivery fails.
    for(const item of approved.assigned){
      await notifier.deliverStored(
        [item.client_id,item.created_by],{type:'shop',shopOrderId:item.id},
        {kind:'normal',title:'Доставка заказа №'+item.number,
          body:'Маршрут доставки утверждён. Ожидайте отправки со склада.',
          data:{shopOrderId:item.id}}
      ).catch(err=>console.warn('[courier-dispatch-push]',err));
    }
    return {approved:true,economics:approved.stats};
  });
}
