import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse,bad,conflict,notFound} from '../http/router.ts';

const uuid=z.string().uuid();
const input=z.object({
  lineIndex:z.number().int().min(0).max(499),
  allocations:z.array(z.object({
    receiptId:uuid,
    quantity:z.number().int().min(1).max(10000)
  })).min(1).max(50),
  justification:z.string().trim().min(20).max(1000)
});
const norm=(s:string)=>s.trim().toLocaleUpperCase('ru-RU').replace(/[\s-]/g,'');
type SourceLine={
  receipt_id:string;shop_order_id:string;document_ref:string;document_date:string;
  status:string;line_index:number;product_id:string;expected_article:string;
  observed_article:string;observed_qty:number;condition:string;
  inspected_at:Date|null;accepted_at:Date|null
};
export function registerShopWarehouseSourceRoutes(r:Router,db:Db){
  r.get('/api/admin/shop/courier-runs/:id/warehouse/stops/:stopId/receipt-sources',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id),stopId=parse(uuid,c.params.stopId);
      const st=await db.one<{shop_order_id:string}>(
        'select shop_order_id from shop_courier_stops where id=$1 and run_id=$2',
        [stopId,runId]);
      if(!st)throw notFound('Посылка не найдена в рейсе');
      const rows=await db.query<SourceLine>(`
        select r.id as receipt_id,r.shop_order_id,r.document_ref,r.document_date,
          r.status,l.line_index,l.product_id,l.expected_article,l.observed_article,
          l.observed_qty,l.condition,l.inspected_at,r.accepted_at
        from shop_supplier_receipts r
        join shop_supplier_receipt_lines l on l.receipt_id=r.id
        where r.shop_order_id=$1 and r.status='accepted' and l.condition='intact'
        and l.observed_qty>0
        order by r.accepted_at,r.id,l.line_index limit 500`,[st.shop_order_id]);
      return {sources:rows.map(x=>({
        receiptId:x.receipt_id,lineIndex:x.line_index,documentRef:x.document_ref,
        documentDate:x.document_date,article:x.expected_article,
        acceptedQuantity:x.observed_qty,acceptedAt:x.accepted_at
      })),manualDocumentReview:true,supplierApiConnected:false};
    });

  r.post('/api/admin/shop/courier-runs/:id/warehouse/stops/:stopId/receipt-sources',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id),stopId=parse(uuid,c.params.stopId);
      const b=parse(input,c.body);
      const receiptIds=b.allocations.map(a=>a.receiptId);
      if(new Set(receiptIds).size!==receiptIds.length)
        throw bad('duplicate_receipt','Один акт нельзя распределять дважды на одну товарную строку');
      const total=b.allocations.reduce((sum,a)=>sum+a.quantity,0);
      return db.tx(async q=>{
        // Match route, packing, receipt, trace and incident modifications by
        // holding the shared run lock. No funds or inventory are moved.
        const run=await q.one<{
          id:string;status:string;packing_required:boolean;traceability_required:boolean;
          supplier_receipt_required:boolean;dispatch_approved_at:Date|null
        }>(
          'select id,status,packing_required,traceability_required,'+
          'supplier_receipt_required,dispatch_approved_at from shop_courier_runs '+
          'where id=$1 for update',[runId]);
        if(!run)throw notFound('Курьерский рейс не найден');
        if(!run.traceability_required||!run.supplier_receipt_required||!run.packing_required)
          throw conflict('link_not_enabled',
            'Сопоставление требуется только для рейсов с обеими строгими проверками');
        if(run.status!=='planned'||run.dispatch_approved_at)
          throw conflict('route_locked','Изменять источник партии после утверждения запрещено');
        const stop=await q.one<{shop_order_id:string;items:unknown;status:string}>(
          'select s.shop_order_id,o.items,s.status from shop_courier_stops s '+
          'join shop_orders o on o.id=s.shop_order_id '+
          'where s.id=$1 and s.run_id=$2 for update of s,o',[stopId,runId]);
        if(!stop)throw notFound('Посылка не найдена в рейсе');
        if(stop.status!=='awaiting_pickup')
          throw conflict('parcel_collected','Посылка уже передана курьеру');
        const item=Array.isArray(stop.items)?stop.items[b.lineIndex]:null;
        if(!item)throw bad('line_not_found','Строка заказа не найдена');
        const qty=Number(item.qty),productId=String(item.productId??'');
        const article=String(item.article??'').trim();
        if(!Number.isSafeInteger(qty)||qty<1||article.length<2||total!==qty)
          throw conflict('allocation_quantity_mismatch',
            'Сумма распределения должна совпадать с количеством этой строки заказа');
        const tr=await q.one<{article_snapshot:string;qty_snapshot:number;recorded_at:Date}>(
          'select article_snapshot,qty_snapshot,recorded_at from shop_warehouse_line_traces '+
          'where stop_id=$1 and line_index=$2 for update',[stopId,b.lineIndex]);
        const check=await q.one<{checked_article:string;checked_qty:number;checked_at:Date}>(
          'select checked_article,checked_qty,checked_at from shop_warehouse_line_checks '+
          'where stop_id=$1 and line_index=$2',[stopId,b.lineIndex]);
        if(!tr||!check||norm(tr.article_snapshot)!==norm(article)||
          norm(check.checked_article)!==norm(article)||
          tr.qty_snapshot!==qty||check.checked_qty!==qty||tr.recorded_at<check.checked_at)
          throw conflict('fresh_trace_required',
            'Сначала подтвердите физическую сверку и запишите действующую маркировку');
        if(await q.one('select 1 from shop_warehouse_discrepancies '+
          "where stop_id=$1 and line_index=$2 and status='open'",[stopId,b.lineIndex]))
          throw conflict('warehouse_discrepancy',
            'Нельзя распределять поставку при открытом складском расхождении');
        const supplier=await q.one<{supplier_article:string;verified:boolean}>(
          'select supplier_article,verified from shop_supplier_refs where product_id=$1',
          [productId]);
        if(!supplier?.verified)
          throw conflict('supplier_sku_unverified',
            'Требуется актуальное подтверждение артикула поставщика');
        const source=await q.query<SourceLine>(`
          select r.id as receipt_id,r.shop_order_id,r.document_ref,r.document_date,
            r.status,l.line_index,l.product_id,l.expected_article,l.observed_article,
            l.observed_qty,l.condition,l.inspected_at,r.accepted_at
          from shop_supplier_receipts r
          join shop_supplier_receipt_lines l on l.receipt_id=r.id
          where r.id=any($1::uuid[]) and l.line_index=$2
          for update of r,l`,[receiptIds,b.lineIndex]);
        if(source.length!==receiptIds.length)
          throw conflict('receipt_missing','Нет проверенной строки в одной из выбранных накладных');
        const byId=new Map(source.map(x=>[x.receipt_id,x]));
        for(const allocation of b.allocations){
          const row=byId.get(allocation.receiptId);
          if(!row||row.shop_order_id!==stop.shop_order_id||
            row.status!=='accepted'||!row.accepted_at||!row.inspected_at||
            row.condition!=='intact'||row.product_id!==productId||
            norm(row.expected_article)!==norm(supplier.supplier_article)||
            norm(row.observed_article)!==norm(row.expected_article)||
            row.observed_qty<allocation.quantity)
            throw conflict('receipt_line_invalid',
              'Накладная отозвана, относится к другой позиции, количеству или неподтверждённому SKU');
        }
        await q.query('delete from shop_warehouse_trace_receipt_allocations '+
          'where stop_id=$1 and line_index=$2',[stopId,b.lineIndex]);
        for(const allocation of b.allocations){
          await q.query(`
            insert into shop_warehouse_trace_receipt_allocations
              (stop_id,line_index,receipt_id,receipt_line_index,allocated_qty,recorded_by)
            values($1,$2,$3,$2,$4,$5)`,
            [stopId,b.lineIndex,allocation.receiptId,allocation.quantity,c.user.id]);
        }
        await q.query(
          'insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.supplier_trace_linked',stopId,{
            runId,lineIndex:b.lineIndex,receiptIds,quantities:b.allocations.map(x=>x.quantity),
            note:b.justification,manualEvidence:true
          }]);
        return {linked:true,runId,stopId,lineIndex:b.lineIndex,
          allocatedQuantity:total,sourceCount:receiptIds.length,
          manualEvidence:true,supplierApiConnected:false,
          provenanceAuthenticityVerified:false,stockMovementRecorded:false,
          financialChanges:false};
      });
    });
}
