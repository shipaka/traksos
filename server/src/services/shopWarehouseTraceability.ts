import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse,bad,conflict,notFound} from '../http/router.ts';
import {normalizeGtin,traceInputIsHardwareAttested} from './shopGtin.ts';

const uuid=z.string().uuid();
const schema=z.object({
  lineIndex:z.number().int().min(0).max(499),
  gtin:z.string().trim().min(8).max(14),
  lot:z.string().trim().min(3).max(80).nullable().optional(),
  serials:z.array(z.string().trim().min(3).max(80)).max(100).default([]),
  inputMethod:z.enum(['manual','keyboard_wedge']),
  manualReason:z.string().trim().max(500).nullable().optional()
});
const articleKey=(v:string)=>v.replace(/\s+/g,'').toLocaleUpperCase('ru-RU');

export function registerShopWarehouseTraceRoutes(r:Router,db:Db){
  r.post('/api/admin/shop/courier-runs/:id/warehouse/stops/:stopId/trace',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id),stopId=parse(uuid,c.params.stopId);
      const b=parse(schema,c.body);
      const gtin=normalizeGtin(b.gtin);
      if(!gtin)throw bad('invalid_gtin_checksum',
        'GTIN/EAN должен содержать 8, 12, 13 или 14 цифр и корректную контрольную цифру GS1');
      const lot=b.lot?.trim()||null;
      const serials=b.serials.map(x=>x.trim().toUpperCase());
      if(!lot&&serials.length===0)
        throw bad('missing_batch_or_serial','Нужен номер партии или серийные номера');
      if(serials.some(x=>!/^[A-Z0-9._/-]{3,80}$/.test(x)))
        throw bad('invalid_serial','Укажите маркировку без пробелов, ссылок и личных данных');
      if(lot&&!/^[A-Za-z0-9А-Яа-яЁё._/-]{3,80}$/.test(lot))
        throw bad('invalid_lot','Партия должна содержать только символы маркировки');
      if(new Set(serials).size!==serials.length)
        throw bad('duplicate_serial','Серийные номера одной строки не должны повторяться');
      if(b.inputMethod==='manual'&&(b.manualReason??'').trim().length<15)
        throw bad('trace_manual_reason','Ручная запись должна иметь объяснение от 15 символов');
      return db.tx(async q=>{
        // All trace changes, scans, discrepancies, cancellation and dispatch
        // serialize through the same parent route lock.
        const run=await q.one<{
          id:string;status:string;packing_required:boolean;
          traceability_required:boolean;dispatch_approved_at:Date|null
        }>('select id,status,packing_required,traceability_required,dispatch_approved_at '+
          'from shop_courier_runs where id=$1 for update',[runId]);
        if(!run)throw notFound('Рейс не найден');
        if(!run.traceability_required||!run.packing_required)
          throw conflict('trace_not_enabled',
            'Для этого рейса контроль GTIN и партии при планировании не включён');
        if(run.status!=='planned'||run.dispatch_approved_at)
          throw conflict('route_locked','Маркировка фиксируется только до утверждения рейса');
        const stop=await q.one<{items:unknown;status:string}>(
          'select o.items,s.status from shop_courier_stops s '+
          'join shop_orders o on o.id=s.shop_order_id '+
          'where s.run_id=$1 and s.id=$2 for update of s,o',[runId,stopId]);
        if(!stop)throw notFound('Посылка не входит в рейс');
        if(stop.status!=='awaiting_pickup')
          throw conflict('parcel_collected','Посылка уже передана курьеру');
        const item=Array.isArray(stop.items)?stop.items[b.lineIndex]:null;
        if(!item)throw bad('line_not_found','Строка заказа не найдена');
        const article=String(item.article??'').trim(),qty=Number(item.qty);
        if(article.length<2||!Number.isSafeInteger(qty)||qty<1)
          throw conflict('invalid_order_line','Не задан подтверждённый состав заказа');
        if(serials.length>0&&serials.length!==qty)
          throw bad('serial_count_mismatch',
            'Для серийного учёта нужен один уникальный серийный номер каждой заказанной единицы');
        const check=await q.one<{checked_article:string;checked_qty:number;checked_at:Date}>(
          'select checked_article,checked_qty,checked_at from shop_warehouse_line_checks '+
          'where stop_id=$1 and line_index=$2 for update',[stopId,b.lineIndex]);
        if(!check||articleKey(check.checked_article)!==articleKey(article)||
           check.checked_qty!==qty)
          throw conflict('packing_check_required',
            'Сначала фактически сверьте артикул и количество');
        if(await q.one(
          "select 1 from shop_warehouse_discrepancies "+
          "where stop_id=$1 and line_index=$2 and status='open'",
          [stopId,b.lineIndex]))
          throw conflict('open_warehouse_discrepancy',
            'Открытое складское расхождение блокирует регистрацию маркировки');
        if(serials.length){
          // No serial number may be claimed twice for one GTIN on the same route.
          const reused=await q.one(
            'select 1 from shop_warehouse_line_traces t '+
            'join shop_courier_stops s on s.id=t.stop_id '+
            'where s.run_id=$1 and (t.stop_id<>$2 or t.line_index<>$3) '+
            'and t.gtin=$4 and t.serials && $5::text[] limit 1',
            [runId,stopId,b.lineIndex,gtin,serials]);
          if(reused)
            throw conflict('serial_already_recorded',
              'Эта серийная маркировка уже указана в другой посылке рейса');
        }
        // Re-identifying the physical lot invalidates any earlier manual
        // supplier-invoice attribution, even if the barcode text is unchanged.
        await q.query('delete from shop_warehouse_trace_receipt_allocations '+
          'where stop_id=$1 and line_index=$2',[stopId,b.lineIndex]);
        const saved=await q.one<{recorded_at:Date}>(
          'insert into shop_warehouse_line_traces '+
          '(stop_id,line_index,article_snapshot,qty_snapshot,gtin,lot,serials,'+
          'input_method,manual_reason,recorded_by) '+
          'values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '+
          'on conflict(stop_id,line_index) do update set '+
          'article_snapshot=excluded.article_snapshot,qty_snapshot=excluded.qty_snapshot,'+
          'gtin=excluded.gtin,lot=excluded.lot,serials=excluded.serials,'+
          'input_method=excluded.input_method,manual_reason=excluded.manual_reason,'+
          'recorded_by=excluded.recorded_by,recorded_at=clock_timestamp() '+
          'returning recorded_at',
          [stopId,b.lineIndex,article,qty,gtin,lot,serials,
            b.inputMethod,b.inputMethod==='manual'?b.manualReason??null:null,c.user.id]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.warehouse_trace_recorded',stopId,
            {runId,lineIndex:b.lineIndex,gtin,lot,serialCount:serials.length,
              inputMethod:b.inputMethod}]);
        return {stopId,lineIndex:b.lineIndex,gtin,lot,serialCount:serials.length,
          recordedAt:saved?.recorded_at,traceRecorded:true,
          hardwareScannerAttested:traceInputIsHardwareAttested,
          supplierOrOemAuthenticityConfirmed:false,financialChanges:false};
      });
    });
}
