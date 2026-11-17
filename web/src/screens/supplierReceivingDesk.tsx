import {useState} from 'react';
import {get,post,put,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type SupplierLine={
  receipt_id:string;line_index:number;product_id:string;expected_article:string;
  expected_qty:number;observed_article:string;observed_qty:number;
  condition:'not_checked'|'intact'|'not_supplied'|'packaging_damaged'|'damaged'|'missing';
  inspection_note:string|null;inspected_at:string|null
};
type Receipt={
  id:string;shop_order_id:string;document_ref:string;document_date:string;
  evidence_note:string;status:'draft'|'accepted'|'void';
  created_at:string;accepted_at:string|null;void_reason:string|null
};
type Readiness={
  ready:boolean;lines:{lineIndex:number;productId:string;expectedQty:number;
    acceptedQty:number;remainingQty:number|null;ready:boolean}[];
  supplierApiConnected:boolean;stockMovementRecorded:boolean;warning:string
};
type List={receipts:Receipt[];readiness:Readiness};
type Detail={receipt:Receipt;lines:SupplierLine[]};
type FormLine={observedArticle:string;observedQty:string;
  condition:'intact'|'not_supplied'|'packaging_damaged'|'damaged'|'missing';
  inspectionNote:string};
const conditions={
  intact:'Совпало, товар целый',
  not_supplied:'В этой поставке не отгружено',
  packaging_damaged:'Упаковка повреждена',
  damaged:'Товар повреждён',
  missing:'Недостача / потеря'
} as const;
const emptyLine=(line:SupplierLine):FormLine=>({
  observedArticle:line.observed_article||line.expected_article,
  observedQty:String(line.observed_qty||line.expected_qty),
  condition:line.condition==='not_checked'?'intact':line.condition,
  inspectionNote:line.inspection_note??''
});

export function SupplierReceivingDesk(){
  const [orderInput,setOrderInput]=useState('');
  const [orderId,setOrderId]=useState('');
  const [documentRef,setDocumentRef]=useState('');
  const [documentDate,setDocumentDate]=useState('');
  const [evidenceNote,setEvidenceNote]=useState('');
  const [receiptId,setReceiptId]=useState('');
  const [lineDrafts,setLineDrafts]=useState<Record<string,FormLine>>({});
  const [approveNote,setApproveNote]=useState('');
  const [voidReason,setVoidReason]=useState('');
  const {busy,run}=useAction();
  const list=useLoad<List|null>(()=>orderId?
    get('/api/admin/shop/orders/'+orderId+'/supplier-receipts')
    :Promise.resolve(null),[orderId]);
  const details=useLoad<Detail|null>(()=>receiptId?
    get('/api/admin/shop/supplier-receipts/'+receiptId)
    :Promise.resolve(null),[receiptId]);

  const selectReceipt=(id:string)=>{setReceiptId(id);setLineDrafts({});
    setApproveNote('');setVoidReason('')};
  const create=async()=>{
    if(!orderId)return;
    const result=await run(()=>post('/api/admin/shop/supplier-receipts',{
      orderId,documentRef:documentRef.trim(),documentDate,
      evidenceNote:evidenceNote.trim()
    }),'Акт приёмки создан без изменения остатков');
    if(result){
      selectReceipt(result.id);setDocumentRef('');setEvidenceNote('');
      await list.reload();
    }
  };
  const saveLine=async(line:SupplierLine)=>{
    const f=lineDrafts[line.line_index]??emptyLine(line);
    const saved=await run(()=>put('/api/admin/shop/supplier-receipts/'+receiptId+
      '/lines/'+line.line_index,{
        observedArticle:f.condition==='not_supplied'?'':f.observedArticle.trim(),
        observedQty:f.condition==='not_supplied'?0:Number(f.observedQty),
        condition:f.condition,inspectionNote:f.inspectionNote.trim()
      }),'Фактическая строка записана');
    if(saved)await details.reload();
  };
  const act=async(kind:'accept'|'void')=>{
    const note=(kind==='accept'?approveNote:voidReason).trim();
    if(note.length<20)return;
    const result=await run(()=>post('/api/admin/shop/supplier-receipts/'+receiptId+'/'+kind,
      kind==='accept'?{note}:{reason:note}),
      kind==='accept'?'Акт принят; это не движение складских остатков':
        'Акт отозван, разбирательство с поставщиком зарегистрировано');
    if(result)await Promise.all([details.reload(),list.reload()]);
  };

  return <section className="card stack" aria-label="Поступление запчастей от поставщика">
    <h2>Приёмка запчастей от поставщика</h2>
    <p className="note">Здесь вручную сверяется поставка Автоконтинента с
      подтверждёнными артикулами заказа. Реального API поставщика, автоматической
      инвентаризации, оплаты накладной или увеличения остатков пока нет.
      Любую недостачу и повреждение сначала оформите как проблему.</p>
    <form className="row" style={{flexWrap:'wrap'}} onSubmit={e=>{
      e.preventDefault();setOrderId(orderInput.trim());selectReceipt('');
    }}>
      <label style={{flex:'1 1 250px'}}>ID заказа магазина
        <input className="field" value={orderInput} required
          onChange={e=>setOrderInput(e.target.value)} placeholder="UUID заказа"/>
      </label>
      <button className="btn" type="submit" disabled={!orderInput.trim()}>
        Открыть поступления
      </button>
    </form>
    {list.error&&<p role="alert">{list.error}
      <button type="button" className="btn ghost" onClick={list.reload}>Повторить</button>
    </p>}
    {list.data&&<>
      <p role="status"><strong>{list.data.readiness.ready?
        'Товары полностью подтверждены накладными':
        'Не всё заказанное количество принято'}</strong></p>
      {list.data.readiness.lines.map(l=><p key={l.lineIndex} className="note">
        Строка {l.lineIndex+1}: принято {l.acceptedQty} из {l.expectedQty};
        осталось {l.remainingQty??'уточнить'}
      </p>)}
      <form className="stack" onSubmit={e=>{e.preventDefault();void create()}}>
        <h3>Новая накладная</h3>
        <label>Номер документа поставщика
          <input className="field" minLength={3} maxLength={120} required
            value={documentRef} onChange={e=>setDocumentRef(e.target.value)}/>
        </label>
        <label>Дата документа
          <input className="field" type="date" required
            value={documentDate} onChange={e=>setDocumentDate(e.target.value)}/>
        </label>
        <label>Основание проверки документа
          <textarea className="field" rows={2} minLength={20} maxLength={1000}
            value={evidenceNote} required onChange={e=>setEvidenceNote(e.target.value)}/>
        </label>
        <button className="btn" type="submit" disabled={busy||!documentDate||
          documentRef.trim().length<3||evidenceNote.trim().length<20}>
          Создать черновик приёмки
        </button>
      </form>
      <h3>Акты по заказу</h3>
      {!list.data.receipts.length&&<p className="note">Накладных пока нет.</p>}
      <div className="row" style={{flexWrap:'wrap'}}>
        {list.data.receipts.map(r=><button className="btn ghost small"
          key={r.id} type="button" aria-pressed={r.id===receiptId}
          onClick={()=>selectReceipt(r.id)}>
          {r.document_ref} · {r.status==='draft'?'черновик':
            r.status==='accepted'?'принят':'отозван'}
        </button>)}
      </div>
    </>}
    {details.error&&<p role="alert">{details.error}
      <button className="btn ghost" type="button" onClick={details.reload}>Повторить</button>
    </p>}
    {details.data&&<div className="card stack">
      <h3>Акт {details.data.receipt.document_ref}</h3>
      <p className="note">Статус: {details.data.receipt.status}
        {' · '}{fmtTime(details.data.receipt.created_at)}.
        Принятый документ не редактируется; для отмены требуется основание.</p>
      {details.data.lines.map(line=>{
        const key=String(line.line_index),f=lineDrafts[key]??emptyLine(line);
        return <div className="card stack" key={key}>
          <strong>Строка {line.line_index+1} · {line.expected_article}
            {' · '}ожидается {line.expected_qty} шт.</strong>
          {line.inspected_at&&<p className="note">
            Последняя сверка: {fmtTime(line.inspected_at)} ·
            {line.condition} · {line.observed_qty} шт.
          </p>}
          {details.data?.receipt.status==='draft'&&<>
            <label>Артикул на фактической упаковке
              <input className="field" maxLength={120} value={f.observedArticle}
                onChange={e=>setLineDrafts(v=>({...v,[key]:{...f,
                  observedArticle:e.target.value}}))}/>
            </label>
            <label>Количество фактически полученных
              <input className="field" type="number" min={0} max={10000}
                value={f.observedQty}
                onChange={e=>setLineDrafts(v=>({...v,[key]:{...f,
                  observedQty:e.target.value}}))}/>
            </label>
            <label>Состояние
              <select className="field" value={f.condition}
                onChange={e=>setLineDrafts(v=>({...v,[key]:{...f,
                  condition:e.target.value as FormLine['condition']}}))}>
                {Object.entries(conditions).map(([k,v])=>
                  <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Объяснение (обязательно при расхождении)
              <textarea className="field" rows={2} maxLength={1000}
                value={f.inspectionNote}
                onChange={e=>setLineDrafts(v=>({...v,[key]:{...f,
                  inspectionNote:e.target.value}}))}/>
            </label>
            <button type="button" className="btn ghost" disabled={busy}
              onClick={()=>void saveLine(line)}>Зафиксировать фактическую сверку</button>
          </>}
        </div>;
      })}
      {details.data.receipt.status==='draft'&&<>
        <label>Основание подтверждения акта
          <textarea className="field" rows={2} minLength={20}
            value={approveNote} maxLength={1000}
            onChange={e=>setApproveNote(e.target.value)}/>
        </label>
        <button type="button" className="btn" disabled={busy||approveNote.trim().length<20}
          onClick={()=>void act('accept')}>
          Принять подтверждённое количество
        </button>
      </>}
      {details.data.receipt.status!=='void'&&<>
        <label>Причина отзыва документа
          <textarea className="field" rows={2} minLength={20} maxLength={1000}
            value={voidReason} onChange={e=>setVoidReason(e.target.value)}/>
        </label>
        <button type="button" className="btn ghost"
          disabled={busy||voidReason.trim().length<20}
          onClick={()=>void act('void')}>Отозвать документ с аудитом</button>
      </>}
      {details.data.receipt.void_reason&&<p className="note">
        Причина отзыва: {details.data.receipt.void_reason}
      </p>}
    </div>}
  </section>;
}
