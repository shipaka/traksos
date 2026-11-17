import {z} from 'zod';
import type {Db,Queryable} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse,bad,notFound,conflict} from '../http/router.ts';

const uuid=z.string().uuid();
const scanInput=z.object({
  lineIndex:z.number().int().min(0).max(499),
  article:z.string().trim().min(2).max(100),
  quantity:z.number().int().min(1).max(10000),
  method:z.enum(['scanner','manual']),
  manualReason:z.string().trim().max(500).nullable().optional(),
});
const key=(article:string)=>article.trim().replace(/\s+/g,'').toLocaleUpperCase('ru-RU');
type Stop={stop_id:string;shop_order_id:string;number:number;items:unknown;status:string};
type Check={stop_id:string;line_index:number;checked_article:string;checked_qty:number;
  method:string;checked_at:Date;manual_reason:string|null};
type Discrepancy={id:string;stop_id:string;line_index:number;kind:string;note:string;
  observed_article:string;observed_qty:number;reported_at:Date;status:string};
type WarehouseLine={index:number;name:string;brand:string|null;article:string|null;
  quantity:number;verified:boolean;method:string|null;checkedAt:Date|null;blockedReason:string|null;
  recheckedAfterDiscrepancy:boolean;
  openDiscrepancy:{id:string;kind:string;note:string;observedArticle:string;
    observedQty:number;reportedAt:Date}|null};
type WarehouseStop={id:string;orderNumber:number;status:string;lines:WarehouseLine[]};
type Run={id:string;status:string;packing_required:boolean;dispatch_approved_at:Date|null};

/** No checkout amount, price, client identity, address, phone or GPS leaves this service. */
export async function warehouseProgress(q:Queryable,runId:string){
  const run=await q.one<Run>(
    'select id,status,packing_required,dispatch_approved_at from shop_courier_runs where id=$1',[runId]);
  if(!run)throw notFound('Рейс не найден');
  const [stops,checks,exceptions]=await Promise.all([
    q.query<Stop>(
      'select s.id as stop_id,s.shop_order_id,o.number,o.items,s.status '+
      'from shop_courier_stops s join shop_orders o on o.id=s.shop_order_id '+
      'where s.run_id=$1 order by s.seq',[runId]),
    q.query<Check>(
      'select c.* from shop_warehouse_line_checks c '+
      'join shop_courier_stops s on s.id=c.stop_id where s.run_id=$1',[runId]),
    q.query<Discrepancy>(
      "select d.id,d.stop_id,d.line_index,d.kind,d.note,d.observed_article,"+
      "d.observed_qty,d.reported_at,d.status from shop_warehouse_discrepancies d "+
      "join shop_courier_stops s on s.id=d.stop_id "+
      "where s.run_id=$1 and d.status='open'",[runId])
  ]);
  const checked=new Map(checks.map(c=>[c.stop_id+':'+c.line_index,c]));
  const open=new Map(exceptions.map(d=>[d.stop_id+':'+d.line_index,d]));
  let remaining=0,total=0;
  const output:WarehouseStop[]=stops.map(st=>{
    const raw=Array.isArray(st.items)?st.items:[] as any[];
    const lines:WarehouseLine[]=raw.map((item:any,index:number)=>{
      const article=typeof item.article==='string'?item.article.trim():null;
      const qty=Number(item.qty);
      const expected=article&&article.length>=2&&Number.isSafeInteger(qty)&&qty>0;
      const confirmed=checked.get(st.stop_id+':'+index);
      const discrepancy=open.get(st.stop_id+':'+index);
      const recheckedAfterDiscrepancy=Boolean(expected&&discrepancy&&confirmed&&
        key(confirmed.checked_article)===key(article!)&&confirmed.checked_qty===qty&&
        confirmed.checked_at>discrepancy.reported_at);
      const verified=Boolean(expected&&!discrepancy&&confirmed&&
        key(confirmed.checked_article)===key(article!)&&confirmed.checked_qty===qty);
      if(!verified)remaining++;
      total++;
      return {index,name:String(item.name??'Товар'),brand:item.brand??null,
        article,quantity:qty,verified,recheckedAfterDiscrepancy,
        method:verified?confirmed!.method:null,
        checkedAt:verified?confirmed!.checked_at:null,
        openDiscrepancy:discrepancy?{
          id:discrepancy.id,kind:discrepancy.kind,note:discrepancy.note,
          observedArticle:discrepancy.observed_article,observedQty:discrepancy.observed_qty,
          reportedAt:discrepancy.reported_at
        }:null,
        blockedReason:discrepancy?'Открытое складское расхождение — выдача заблокирована':
          !expected?'Не указан пригодный артикул или количество в заказе':
          verified?null:'Требуется физическая сверка артикула и количества'};
    });
    if(!Array.isArray(st.items)||lines.length===0)remaining++;
    return {id:st.stop_id,orderNumber:st.number,status:st.status,lines};
  });
  return {runId,packingRequired:run.packing_required,runStatus:run.status,
    dispatchApproved:Boolean(run.dispatch_approved_at),stops:output,
    totalLines:total,remainingLines:remaining,
    openDiscrepancies:exceptions.length,
    ready:stops.length>0&&total>0&&remaining===0&&exceptions.length===0,
    warning:'Сверка подтверждает только совпадение артикула и количества с заказом. Она не подтверждает качество, оригинальность, применяемость детали или фактическое содержимое закрытой коробки.'};
}

export function registerShopWarehouseRoutes(r:Router,db:Db){
  r.get('/api/admin/shop/courier-runs/:id/warehouse',['admin'],async(c:AuthedCtx)=>{
    const runId=parse(uuid,c.params.id);
    return warehouseProgress(db,runId);
  });

  r.post('/api/admin/shop/courier-runs/:id/warehouse/stops/:stopId/verify',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id);
      const stopId=parse(uuid,c.params.stopId);
      const b=parse(scanInput,c.body);
      if(b.method==='manual'&&(b.manualReason??'').length<15)
        throw bad('manual_check_reason','Ручная сверка без сканера требует объяснение не короче 15 символов');
      return db.tx(async q=>{
        // Lock the parent route: admin verification and dispatch approval are
        // mutually exclusive operations even on multiple server instances.
        const run=await q.one<Run>(
          'select id,status,packing_required,dispatch_approved_at from shop_courier_runs where id=$1 for update',[runId]);
        if(!run)throw notFound('Рейс не найден');
        if(!run.packing_required)
          throw conflict('packing_not_enabled','На этом рейсе проверка по артикулам не включена');
        if(run.status!=='planned'||run.dispatch_approved_at)
          throw conflict('route_locked','Сверять комплектацию можно только до утверждения рейса');
        const stop=await q.one<Stop>(
          'select s.id as stop_id,s.shop_order_id,o.number,o.items,s.status '+
          'from shop_courier_stops s join shop_orders o on o.id=s.shop_order_id '+
          'where s.run_id=$1 and s.id=$2 for update of s,o',[runId,stopId]);
        if(!stop)throw notFound('Посылка не входит в выбранный рейс');
        if(stop.status!=='awaiting_pickup')
          throw conflict('parcel_collected','Посылку уже забрали');
        const raw=Array.isArray(stop.items)?stop.items:[];
        const item=raw[b.lineIndex];
        if(!item)throw bad('line_not_found','Строка состава заказа не найдена');
        const article=typeof item.article==='string'?item.article.trim():'';
        const qty=Number(item.qty);
        if(article.length<2||!Number.isSafeInteger(qty)||qty<=0)
          throw conflict('item_reference_missing','Нужно заполнить фактический артикул и количество в заказе');
        if(key(b.article)!==key(article)||b.quantity!==qty)
          throw conflict('packing_mismatch',
            'Артикул или количество не соответствует строке заказа. Не выдавайте посылку');
        const saved=await q.one<Check>(
          `insert into shop_warehouse_line_checks
           (stop_id,line_index,checked_article,checked_qty,method,manual_reason,checked_by)
           values($1,$2,$3,$4,$5,$6,$7)
           on conflict(stop_id,line_index) do update set
           checked_article=excluded.checked_article,checked_qty=excluded.checked_qty,
           method=excluded.method,manual_reason=excluded.manual_reason,
           checked_by=excluded.checked_by,checked_at=now()
           returning *`,
          [stopId,b.lineIndex,b.article.trim(),b.quantity,b.method,
            b.method==='manual'?b.manualReason??null:null,c.user.id]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.warehouse_line_checked',stopId,
            {runId,lineIndex:b.lineIndex,method:b.method,quantity:b.quantity}]);
        return {verified:true,stopId,lineIndex:b.lineIndex,method:saved?.method};
      });
    });

  const incidentInput=z.object({
    lineIndex:z.number().int().min(0).max(499),
    kind:z.enum(['wrong_article','shortage','surplus','damaged','seal_broken','other']),
    observedArticle:z.string().trim().max(100),
    observedQty:z.number().int().min(0).max(10000),
    note:z.string().trim().min(20).max(1000)
  });
  r.post('/api/admin/shop/courier-runs/:id/warehouse/stops/:stopId/discrepancies',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id),stopId=parse(uuid,c.params.stopId);
      const b=parse(incidentInput,c.body);
      return db.tx(async q=>{
        const run=await q.one<Run>(
          'select id,status,packing_required,dispatch_approved_at '+
          'from shop_courier_runs where id=$1 for update',[runId]);
        if(!run)throw notFound('Рейс не найден');
        if(!run.packing_required||run.status!=='planned'||run.dispatch_approved_at)
          throw conflict('packing_locked','Расхождение регистрируется только до утверждения строгой комплектации');
        const st=await q.one<Stop>(
          'select s.id as stop_id,s.shop_order_id,o.number,o.items,s.status '+
          'from shop_courier_stops s join shop_orders o on o.id=s.shop_order_id '+
          'where s.run_id=$1 and s.id=$2 for update of s,o',[runId,stopId]);
        if(!st)throw notFound('Посылка не входит в этот рейс');
        if(st.status!=='awaiting_pickup')
          throw conflict('parcel_collected','Посылку уже передали курьеру');
        const lines=Array.isArray(st.items)?st.items:[];
        const item=lines[b.lineIndex];
        if(!item)throw bad('line_not_found','Строка товара отсутствует');
        const expectedArticle=typeof item.article==='string'?item.article.trim():'';
        const expectedQty=Number(item.qty);
        if(expectedArticle.length<2||!Number.isSafeInteger(expectedQty)||expectedQty<1)
          throw conflict('invalid_order_line','Товар в заказе требует уточнения артикула/количества');
        if(b.kind==='wrong_article'&&key(b.observedArticle)===key(expectedArticle))
          throw bad('no_article_mismatch','Укажите реально отличающийся артикул');
        if(b.kind==='shortage'&&b.observedQty>=expectedQty)
          throw bad('no_shortage','Недовложение требует фактического количества меньше заказанного');
        if(b.kind==='surplus'&&b.observedQty<=expectedQty)
          throw bad('no_surplus','Излишек требует фактического количества больше заказанного');
        const previous=await q.one<{id:string}>(
          "select id from shop_warehouse_discrepancies where stop_id=$1 "+
          "and line_index=$2 and status='open' for update",[stopId,b.lineIndex]);
        if(previous)
          throw conflict('open_warehouse_discrepancy','По этой строке уже открыто расследование');
        const recorded=await q.one<{id:string}>(`
          insert into shop_warehouse_discrepancies
            (run_id,stop_id,order_number,line_index,kind,expected_article,expected_qty,
             observed_article,observed_qty,note,reported_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          returning id`,[runId,stopId,st.number,b.lineIndex,b.kind,
            expectedArticle,expectedQty,b.observedArticle,b.observedQty,b.note,c.user.id]);
        // A previous scan never certifies a parcel after a discrepancy is found.
        await q.query('delete from shop_warehouse_line_checks where stop_id=$1 and line_index=$2',
          [stopId,b.lineIndex]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.warehouse_discrepancy_reported',recorded!.id,
            {runId,stopId,lineIndex:b.lineIndex,kind:b.kind,
             expectedArticle,expectedQty,observedArticle:b.observedArticle,
             observedQty:b.observedQty,note:b.note}]);
        return {id:recorded!.id,stopId,lineIndex:b.lineIndex,
          status:'open',dispatchBlocked:true,financialChanges:false};
      });
    });
  r.post('/api/admin/shop/courier-runs/:id/warehouse/stops/:stopId/discrepancies/:incidentId/resolve',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id),stopId=parse(uuid,c.params.stopId);
      const incidentId=parse(uuid,c.params.incidentId);
      const b=parse(z.object({note:z.string().trim().min(20).max(1000)}),c.body);
      return db.tx(async q=>{
        const run=await q.one<Run>(
          'select id,status,packing_required,dispatch_approved_at from shop_courier_runs '+
          'where id=$1 for update',[runId]);
        if(!run)throw notFound('Рейс не найден');
        if(!run.packing_required||run.status!=='planned'||run.dispatch_approved_at)
          throw conflict('packing_locked','Нельзя закрывать складской случай после утверждения рейса');
        const st=await q.one<Stop>(
          'select s.id as stop_id,s.shop_order_id,o.number,o.items,s.status '+
          'from shop_courier_stops s join shop_orders o on o.id=s.shop_order_id '+
          'where s.run_id=$1 and s.id=$2 for update of s,o',[runId,stopId]);
        if(!st)throw notFound('Посылка не входит в этот рейс');
        if(st.status!=='awaiting_pickup')
          throw conflict('parcel_collected','Посылку уже забрали');
        const d=await q.one<{
          id:string;line_index:number;expected_article:string;expected_qty:number;
          reported_at:Date;status:string
        }>('select * from shop_warehouse_discrepancies where id=$1 and stop_id=$2 for update',
          [incidentId,stopId]);
        if(!d)throw notFound('Случай не найден');
        if(d.status==='resolved')
          throw conflict('already_resolved','Расхождение уже закрыто');
        const raw=Array.isArray(st.items)?st.items:[];
        const item=raw[d.line_index];
        if(!item||key(String(item.article??''))!==key(d.expected_article)||
          Number(item.qty)!==d.expected_qty)
          throw conflict('order_line_changed',
            'Состав заказа изменился. Требуется новая проверка заказа и пересоздание складского задания');
        const checked=await q.one<Check>(
          'select * from shop_warehouse_line_checks where stop_id=$1 and line_index=$2 for update',
          [stopId,d.line_index]);
        if(!checked||key(checked.checked_article)!==key(d.expected_article)||
          checked.checked_qty!==d.expected_qty||checked.checked_at<=d.reported_at)
          throw conflict('fresh_recheck_required',
            'После выявления расхождения нужна новая физическая сверка правильного артикула и количества');
        await q.query(`
          update shop_warehouse_discrepancies set status='resolved',
          resolved_by=$2,resolution_note=$3,resolved_at=clock_timestamp() where id=$1`,
          [incidentId,c.user.id,b.note]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.warehouse_discrepancy_resolved',incidentId,
            {runId,stopId,lineIndex:d.line_index,note:b.note}]);
        return {id:incidentId,status:'resolved',runId,financialChanges:false};
      });
    });
  r.get('/api/admin/shop/courier-runs/:id/warehouse/discrepancies',
    ['admin'],async(c:AuthedCtx)=>{
      const runId=parse(uuid,c.params.id);
      if(!await db.one('select 1 from shop_courier_runs where id=$1',[runId]))
        throw notFound('Рейс не найден');
      const rows=await db.query(`
        select d.id,d.stop_id,d.order_number,d.line_index,d.kind,d.expected_article,
          d.expected_qty,d.observed_article,d.observed_qty,
          d.note,d.reported_at,d.status,d.resolved_at,d.resolution_note
        from shop_warehouse_discrepancies d
        where d.run_id=$1 order by d.reported_at desc,d.id desc limit 250`,[runId]);
      return {discrepancies:rows,privateToDispatcher:true,
        financialChanges:false};
    });
}
