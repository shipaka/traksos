import { useState } from 'react';
import { API_URL, getToken, get, post, rub } from '../api.ts';

type Row = any;
const euro = (date: string) => date || new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
const toKopecks = (r: string) => {
  const s=r.replace(',','.').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Сумма должна быть в рублях, максимум две цифры после точки');
  const [whole,frac=''] = s.split('.');
  const n=Number(whole)*100+Number((frac+'00').slice(0,2));
  if (!Number.isSafeInteger(n)) throw new Error('Слишком большая сумма');
  return n;
};
function moneyField(label:string, value:string, set:(x:string)=>void) {
  return <label>{label}<input className="field" inputMode="decimal" value={value}
    onChange={e=>set(e.target.value)} placeholder="0.00" /></label>;
}
const statusText:Record<string,string>={
  awaiting_docs:'Ожидает доказательства',requires_reconciliation:'Есть расхождения / нужна сверка',
  verified:'Проверено администратором',accountant_approved:'Отмечено после проверки бухгалтером'
};
const operationKinds=[
  ['client_purchase_agent','Закупка по поручению клиента'],
  ['supplier_sales_agent','Агент поставщика (нужен договор)'],
  ['own_inventory_sale','Собственная перепродажа'],
];
const events=[['customer_receipt','Платёж клиента'],['customer_receipt_reversal','Сторно поступления'],
  ['supplier_payment','Оплата поставщику'],['supplier_payment_reversal','Сторно платежа'],
  ['customer_refund','Возврат клиенту'],['supplier_refund','Возврат поставщика'],
  ['handover','Передача товара'],['agent_report','Отчёт агента']];
const docs=[['purchase','Первичка закупки'],['mandate','Поручение/акцепт'],
  ['handover','Передача товара'],['agent_report','Отчёт агента'],['payment_proof','Подтверждение оплаты']];

export function AdminAgencyLedger() {
  const [period,setPeriod]=useState('month');
  const [from,setFrom]=useState(()=>euro(''));
  const [to,setTo]=useState(()=>euro(''));
  const [report,setReport]=useState<Row|null>(null);
  const [snapshots,setSnapshots]=useState<Row[]>([]);
  const [archiveNote,setArchiveNote]=useState('');
  const [snapshotKey,setSnapshotKey]=useState('');
  const [selected,setSelected]=useState<Row|null>(null);
  const [bankCase,setBankCase]=useState<Row|null>(null);
  const [bankName,setBankName]=useState('');
  const [bankAccountRef,setBankAccountRef]=useState('');
  const [bankFile,setBankFile]=useState<File|null>(null);
  const [bankStatements,setBankStatements]=useState<Row[]>([]);
  const [bankStatement,setBankStatement]=useState<Row|null>(null);
  const [bankRowFilter,setBankRowFilter]=useState('');
  const [bankEventId,setBankEventId]=useState('');
  const [bankNote,setBankNote]=useState('');
  const [company,setCompany]=useState('');
  const [order,setOrder]=useState('');
  const [lineIndex,setLineIndex]=useState('0');
  const [operation,setOperation]=useState('client_purchase_agent');
  const [supplier,setSupplier]=useState('Автоконтинент');
  const [article,setArticle]=useState('');
  const [clientName,setClientName]=useState('');
  const [inn,setInn]=useState('');
  const [mandate,setMandate]=useState('');
  const [mandateTime,setMandateTime]=useState('');
  const [offer,setOffer]=useState('');
  const [feeVersion,setFeeVersion]=useState('');
  const [reimburse,setReimburse]=useState('0');
  const [procurementFee,setProcurementFee]=useState('0');
  const [platformFee,setPlatformFee]=useState('0');
  const [docKind,setDocKind]=useState('purchase');
  const [docReference,setDocReference]=useState('');
  const [docDate,setDocDate]=useState(()=>new Date().toISOString().slice(0,16));
  const [docAmount,setDocAmount]=useState('0');
  const [docVat,setDocVat]=useState('0');
  const [docQty,setDocQty]=useState('0');
  const [docFile,setDocFile]=useState<File|null>(null);
  const [docId,setDocId]=useState('');
  const [docLine,setDocLine]=useState('1');
  const [allocQty,setAllocQty]=useState('0');
  const [allocAmount,setAllocAmount]=useState('0');
  const [allocVat,setAllocVat]=useState('0');
  const [eventKind,setEventKind]=useState('customer_receipt');
  const [eventAmount,setEventAmount]=useState('0');
  const [eventRef,setEventRef]=useState('');
  const [eventKey,setEventKey]=useState('');
  const [reviewNote,setReviewNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [activeForm,setActiveForm]=useState<'case'|'document'|'allocation'|'event'|null>(null);

  const perform=async (fn:()=>Promise<any>, success='Сохранено')=>{
    setError('');setNotice('');setBusy(true);
    try{const r=await fn();setNotice(success);return r;}
    catch(e:any){setError(e?.message||'Ошибка операции');return null;}
    finally{setBusy(false);}
  };
  const reload=async ()=>{
    const q=new URLSearchParams({from,to});
    const r=await perform(()=>get('/api/admin/agency/report?'+q),'Реестр обновлён');
    if(r){setReport(r);if(selected){const fresh=r.records.find((x:Row)=>x.id===selected.id);
      if(fresh)setSelected(fresh);}}
  };
  const changePeriod=(p:string)=>{
    setPeriod(p);
    if(p==='custom')return;
    const today=new Date(euro('')+'T00:00:00.000Z');
    const start=new Date(today),end=new Date(today);
    if(p==='week'){
      const mondayOffset=(start.getUTCDay()+6)%7;
      start.setUTCDate(start.getUTCDate()-mondayOffset);
      end.setUTCDate(start.getUTCDate()+6);
    }
    if(p==='month'){
      start.setUTCDate(1);
      end.setUTCMonth(start.getUTCMonth()+1,0);
    }
    setFrom(start.toISOString().slice(0,10));
    setTo(end.toISOString().slice(0,10));
  };
  const getCase=async(id:string)=>{
    const r=await perform(async()=>({
      detail:await get('/api/admin/agency/cases/'+encodeURIComponent(id)),
      bank:await get('/api/admin/agency/cases/'+encodeURIComponent(id)+'/bank'),
    }),'Цепочка доказательств открыта');
    if(r){setSelected(r.detail);setBankCase(r.bank);}
  };
  const create=async()=>{
    const r=await perform(()=>post('/api/admin/agency/cases',{
      shopOrderId:order.trim(),lineIndex:Number(lineIndex),operationKind:operation,supplierName:supplier,
      article,clientName,clientInn:inn||null,mandateRef:mandate||null,
      mandateAcceptedAt:mandateTime?new Date(mandateTime).toISOString():null,offerVersion:offer||null,
      feeScheduleVersion:feeVersion||null,
      expectedReimbursement:toKopecks(reimburse),procurementFee:toKopecks(procurementFee),
      platformFee:toKopecks(platformFee),
    }),'Операция создана — добавьте оригиналы документов');
    if(r){setActiveForm(null);await getCase(r.id);await reload();}
  };
  const fileBase64=(file:File)=>new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
    reader.onerror=()=>reject(new Error('Не удалось прочитать документ'));
    reader.readAsDataURL(file);
  });
  const upload=async()=>{
    if(!docFile){setError('Выберите оригинал документа');return;}
    if(docFile.size>450000){setError('Документ более 450 КБ: приложите уменьшенный PDF или изображение');return;}
    const r=await perform(async()=>post('/api/admin/agency/documents',{
      kind:docKind,supplierName:supplier,reference:docReference,issuedAt:new Date(docDate).toISOString(),
      amount:toKopecks(docAmount),vatAmount:toKopecks(docVat),quantity:Number(docQty),
      mime:docFile.type,base64:await fileBase64(docFile)
    }),'Документ сохранён, ожидает ручной проверки');
    if(r){setDocId(r.id);setActiveForm('allocation');}
  };
  const allocate=async()=>{
    if(!selected)return;
    const r=await perform(()=>post('/api/admin/agency/cases/'+selected.id+'/allocations',{
      documentId:docId,lineKey:docLine.trim(),quantity:Number(allocQty),
      amount:toKopecks(allocAmount),vatAmount:toKopecks(allocVat)
    }),'Документ привязан к позиции');
    if(r){setActiveForm(null);await getCase(selected.id);await reload();}
  };
  const addEvent=async()=>{
    if(!selected)return;
    const r=await perform(()=>post('/api/admin/agency/cases/'+selected.id+'/events',{
      kind:eventKind,amount:events.find(e=>e[0]===eventKind)&&['handover','agent_report'].includes(eventKind)
        ?0:toKopecks(eventAmount),
      occurredAt:new Date().toISOString(),sourceRef:eventRef.trim(),idempotencyKey:eventKey.trim()
    }),'Событие добавлено без изменения предыдущих записей');
    if(r){setActiveForm(null);await getCase(selected.id);await reload();}
  };
  const reviewDoc=async(id:string)=>{
    const r=await perform(()=>post('/api/admin/agency/documents/'+id+'/verify',{note:reviewNote.trim()}),
      'Документ прошёл ручную проверку');
    if(r&&selected){await getCase(selected.id);await reload();}
  };
  const reviewCase=async(kind:'verified'|'accountant_approved')=>{
    if(!selected)return;
    const r=await perform(()=>post('/api/admin/agency/cases/'+selected.id+'/review',{kind,note:reviewNote.trim()}),
      'Статус записан в неизменяемую историю');
    if(r){await getCase(selected.id);await reload();}
  };
  const download=async()=>{
    await perform(async()=>{
      const u=API_URL+'/api/admin/agency/report.csv?'+new URLSearchParams({from,to});
      const r=await fetch(u,{headers:{authorization:'Bearer '+(getToken()||'')},cache:'no-store'});
      if(!r.ok)throw new Error('Не удалось сформировать CSV');
      const url=URL.createObjectURL(await r.blob());
      const a=document.createElement('a');a.href=url;a.download='traksos-agency-'+from+'-'+to+'.csv';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    },'CSV скачан. Это не налоговая декларация');
  };
  const loadSnapshots=async()=>{
    const rows=await perform(()=>get('/api/admin/agency/snapshots'),'Архив снимков обновлён');
    if(rows)setSnapshots(rows);
  };
  const archive=async()=>{
    if(!report){setError('Сначала сформируйте реестр');return;}
    if(archiveNote.trim().length<8){setError('Укажите основание архивирования не короче 8 символов');return;}
    const key=snapshotKey||crypto.randomUUID();
    setSnapshotKey(key); // stable key even after an uncertain network response
    const result=await perform(()=>post('/api/admin/agency/snapshots',{
      from,to,requestKey:key,note:archiveNote.trim()
    }),'Неизменяемый снимок сохранён; это не подписанный отчёт ФНС');
    if(result){setSnapshotKey('');await loadSnapshots();}
  };
  const downloadSnapshot=async(id:string)=>{
    const result=await perform(()=>get('/api/admin/agency/snapshots/'+encodeURIComponent(id)),
      'Контрольный архив загружен');
    if(!result)return;
    const bytes=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(bytes);
    const a=document.createElement('a');a.href=url;a.download='traksos-agency-manifest-'+id+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const loadBankStatements=async()=>{
    const result=await perform(()=>get('/api/admin/agency/bank/statements'),
      'Импорты банковских операций обновлены');
    if(result)setBankStatements(result);
  };
  const bankImport=async()=>{
    if(!bankFile){setError('Выберите нормализованный CSV');return;}
    if(bankFile.size>450000){setError('CSV более 450 КБ: разбейте выписку');return;}
    const result=await perform(async()=>post('/api/admin/agency/bank/statements',{
      bankName,accountRef:bankAccountRef,filename:bankFile.name,
      base64:await fileBase64(bankFile),
    }),'CSV архивирован без каких-либо банковских проводок');
    if(result){
      await loadBankStatements();
      await openBankStatement(result.id);
    }
  };
  const openBankStatement=async(id:string)=>{
    const result=await perform(()=>get('/api/admin/agency/bank/statements/'+encodeURIComponent(id)+'/rows'),
      'Строки банковского CSV загружены');
    if(result){setBankStatement(result);setBankRowFilter('');}
  };
  const matchBankRow=async(id:string)=>{
    if(!selected||!bankEventId){setError('Выберите финансовое событие текущего заказа');return;}
    const result=await perform(()=>post('/api/admin/agency/bank/matches',{
      rowId:id,eventId:bankEventId,note:bankNote.trim(),
    }),'Сверка сохранена, предыдущая проверка версии требует обновления');
    if(result){
      await getCase(selected.id);
      if(bankStatement)await openBankStatement(bankStatement.statement.id);
      await reload();
    }
  };
  const retractBankMatch=async(id:string)=>{
    if(!selected)return;
    const result=await perform(()=>post('/api/admin/agency/bank/matches/'+id+'/retract',{
      note:bankNote.trim(),
    }),'Старая связь отозвана с сохранением истории');
    if(result){
      await getCase(selected.id);
      if(bankStatement)await openBankStatement(bankStatement.statement.id);
      await reload();
    }
  };
  const openProof=async(id:string)=>{
    await perform(async()=>{
      const r=await fetch(API_URL+'/api/admin/agency/documents/'+encodeURIComponent(id)+'/file',
        {headers:{authorization:'Bearer '+(getToken()||'')},cache:'no-store'});
      if(!r.ok)throw new Error('Нет доступа к оригиналу документа');
      const url=URL.createObjectURL(await r.blob());
      window.open(url,'_blank','noopener,noreferrer');
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    },'Оригинал открыт отдельно');
  };
  const filtered=(report?.records||[]).filter((r:Row)=>!company||
    (r.client_name+' '+(r.client_inn||'')+' '+r.shop_order_id).toLowerCase().includes(company.toLowerCase()));
  return <section className="stack">
    <p className="note"><strong>Внутренний доказательный реестр.</strong> Магазин и оплаты не включаются этим разделом.
      Котировка поставщика не считается первичкой. Расчёт налоговой базы, НДС к уплате, деклараций и КУДиР
      намеренно заблокирован до утверждения договоров и методики бухгалтером.</p>
    {error&&<p role="alert" className="note">{error}</p>}
    {notice&&<p role="status" className="note">{notice}</p>}
    <div className="card stack">
      <b>Отчётный период (МСК)</b>
      <div className="row">{[['day','День'],['week','Неделя Пн–Вс'],['month','Месяц'],['custom','Диапазон']].map(x=>
        <button className={'btn '+(period===x[0]?'':'ghost')} type="button" key={x[0]}
          onClick={()=>changePeriod(x[0])}>{x[1]}</button>)}</div>
      <div className="grid2">
        <label>С<input className="field" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPeriod('custom');}} /></label>
        <label>По<input className="field" type="date" value={to} onChange={e=>{setTo(e.target.value);setPeriod('custom');}} /></label>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={reload} disabled={busy}>Сформировать реестр</button>
        <button type="button" className="btn ghost" onClick={download} disabled={busy||!report}>Экспорт CSV</button>
      </div>
    </div>
    {report&&<>
      <div className="card stack">
        <b>Сводка · {report.from} — {report.to}</b>
        <p>Операции: {report.summary.cases}; подтверждено: {report.summary.verified};
          требуют внимания: {report.summary.unverified}</p>
        <div className="grid2">
          <span>Поступления за период: <b>{rub(report.summary.customerReceived)}</b></span>
          <span>Платежи поставщикам: <b>{rub(report.summary.supplierPaid)}</b></span>
          <span>Первичка, датированная периодом: <b>{rub(report.summary.recordedPurchases)}</b></span>
          <span>Из неё проверено на сегодня: <b>{rub(report.summary.confirmedPurchases)}</b></span>
          <span>Согласованные в периоде комиссии: <b>{rub(report.summary.feePotential)}</b></span>
          <span>Входящий НДС по первичке периода (не вычет): <b>{rub(report.summary.vatRecorded)}</b></span>
          <span>Возвраты клиентам: <b>{rub(report.summary.refunds)}</b></span>
          <span>Возвраты поставщиков: <b>{rub(report.summary.supplierRefunds)}</b></span>
        </div>
        <p className="note">{report.disclaimer}</p>
        <p className="note">SHA-256 текущего снимка доказательств: <code style={{overflowWrap:'anywhere',wordBreak:'break-all'}}>{report.manifestSha256}</code>.
          Новые документы или события могут изменить эту контрольную сумму.</p>
        <label>Основание архивирования снимка<input className="field" value={archiveNote}
          onChange={e=>setArchiveNote(e.target.value)}
          placeholder="Например, ежемесячная сверка с бухгалтером" /></label>
        <button type="button" className="btn ghost" onClick={archive}
          disabled={busy||archiveNote.trim().length<8}>Зафиксировать неизменяемый снимок</button>
      </div>
      <div className="card stack"><b>По компаниям</b>
        {report.companies.map((c:Row)=><div className="row" key={c.key}>
          <span>{c.name} {c.inn||''} · {c.count} поз. · неподтверждено {c.unverified}</span>
          <b>{rub(c.received)}</b>
        </div>)}
      </div>
      <div className="card stack"><b>По поставщикам</b>
        {report.suppliers.map((supplier:Row)=><div className="row" key={supplier.name}>
          <span>{supplier.name} · {supplier.count} поз. · первичка {rub(supplier.purchases)}</span>
          <b>Оплачено {rub(supplier.paid)}</b>
        </div>)}
      </div>
      <div className="card stack">
        <b>Операции и цепочки доказательств</b>
        <input className="field" placeholder="Фильтр: компания, ИНН, заказ"
          aria-label="Поиск в доказательном реестре" value={company} onChange={e=>setCompany(e.target.value)}/>
        {filtered.map((r:Row)=><div className="row" key={r.id}>
          <div><b>{r.client_name} · {r.article}</b><p className="note">{statusText[r.status]||r.status} · {rub(r.financial.agreedCustomerTotal)}</p></div>
          <button className="btn ghost small" onClick={()=>getCase(r.id)}>Доказательства</button>
        </div>)}
        {!filtered.length&&<p className="note">Операций за выбранный период нет.</p>}
      </div>
    </>}
    <div className="card stack">
      <b>Добавление операции (только к реальному заказу магазина)</b>
      <button className="btn ghost" onClick={()=>setActiveForm(activeForm==='case'?null:'case')}>Новая операция</button>
      {activeForm==='case'&&<>
        <label>ID заказа магазина<input className="field" value={order} onChange={e=>setOrder(e.target.value)} placeholder="UUID заказа"/></label>
        <div className="grid2">
          <label>Индекс позиции, начиная с нуля<input className="field" type="number" min="0" value={lineIndex} onChange={e=>setLineIndex(e.target.value)} /></label>
          <label>Модель<select className="field" value={operation} onChange={e=>setOperation(e.target.value)}>
            {operationKinds.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
          <label>Поставщик<input className="field" value={supplier} onChange={e=>setSupplier(e.target.value)}/></label>
          <label>Артикул<input className="field" value={article} onChange={e=>setArticle(e.target.value)}/></label>
          <label>Клиент/компания<input className="field" value={clientName} onChange={e=>setClientName(e.target.value)}/></label>
          <label>ИНН<input className="field" value={inn} onChange={e=>setInn(e.target.value)}/></label>
        </div>
        {operation!=='own_inventory_sale'&&<>
          <div className="grid2">
            <label>Номер поручения<input className="field" value={mandate} onChange={e=>setMandate(e.target.value)}/></label>
            <label>Дата и время акцепта<input className="field" type="datetime-local" value={mandateTime} onChange={e=>setMandateTime(e.target.value)}/></label>
            <label>Версия оферты<input className="field" value={offer} onChange={e=>setOffer(e.target.value)}/></label>
            <label>Версия тарифа<input className="field" value={feeVersion} onChange={e=>setFeeVersion(e.target.value)}/></label>
            {moneyField('Возмещение закупки, ₽',reimburse,setReimburse)}
            {moneyField('Вознаграждение за закупку, ₽',procurementFee,setProcurementFee)}
            {moneyField('Сервисный сбор, ₽',platformFee,setPlatformFee)}
          </div>
          <p className="note">Возмещение + оба вознаграждения должны совпадать со стоимостью выбранной позиции заказа. Значения не подставляются автоматически.</p>
        </>}
        <button className="btn" disabled={busy} onClick={create}>Зафиксировать снимок условий</button>
      </>}
    </div>
    {selected&&<div className="card stack">
      <div className="row"><b>Доказательства: {selected.article}</b><button className="btn ghost" onClick={()=>setSelected(null)}>Закрыть</button></div>
      <p className="note">Заказ {selected.shop_order_id}, позиция {selected.line_index}; версия {selected.evidence_version}.
        Статус: {statusText[selected.status]||selected.status}.</p>
      {!!selected.problems?.length&&<p className="note"><strong>Расхождения:</strong> {selected.problems.join('; ')}</p>}
      {!!selected.missing?.length&&<p className="note"><strong>Не хватает:</strong> {selected.missing.join('; ')}</p>}
      <p>Цена согласована: {rub(selected.financial.agreedCustomerTotal)} · Первичка:
        {rub(selected.financial.purchaseRecorded)} · Поступило: {rub(selected.financial.customerReceived)}</p>
      <div className="row">
        <button className="btn ghost" onClick={()=>setActiveForm('document')}>Загрузить документ</button>
        <button className="btn ghost" onClick={()=>setActiveForm('allocation')}>Привязать документ</button>
        <button className="btn ghost" onClick={()=>setActiveForm('event')}>Добавить событие</button>
      </div>
      {activeForm==='document'&&<div className="stack">
        <label>Тип документа<select className="field" value={docKind} onChange={e=>{setDocKind(e.target.value);setDocAmount('0');setDocQty('0');setDocVat('0');}}>
          {docs.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
        <div className="grid2">
          <label>Номер документа<input className="field" value={docReference} onChange={e=>setDocReference(e.target.value)}/></label>
          <label>Дата<input className="field" type="datetime-local" value={docDate} onChange={e=>setDocDate(e.target.value)}/></label>
          {docKind==='purchase'&&<>
            {moneyField('Сумма первички, ₽',docAmount,setDocAmount)}
            {moneyField('Входящий НДС, ₽',docVat,setDocVat)}
            <label>Количество<input className="field" type="number" min="0" value={docQty} onChange={e=>setDocQty(e.target.value)}/></label>
          </>}
        </div>
        <label>Оригинал PDF, PNG или JPEG до 450 КБ<input className="field" type="file" accept=".pdf,.png,.jpg,.jpeg"
          onChange={e=>setDocFile(e.target.files?.[0]||null)}/></label>
        <button className="btn" onClick={upload} disabled={busy}>Загрузить без подтверждения</button>
      </div>}
      {activeForm==='allocation'&&<div className="stack">
        <label>ID ранее загруженного документа<input className="field" value={docId} onChange={e=>setDocId(e.target.value)} /></label>
        <label>Ключ строки первички<input className="field" value={docLine} onChange={e=>setDocLine(e.target.value)} /></label>
        <div className="grid2">
          <label>Количество<input className="field" type="number" min="0" value={allocQty} onChange={e=>setAllocQty(e.target.value)} /></label>
          {moneyField('Сумма по позиции, ₽',allocAmount,setAllocAmount)}
          {moneyField('НДС по позиции, ₽',allocVat,setAllocVat)}
        </div>
        <button className="btn" disabled={busy} onClick={allocate}>Привязать к операции</button>
      </div>}
      {activeForm==='event'&&<div className="stack">
        <label>Денежное/товарное событие<select className="field" value={eventKind} onChange={e=>setEventKind(e.target.value)}>
          {events.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
        {!['handover','agent_report'].includes(eventKind)&&moneyField('Сумма события, ₽',eventAmount,setEventAmount)}
        <label>Реквизиты первичного подтверждения<input className="field" value={eventRef} onChange={e=>setEventRef(e.target.value)} /></label>
        <label>Уникальный ключ события<input className="field" value={eventKey} onChange={e=>setEventKey(e.target.value)}
          placeholder="например, банк-номер-строка" /></label>
        <button className="btn" disabled={busy} onClick={addEvent}>Добавить в журнал</button>
      </div>}
      <b>Документы и распределение по строкам</b>
      {(selected.allocations||[]).map((a:Row)=><div className="card" key={a.id}>
        <p>{a.kind} · {a.reference} · {rub(a.amount)} · {a.quantity} шт. · НДС {rub(a.vat_amount)}</p>
        <p className="note">{a.source} · SHA-256: {a.sha256}</p>
        <div className="row">
          <button className="btn ghost small" onClick={()=>openProof(a.document_id)}>Оригинал</button>
          {a.source==='manual_unverified'&&<button className="btn ghost small" onClick={()=>reviewDoc(a.document_id)} disabled={!reviewNote.trim()||busy}>Проверить документ</button>}
        </div>
      </div>)}
      <p className="note">Чтобы проверить поступление, оплату, сторно или возврат,
        загрузите оригинал «Подтверждение оплаты», укажите его номер точно как
        реквизит соответствующего денежного события, привяжите к этой операции
        и отметьте документ проверенным. Без этого подтверждать комплект нельзя.</p>
      <b>Денежные события</b>
      {(selected.events||[]).map((e:Row)=><p className="note" key={e.id}>{e.kind} · {rub(Number(e.amount))} · {e.source_ref} · {new Date(e.occurred_at).toLocaleString('ru-RU')}</p>)}
      <label>Примечание к проверке и основание<input className="field" value={reviewNote} onChange={e=>setReviewNote(e.target.value)} /></label>
      <div className="row">
        <button className="btn" disabled={busy||!reviewNote.trim()||selected.problems?.length>0||selected.missing?.length>0}
          onClick={()=>reviewCase('verified')}>Подтвердить комплект</button>
        <button className="btn ghost" disabled={busy||!reviewNote.trim()||selected.status!=='verified'}
          onClick={()=>reviewCase('accountant_approved')}>Отметить бухгалтерскую проверку</button>
      </div>
      <p className="note">Кнопки фиксируют внутреннюю проверку и не формируют налоговую декларацию. Изменение доказательств автоматически отзывает прежнее подтверждение.</p>
    </div>}
    <div className="card stack">
      <b>Сверка банковских операций · внутренний импорт</b>
      <p className="note">Импорт CSV вручную не означает проверку банком и не создаёт
        поступление, платёж или налоговое начисление. Для каждого совпадения
        сначала проверьте оригинал платёжного документа в цепочке заказа.</p>
      <p className="note">Поддерживается только нормализованный UTF-8 CSV до 1000 строк
        и 450 КБ. Первая строка строго:
        <code style={{overflowWrap:'anywhere'}}> transaction_ref;occurred_at;direction;amount_kopecks;note</code>.
        Направление: in (приход) / out (расход), дата: ISO-8601 с часовым поясом,
        сумма целым числом копеек. CSV от разных банков автоматически не распознаётся.</p>
      <div className="grid2">
        <label>Банк<input className="field" value={bankName}
          onChange={e=>setBankName(e.target.value)} placeholder="Название банка" /></label>
        <label>Идентификатор банковского счёта (только админ)<input className="field"
          value={bankAccountRef} onChange={e=>setBankAccountRef(e.target.value)}
          placeholder="Уникальный внутренний ID счёта" /></label>
      </div>
      <label>Нормализованный CSV<input className="field" type="file"
        accept=".csv,text/csv" onChange={e=>setBankFile(e.target.files?.[0]||null)}/></label>
      <div className="row">
        <button className="btn ghost" disabled={busy||!bankFile||!bankName||!bankAccountRef}
          onClick={bankImport}>Импортировать без проводок</button>
        <button className="btn ghost" disabled={busy}
          onClick={loadBankStatements}>Список импортов</button>
      </div>
      {bankStatements.map(item=><div key={item.id} className="row">
        <div><b>{item.bank_name} · {item.account_ref}</b>
          <p className="note">{item.filename} · {item.row_count} строк ·
            SHA-256 {String(item.content_sha256).slice(0,16)}…</p></div>
        <button className="btn ghost small" disabled={busy}
          onClick={()=>openBankStatement(item.id)}>Строки</button>
      </div>)}
      {bankStatement&&<>
        <b>Банк: {bankStatement.statement.bank_name} · найдено {bankStatement.rows.length} строк;
          сопоставлено {bankStatement.matched}, требуют проверки {bankStatement.unmatched}</b>
        <p className="note">{bankStatement.disclaimer}</p>
        <input className="field" placeholder="Фильтр по номеру банковской операции"
          aria-label="Фильтр банковских строк" value={bankRowFilter}
          onChange={e=>setBankRowFilter(e.target.value)}/>
        <label>Денежное событие выбранной операции
          <select className="field" value={bankEventId}
            onChange={e=>setBankEventId(e.target.value)}>
            <option value="">Выберите событие</option>
            {(bankCase?.events||[]).filter((e:Row)=>!e.match_id).map((e:Row)=>
              <option key={e.event_id} value={e.event_id}>
                {e.kind} · {rub(Number(e.amount))} · {e.source_ref}
              </option>)}
          </select>
        </label>
        <label>Основание сверки или отмены (минимум 8 символов)
          <input className="field" value={bankNote} onChange={e=>setBankNote(e.target.value)}
            placeholder="Сравнил дату, сумму, реквизит и оригинал документа" /></label>
        {(bankStatement.rows||[]).filter((r:Row)=>!bankRowFilter||
          String(r.transaction_ref).toLowerCase().includes(bankRowFilter.toLowerCase()))
          .slice(0,50).map((r:Row)=><div className="row" key={r.id}>
            <div><b>{r.transaction_ref} · {r.direction==='in'?'Приход':'Расход'}</b>
              <p className="note">{rub(Number(r.amount))} · {new Date(r.occurred_at).toLocaleString('ru-RU')}
                · {r.match_id?'Сопоставлено':'Не сопоставлено'}</p></div>
            {!r.match_id&&<button className="btn ghost small"
              disabled={busy||!selected||!bankEventId||bankNote.trim().length<8}
              onClick={()=>matchBankRow(r.id)}>Сверить</button>}
          </div>)}
        {bankStatement.rows.length>50&&<p className="note">
          В списке показано не более 50 подходящих строк. Для остальных используйте поиск по номеру.</p>}
      </>}
      {selected&&bankCase&&<>
        <b>Банк и выбранный заказ · сопоставлено {bankCase.matched} / {bankCase.events.length}</b>
        {(bankCase.events||[]).map((e:Row)=><div key={e.event_id} className="row">
          <div><b>{e.kind} · {rub(Number(e.amount))}</b>
            <p className="note">{e.source_ref} · {e.match_id?
              ('Связано: '+e.bank_name+' / '+e.account_ref):'Пока нет банковской связки'}</p></div>
          {e.match_id&&<button className="btn ghost small" disabled={busy||bankNote.trim().length<8}
            onClick={()=>retractBankMatch(e.match_id)}>Отозвать связь</button>}
        </div>)}
      </>}
    </div>
    <div className="card stack">
      <div className="row"><b>Архив контрольных снимков</b>
        <button className="btn ghost" onClick={loadSnapshots} disabled={busy}>Показать архив</button></div>
      <p className="note">Снимки сохраняют суммы и SHA-256 связанных документов без файлов первички.
        Это внутреннее доказательство состояния реестра, а не подписанная отчётность.</p>
      {snapshots.map(item=><div className="row" key={item.id}>
        <div><b>{String(item.from_day).slice(0,10)} — {String(item.to_day).slice(0,10)}</b>
          <p className="note">{item.note} · {String(item.manifest_sha256).slice(0,16)}…</p></div>
        <button type="button" className="btn ghost small" disabled={busy}
          onClick={()=>downloadSnapshot(item.id)}>JSON</button>
      </div>)}
    </div>
  </section>;
}
