import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {bad,conflict,notFound,parse} from '../http/router.ts';

const uuid=z.string().uuid();
const documentInput=z.object({
  orderId:uuid,documentRef:z.string().trim().min(3).max(120),
  documentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidenceNote:z.string().trim().min(20).max(1000)
});
const recordInput=z.object({
  observedArticle:z.string().trim().max(120),
  observedQty:z.number().int().min(0).max(10000),
  condition:z.enum(['intact','not_supplied','packaging_damaged','damaged','missing']),
  inspectionNote:z.string().trim().max(1000)
});
const reasonInput=z.object({reason:z.string().trim().min(20).max(1000)});
type OrderLine={productId:string;qty:number;article?:string|null};
type Order={id:string;number:number;status:string;items:OrderLine[]};
type Receipt={id:string;shop_order_id:string;document_ref:string;document_date:string;
  evidence_note:string;status:string;created_by:string|null;created_at:Date;
  accepted_at:Date|null;void_at:Date|null;void_reason:string|null};
type ReceiptLine={receipt_id:string;line_index:number;product_id:string;
  expected_article:string;expected_qty:number;observed_article:string;
  observed_qty:number;condition:string;inspection_note:string|null;
  inspected_at:Date|null};
type QueryDb=Pick<Db,'one'|'query'>;

const norm=(s:string)=>s.trim().toUpperCase().replace(/[\s-]/g,'');
async function order(db:QueryDb,id:string,lock=false){
  const row=await db.one<Order>('select id,number,status,items from shop_orders where id=$1'+
    (lock?' for update':''),[id]);
  if(!row)throw notFound('Заказ магазина не найден');
  return row;
}
export async function supplierReceiptReadiness(db:QueryDb,orderId:string){
  const o=await order(db,orderId);
  const lines=Array.isArray(o.items)?o.items:[];
  const received=await db.query<{line_index:number;product_id:string;expected_qty:number;
    delivered:number}>(`
    select l.line_index,l.product_id,l.expected_qty,
      sum(l.observed_qty)::int as delivered
    from shop_supplier_receipt_lines l
    join shop_supplier_receipts r on r.id=l.receipt_id
    where r.shop_order_id=$1 and r.status='accepted'
      and l.condition='intact'
    group by l.line_index,l.product_id,l.expected_qty`,[orderId]);
  const sum=new Map(received.map(x=>[x.line_index+':'+x.product_id,{
    qty:x.delivered,expected:x.expected_qty}]));
  const rows=lines.map((l,i)=>{
    const got=sum.get(i+':'+l.productId);
    const expected=Number(l.qty);
    const valid=Number.isSafeInteger(expected)&&expected>0&&expected<=10000;
    const delivered=got?.qty??0;
    return {lineIndex:i,productId:l.productId,expectedQty:expected,
      acceptedQty:delivered,remainingQty:valid?Math.max(0,expected-delivered):null,
      ready:Boolean(valid&&got?.expected===expected&&delivered===expected)};
  });
  const ready=lines.length>0&&rows.every(l=>l.ready);
  return {orderId,ready,lines:rows,manuallyVerified:true,
    supplierApiConnected:false,stockMovementRecorded:false,
    warning:'Акт приёмки зарегистрирован вручную. Это не подтверждение API Автоконтинента, оплаты, оригинальности или остатка магазина.'};
}
async function receipt(db:QueryDb,id:string,lock=false){
  const r=await db.one<Receipt>('select * from shop_supplier_receipts where id=$1'+
    (lock?' for update':''),[id]);
  if(!r)throw notFound('Акт приёмки не найден');
  return r;
}
async function lines(db:QueryDb,id:string){
  return db.query<ReceiptLine>(
    'select * from shop_supplier_receipt_lines where receipt_id=$1 order by line_index',[id]);
}
async function privateReceipt(db:QueryDb,id:string){
  const r=await receipt(db,id);
  return {receipt:r,lines:await lines(db,id),financialChange:false,
    supplierApiConnected:false};
}
export function registerShopSupplierReceivingRoutes(r:Router,db:Db){
  r.post('/api/admin/shop/supplier-receipts',['admin'],async(c:AuthedCtx)=>{
    const b=parse(documentInput,c.body);
    const parsed=new Date(b.documentDate+'T12:00:00Z');
    if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==b.documentDate||
      parsed.getTime()>Date.now()+86400000)
      throw bad('document_date_invalid','Дата накладной некорректна или находится в будущем');
    const result=await db.tx(async q=>{
      const o=await order(q,b.orderId,true);
      if(['cancelled','done','shipped'].includes(o.status))
        throw conflict('closed_order','Оформлять первичную приёмку можно только до отправки заказа');
      const existing=await q.one<Receipt>(
        'select * from shop_supplier_receipts where shop_order_id=$1 and document_ref=$2',
        [o.id,b.documentRef]);
      if(existing){
        if(new Date(existing.document_date).toISOString().slice(0,10)!==b.documentDate)
          throw conflict('document_reused','Номер накладной повторно использован с иной датой');
        if(existing.evidence_note!==b.evidenceNote)
          throw conflict('document_reused','У документа уже другое основание сверки');
        return {id:existing.id,created:false};
      }
      const raw=Array.isArray(o.items)?o.items:[];
      if(raw.length===0||raw.length>500)throw conflict('order_lines_invalid','Нет состава заказа для физической приёмки');
      const snapshot:{index:number;productId:string;qty:number;article:string}[]=[];
      for(const [i,item] of raw.entries()){
        if(!uuid.safeParse(item.productId).success||!Number.isSafeInteger(item.qty)||
          item.qty<1||item.qty>10000)throw conflict('order_line_invalid','Заказ содержит неподтверждённую строку товара');
        const supplier=await q.one<{supplier_article:string;verified:boolean}>(
          'select supplier_article,verified from shop_supplier_refs where product_id=$1',[item.productId]);
        if(!supplier?.verified||!supplier.supplier_article||supplier.supplier_article.trim().length<2)
          throw conflict('supplier_reference_unverified',
            'У каждой принимаемой запчасти нужен подтверждённый артикул поставщика');
        snapshot.push({index:i,productId:item.productId,qty:item.qty,
          article:supplier.supplier_article.trim()});
      }
      const saved=await q.one<{id:string}>(`
        insert into shop_supplier_receipts
          (shop_order_id,document_ref,document_date,evidence_note,created_by)
        values($1,$2,$3,$4,$5) returning id`,
        [b.orderId,b.documentRef,b.documentDate,b.evidenceNote,c.user.id]);
      for(const item of snapshot){
        await q.query(`
          insert into shop_supplier_receipt_lines
            (receipt_id,line_index,product_id,expected_article,expected_qty)
          values($1,$2,$3,$4,$5)`,
          [saved!.id,item.index,item.productId,item.article,item.qty]);
      }
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.supplier_receipt_created',saved!.id,
          {orderId:o.id,documentRef:b.documentRef,lines:snapshot.length}]);
      return {id:saved!.id,created:true};
    });
    return {...result,financialChanges:false,stockMovementRecorded:false};
  });
  r.get('/api/admin/shop/supplier-receipts/:id',['admin'],
    async(c:AuthedCtx)=>privateReceipt(db,parse(uuid,c.params.id)));
  r.get('/api/admin/shop/orders/:id/supplier-receipts',['admin'],async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id);
    await order(db,id);
    const rows=await db.query<Receipt>(
      'select * from shop_supplier_receipts where shop_order_id=$1 '+
      'order by created_at desc,id desc limit 100',[id]);
    return {receipts:rows,readiness:await supplierReceiptReadiness(db,id),
      financialChanges:false,stockMovementRecorded:false};
  });
  r.put('/api/admin/shop/supplier-receipts/:id/lines/:lineIndex',['admin'],
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id);
      const index=parse(z.coerce.number().int().min(0).max(499),c.params.lineIndex);
      const b=parse(recordInput,c.body);
      if((b.condition==='intact'&&(!b.observedArticle||b.observedQty===0))||
        (b.condition==='not_supplied'&&(b.observedQty!==0||b.observedArticle))||
        (b.condition==='missing'&&b.observedQty!==0))
        throw bad('inspection_invalid','Состояние строки и фактическое количество противоречат друг другу');
      if(b.condition!=='intact'&&b.condition!=='not_supplied'&&b.inspectionNote.length<20)
        throw bad('inspection_reason_required','Повреждение или недостача требуют письменного объяснения');
      return db.tx(async q=>{
        const initial=await receipt(q,id);
        const o=await order(q,initial.shop_order_id,true);
        const r=await receipt(q,id,true);
        if(r.status!=='draft'||['cancelled','done','shipped'].includes(o.status))
          throw conflict('receipt_locked','Акт уже принят, отозван или заказ закрыт');
        const line=await q.one<ReceiptLine>(
          'select * from shop_supplier_receipt_lines where receipt_id=$1 and line_index=$2 for update',
          [id,index]);
        if(!line)throw notFound('Товарная строка не найдена');
        if(b.condition==='intact'&&norm(b.observedArticle)!==norm(line.expected_article))
          throw conflict('supplier_article_mismatch',
            'Фактический артикул не совпадает с подтверждённым артикулом поставщика');
        const updated=await q.one<ReceiptLine>(`
          update shop_supplier_receipt_lines set observed_article=$3,
            observed_qty=$4,condition=$5,inspection_note=$6,
            inspected_by=$7,inspected_at=clock_timestamp()
          where receipt_id=$1 and line_index=$2 returning *`,
          [id,index,b.observedArticle,b.observedQty,b.condition,
            b.inspectionNote||null,c.user.id]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.supplier_receipt_line_checked',id,
            {lineIndex:index,condition:b.condition,
              observedQty:b.observedQty,observedArticle:b.observedArticle,
              note:b.inspectionNote}]);
        return {line:updated,accepted:false,financialChanges:false};
      });
    });
  r.post('/api/admin/shop/supplier-receipts/:id/accept',['admin'],
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id);
      const b=parse(z.object({note:z.string().trim().min(20).max(1000)}),c.body);
      return db.tx(async q=>{
        // Lock order BEFORE receipt consistently with line updates, ensuring
        // two parallel batches never both consume the same ordered quantity.
        const target=await receipt(q,id);
        const o=await order(q,target.shop_order_id,true);
        const r=await receipt(q,id,true);
        if(r.status!=='draft')throw conflict('receipt_locked','Акт уже принят или отозван');
        if(['cancelled','done','shipped'].includes(o.status))
          throw conflict('closed_order','Заказ уже отправлен или закрыт');
        const rows=await lines(q,id);
        if(!rows.length||rows.some(l=>!l.inspected_at))
          throw conflict('inspection_incomplete','Все позиции накладной требуют фиксации результата');
        if(rows.some(l=>!['intact','not_supplied'].includes(l.condition)))
          throw conflict('receipt_discrepancy','Обнаружено повреждение или расхождение. Акт не принимается');
        if(rows.some(l=>l.condition==='intact'&&(
          norm(l.expected_article)!==norm(l.observed_article)||l.observed_qty<=0)))
          throw conflict('receipt_mismatch','В накладной осталось несовпадение артикула');
        if(rows.every(l=>l.observed_qty===0))
          throw conflict('empty_receipt','Нельзя принимать пустую фактическую поставку');
        const history=await q.query<{line_index:number;product_id:string;received:number}>(`
          select l.line_index,l.product_id,sum(l.observed_qty)::int as received
          from shop_supplier_receipt_lines l
          join shop_supplier_receipts r on r.id=l.receipt_id
          where r.shop_order_id=$1 and r.status='accepted' and l.condition='intact'
          group by l.line_index,l.product_id`,[o.id]);
        const prior=new Map(history.map(x=>[x.line_index+':'+x.product_id,x.received]));
        const raw=Array.isArray(o.items)?o.items:[];
        for(const row of rows){
          const item=raw[row.line_index];
          if(!item||item.productId!==row.product_id||Number(item.qty)!==row.expected_qty)
            throw conflict('order_changed','Состав заказа поменялся. Акт нужно сверить с новой накладной');
          if((prior.get(row.line_index+':'+row.product_id)??0)+row.observed_qty>row.expected_qty)
            throw conflict('over_receipt','Количество по нескольким накладным превышает заказ');
        }
        await q.query(`
          update shop_supplier_receipts set status='accepted',
            accepted_by=$2,accepted_at=clock_timestamp() where id=$1`,
          [id,c.user.id]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.supplier_receipt_accepted',id,{orderId:o.id,note:b.note,
            partial:rows.some(x=>x.observed_qty<x.expected_qty)}]);
        return {id,status:'accepted',stockMovementRecorded:false,financialChanges:false,
          partial:rows.some(x=>x.observed_qty<x.expected_qty)};
      });
    });
  r.post('/api/admin/shop/supplier-receipts/:id/void',['admin'],
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id),b=parse(reasonInput,c.body);
      return db.tx(async q=>{
        const initial=await receipt(q,id);
        const o=await order(q,initial.shop_order_id,true);
        const rec=await receipt(q,id,true);
        if(rec.status==='void')throw conflict('receipt_void','Акт уже отозван');
        await q.query(`
          update shop_supplier_receipts set status='void',void_by=$2,
            void_at=clock_timestamp(),void_reason=$3 where id=$1`,
          [id,c.user.id,b.reason]);
        if(rec.status==='accepted'){
          await q.query(`
            insert into shop_supplier_order_issues(shop_order_id,needs_review,issue_kind,details)
            values($1,true,'status_conflict',$2)
            on conflict(shop_order_id) do update set
              needs_review=true,issue_kind='status_conflict',
              details=excluded.details,resolved_at=null,resolved_by=null`,
            [o.id,'Отозван ранее принятый документ '+rec.document_ref+': '+b.reason]);
        }
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'shop.supplier_receipt_voided',id,
            {orderId:o.id,priorStatus:rec.status,reason:b.reason,
              supplierIssueOpened:rec.status==='accepted'}]);
        return {id,status:'void',supplierIssueOpened:rec.status==='accepted',
          stockMovementRecorded:false,refundAutomaticallyConfirmed:false};
      });
    });
}
