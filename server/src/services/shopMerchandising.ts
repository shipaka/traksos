import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx } from '../http/router.ts';
import { parse, bad, conflict, notFound } from '../http/router.ts';
import type { Notifier } from './notify.ts';

const uuid=z.string().uuid();
const STAGES={
 requested:'Ожидаем подтверждения поставщика',
 accepted:'Заказ принят поставщиком',
 processing:'Заказ обрабатывается',
 partner_accepted:'Поставщик подтвердил заказ',
 awaiting_assembly:'Ожидает сборки',
 assembling:'Заказ собирается',
 assembled:'Заказ собран поставщиком',
 dispatched:'Передан на наш склад',
 cancelled:'Поставщик отменил заказ — уточняем причину',
 unknown:'Уточняем статус поставки',
} as const;
type Stage=keyof typeof STAGES;

function retailFloor(cost:number,markupBps:number) {
  const price=Math.ceil(cost*(10000+markupBps)/10000);
  if(!Number.isSafeInteger(price)||price>2_000_000_000)throw bad('price_over_limit','Рассчитанная цена превышает лимит каталога');
  return price;
}
const priceSchema=z.object({
 purchaseCostKopecks:z.number().int().min(1).max(100_000_000),
 markupBps:z.number().int().min(0).max(30000).default(3000),
 costSourceNote:z.string().trim().min(10).max(500),
 supplierQuoteRef:z.string().trim().max(200).nullable().optional(),
 exceptionReason:z.string().trim().min(20).max(500).nullable().optional(),
 competitorComparison:z.string().trim().min(15).max(800).nullable().optional(),
 competitorEtaDays:z.number().int().min(0).max(90).nullable().optional(),
});
const eventSchema=z.object({
 status:z.enum(['requested','accepted','processing','partner_accepted','awaiting_assembly',
   'assembling','assembled','dispatched','cancelled','unknown']),
 rawStatus:z.string().trim().min(1).max(200),
 supplierOrderRef:z.string().trim().max(120).nullable().optional(),
 sourceEvidence:z.string().trim().min(10).max(1000),
 cancellationReason:z.string().trim().max(500).nullable().optional(),
 eventTime:z.string().datetime({offset:true}),
 eventExternalId:z.string().trim().min(6).max(120).nullable().optional(),
});
export function registerShopMerchandisingRoutes(r:Router,db:Db,notifier:Notifier) {
  r.get('/api/admin/shop/products/:id/costing',['admin'],async(c:AuthedCtx)=>{
    const productId=parse(uuid,c.params.id);
    const record=await db.one('select * from shop_product_costing where product_id=$1',[productId]);
    return {record:record??null,minimumDefaultMarkupBps:3000,platformCommissionBps:500,
      calculationBasis:'purchase_cost',feeNotAddedToGoodsPrice:true};
  });

  r.put('/api/admin/shop/products/:id/costing',['admin'],async(c:AuthedCtx)=>{
    const productId=parse(uuid,c.params.id);
    const b=parse(priceSchema,c.body);
    if(b.markupBps<3000 && (!b.exceptionReason || !b.competitorComparison))
      throw bad('exception_requires_evidence','Для наценки ниже 30% требуется причина и сравнимое предложение конкурента');
    // Commission is not calculated or included in this price; two independent revenue streams.
    const calculatedPrice=retailFloor(b.purchaseCostKopecks,b.markupBps);
    const result=await db.tx(async q=>{
      const product=await q.one<{id:string}>('select id from shop_products where id=$1 for update',[productId]);
      if(!product)throw notFound('Товар не найден');
      await q.query(
        'insert into shop_product_costing(product_id,purchase_cost_kopecks,markup_bps,cost_source_note,supplier_quote_ref,'+
        'exception_reason,competitor_comparison,competitor_eta_days,reviewed_by) '+
        'values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(product_id) do update set '+
        'purchase_cost_kopecks=excluded.purchase_cost_kopecks,markup_bps=excluded.markup_bps,'+
        'cost_source_note=excluded.cost_source_note,supplier_quote_ref=excluded.supplier_quote_ref,'+
        'exception_reason=excluded.exception_reason,competitor_comparison=excluded.competitor_comparison,'+
        'competitor_eta_days=excluded.competitor_eta_days,reviewed_by=excluded.reviewed_by,'+
        'cost_confirmed_at=now(),updated_at=now()',
        [productId,b.purchaseCostKopecks,b.markupBps,b.costSourceNote,b.supplierQuoteRef??null,
         b.exceptionReason??null,b.competitorComparison??null,b.competitorEtaDays??null,c.user.id]);
      const p=await q.one<{price:number}>(
        'update shop_products set price=$2,updated_at=now() where id=$1 returning price',[productId,calculatedPrice]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.costing_approved',productId,
         {costKopecks:b.purchaseCostKopecks,markupBps:b.markupBps,
          sellingPriceKopecks:calculatedPrice,exception:b.markupBps<3000,
          exceptionReason:b.exceptionReason??null,comparison:b.competitorComparison??null}]);
      return p;
    });
    return {productId,procurementCostKopecks:b.purchaseCostKopecks,
      markupBps:b.markupBps,retailPriceKopecks:result?.price??calculatedPrice,
      defaultMinimumMarkupBps:3000,platformCommissionBps:500,
      platformFeeIncluded:false};
  });

  // Manual confirmation only. A real Autokontinent API adapter must preserve its
  // original event code/ID and be introduced after credential and contract review.
  r.post('/api/admin/shop/orders/:id/supplier-events',['admin'],async(c:AuthedCtx)=>{
    const orderId=parse(uuid,c.params.id);
    const b=parse(eventSchema,c.body);
    const o=await db.one<{id:string;status:string;client_id:string;created_by:string;number:number}>(
      'select id,status,client_id,created_by,number from shop_orders where id=$1',[orderId]);
    if(!o)throw notFound('Заказ не найден');
    const result=await db.tx(async q=>{
      // Manual events can be retried without duplication when the operator supplies
      // an external event identifier; they never masquerade as API-sourced.
      const saved=await q.one<{id:string;status:Stage;event_time:Date}>(
        "insert into shop_supplier_order_events(shop_order_id,external_order_ref,status,raw_status,"+
        "event_time,source,source_evidence,cancellation_reason,event_external_id,recorded_by) "+
        "values($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9) "+
        "on conflict (shop_order_id,source,event_external_id) where event_external_id is not null "+
        "do update set id=shop_supplier_order_events.id "+
        "returning id::text as id,status,event_time",
        [orderId,b.supplierOrderRef??null,b.status,b.rawStatus,b.eventTime,
          b.sourceEvidence,b.cancellationReason??null,b.eventExternalId??null,c.user.id]);
      if(b.status==='cancelled')await q.query(
        "insert into shop_supplier_order_issues(shop_order_id,issue_kind,details) values($1,'supplier_cancelled',$2) "+
        "on conflict(shop_order_id) do update set needs_review=true,issue_kind='supplier_cancelled',"+
        "details=excluded.details,resolved_at=null,resolved_by=null",
        [orderId,b.cancellationReason??'Поставщик не указал причину отмены']);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.supplier_event_recorded',orderId,
          {eventId:saved?.id??null,status:b.status,reasonProvided:Boolean(b.cancellationReason)}]);
      return saved;
    });
    await notifier.notify([o.client_id,o.created_by],
      {type:'shop_supplier_update',shopOrderId:orderId},
      {kind:'normal',title:'Заказ №'+o.number+': информация о поставке',
        body:STAGES[b.status],data:{shopOrderId:orderId}});
    return {id:result?.id,status:b.status,displayStatus:STAGES[b.status],
      reasonProvided:Boolean(b.cancellationReason),orderStatusChanged:false,refundConfirmed:false};
  });

  r.get('/api/admin/shop/orders/:id/supplier-events',['admin'],async(c:AuthedCtx)=>{
    const orderId=parse(uuid,c.params.id);
    const o=await db.one('select id from shop_orders where id=$1',[orderId]);
    if(!o)throw notFound('Заказ не найден');
    const events=await db.query('select * from shop_supplier_order_events where shop_order_id=$1 order by event_time desc,id desc limit 200',[orderId]);
    const issue=await db.one('select * from shop_supplier_order_issues where shop_order_id=$1',[orderId]);
    return {events,issue,sourceConnected:false};
  });
  r.get('/api/shop/orders/:id/supplier-status',true,async(c:AuthedCtx)=>{
    const orderId=parse(uuid,c.params.id);
    const owner=await db.one<{id:string;client_id:string;created_by:string}>(
      'select id,client_id,created_by from shop_orders where id=$1',[orderId]);
    if(!owner || (owner.client_id!==c.user.id && owner.created_by!==c.user.id))
      throw notFound('Заказ не найден');
    const recent=await db.query<{status:Stage;event_time:Date;cancellation_reason:string|null}>(
      'select status,event_time,cancellation_reason from shop_supplier_order_events '+
      'where shop_order_id=$1 order by event_time desc,id desc limit 30',[orderId]);
    const last=recent[0]??null;
    return {status:last?.status??'requested',text:last?STAGES[last.status]:STAGES.requested,
      lastVerifiedAt:last?.event_time??null,
      statusSource:last?'operator_recorded':'not_confirmed',
      reasonProvided:!!last?.cancellation_reason,
      history:recent.map(x=>({status:x.status,text:STAGES[x.status],at:x.event_time})),
      paymentRefundConfirmed:false,supplierApiConnected:false};
  });
  r.get('/api/admin/shop/orders/:id/cost-analysis',['admin'],async(c:AuthedCtx)=>{
    const orderId=parse(uuid,c.params.id);
    const order=await db.one<{id:string;items:any[];goods_total:number;delivery_price:number;total:number}>(
      'select id,items,goods_total,delivery_price,total from shop_orders where id=$1',[orderId]);
    if(!order)throw notFound('Заказ не найден');
    const snapshot=await db.query<{product_id:string;qty:number;purchase_unit_kopecks:number;
      retail_unit_kopecks:number;target_markup_bps:number}>(
      'select product_id,qty,purchase_unit_kopecks::integer,retail_unit_kopecks::integer,target_markup_bps '+
      'from shop_order_cost_snapshots where shop_order_id=$1',[orderId]);
    const complete=snapshot.length===order.items.length;
    const costs=snapshot.reduce((n,x)=>n+x.purchase_unit_kopecks*x.qty,0);
    const markup=complete?order.goods_total-costs:null;
    // 5% shown as a prospective separate revenue line, never silently charged.
    const commissionEstimate=Math.round(order.goods_total*0.05);
    return {goodsTotalKopecks:order.goods_total,
      verifiedProcurementTotalKopecks:complete?costs:null,
      grossTradingMarkupKopecks:markup,
      commissionRatePct:5,platformCommissionEstimateKopecks:commissionEstimate,
      commissionActuallyChargedKopecks:0,
      deliveryCollectedKopecks:order.delivery_price,
      completePurchaseCostSnapshot:complete,
      courierAndProcessingCostsIncluded:false,
      profitVerified:false,
      note:'Доход по торговой наценке и комиссия TrakSOS учитываются отдельно. Без затрат на доставку, налогов, возвратов и фактического способа начисления комиссии прибыль не подтверждена.'};
  });
}
