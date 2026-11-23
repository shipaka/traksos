import {useEffect,useMemo,useRef,useState} from 'react';
import {API_URL,fmtTime,get,getToken,post,rub} from '../api.ts';
import {go,useAction,useLoad,useMe,Loading} from '../ui.tsx';
import { INSURANCE_STAGES, insurancePresentation, insuranceStepIndex } from '../insurancePresentation.ts';

const VEHICLE_FIELDS=[
  ['brand','Марка *'],['model','Модель *'],['year','Год выпуска *'],
  ['plate','Государственный номер *'],['vin','VIN / номер рамы *'],
  ['category','Категория ТС'],['bodyType','Тип кузова / назначение'],
  ['chassisNumber','Номер шасси'],['engineNumber','Номер двигателя'],
  ['enginePower','Мощность двигателя (л. с.)'],
  ['maximumMass','Разрешённая максимальная масса (кг)'],
  ['emptyMass','Масса без нагрузки (кг)'],
  ['registrationCertificate','Серия и номер СТС'],
  ['registrationRegion','Регион регистрации'],
  ['trailerPlate','Номер прицепа / полуприцепа'],
  ['usage','Использование транспорта'],
] as const;
type VehicleKey=typeof VEHICLE_FIELDS[number][0];
type Offer={id:string;company:string;product:string;premium_kopecks:number;description:string;coverage:string};
type CaseData={request:{id:string;owner_id:string;assigned_to:string;status:string;insurance_stage:string|null;insurance_details?:any;
  insurance_choice_id:string|null;brand:string;model:string;year:number;plate:string;agent_name:string;created_at:string;policy_expires_on:string|null},
  proposals:Offer[];messages:{id:number;kind:string;body:string;created_at:string;sender:'you'|'agent'|'system'}[];
  hasPolicy:boolean;isClient:boolean;isPartner:boolean};
const stepLabels:Record<string,string>={
  received:'Получено',preparing:'Принято в работу · расчёт',
  offers_sent:'Предложения отправлены',selected:'Клиент выбрал предложение',
  processing:'Принято в работу · оформление',policy_sent:'Полис отправлен'};
const insuranceStatus=(key:string|null|undefined)=>stepLabels[key||'']??'На рассмотрении';
const emptyVehicle=()=>Object.fromEntries(VEHICLE_FIELDS.map(([name])=>[name,''])) as Record<VehicleKey,string>;

export function InsuranceApplication({vehicleId}:{vehicleId:string}){
  const {me}=useMe();
  const agents=useLoad(()=>get<{id:string;name:string}[]>('/api/insurance/agents'),[]);
  const vehicles=useLoad(()=>get<any[]>('/api/vehicles'),[]);
  const [agentId,setAgentId]=useState('');
  const [step,setStep]=useState(0);
  const formRef=useRef<HTMLFormElement>(null);
  const [validationError,setValidationError]=useState<{step:number;key:string;message:string}|null>(null);
  const reportError=(errorStep:number,key:string,message:string)=>{
    setStep(errorStep);
    setValidationError({step:errorStep,key,message});
  };
  // Step transitions can remount the target field. Focus after React paints it.
  useEffect(()=>{
    if(!validationError||validationError.step!==step)return;
    formRef.current?.querySelector<HTMLElement>('[data-insurance-field="'+validationError.key+'"]')?.focus();
  },[validationError,step]);
  const [selectedVehicleId,setSelectedVehicleId]=useState(vehicleId);
  const [showVehicleDetails,setShowVehicleDetails]=useState(false);
  const [applicant,setApplicant]=useState({lastName:'',firstName:'',middleName:''});
  const [truck,setTruck]=useState<Record<VehicleKey,string>>(emptyVehicle);
  const [comment,setComment]=useState('');
  const [consent,setConsent]=useState(false);
  const {busy,run}=useAction();
  useEffect(()=>{
    if(!me?.name)return;
    const words=me.name.trim().split(/\s+/);
    if(words.length>=2)setApplicant({lastName:words[0]||'',firstName:words[1]||'',middleName:words.slice(2).join(' ')});
  },[me?.name]);
  const vehicle=(vehicles.data??[]).find(v=>v.id===selectedVehicleId);
  useEffect(()=>{
    // Switching vehicles must not leak fields from the previously selected truck.
    if(!vehicle){setTruck(emptyVehicle());return;}
    setTruck({...emptyVehicle(),
      brand:String(vehicle.brand??''),model:String(vehicle.model??''),
      year:String(vehicle.year??''),plate:String(vehicle.plate??''),
      vin:String(vehicle.vin??vehicle.vin_code??''),
      trailerPlate:String(vehicle.trailer_plate??'')});
  },[vehicle?.id]);
  const fill=(key:VehicleKey,value:string)=>setTruck(prev=>({...prev,[key]:value}));
  const missingVehicleField=():VehicleKey|null=>{
    for(const key of ['brand','model','year','plate','vin'] as const) {
      const value=truck[key].trim();
      if(!value||(key==='year'&&!/^\d{4}$/.test(value))||
        (key==='vin'&&value.length<11))return key;
    }
    return null;
  };
  const validateStep=(index:number)=>{
    if(index===0&&!agentId){
      reportError(0,'agent','Выберите страхового агента.');return false;
    }
    if(index===1&&(!applicant.lastName.trim()||!applicant.firstName.trim())){
      const key=!applicant.lastName.trim()?'lastName':'firstName';
      reportError(1,key,key==='lastName'?'Укажите фамилию страхователя.':'Укажите имя страхователя.');
      return false;
    }
    if(index===2){
      const missing=missingVehicleField();
      if(missing){
        const label=VEHICLE_FIELDS.find(([key])=>key===missing)?.[1]?.replace(' *','')??'поле';
        reportError(2,missing,'Проверьте поле «'+label+'» и заполните его корректно.');
        return false;
      }
    }
    if(index===3&&!consent){
      reportError(3,'consent','Подтвердите согласие на передачу данных страховому партнёру.');
      return false;
    }
    return true;
  };
  const nextStep=()=>{
    if(!validateStep(step))return;
    setValidationError(null);
    setStep(v=>Math.min(3,v+1));
  };
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    for(const index of [0,1,2,3]){
      if(!validateStep(index))return;
    }
    setValidationError(null);
    const result=await run(()=>post<{id:string}>('/api/vehicle-service-requests',{
      kind:'insurance',...(selectedVehicleId?{vehicleId:selectedVehicleId}:{}),comment,
      insurance:{agentId,consentToPartner:true,details:{applicant,vehicle:truck}},
    }),'Заявка отправлена выбранному страховому агенту');
    if(result)go('insurance/request/'+result.id);
  };
  return <main className="insurance-workflow stack">
    <a className="insurance-back" href="#/garage">← Мой гараж</a>
    <section className="insurance-workflow-hero">
      <span>TRAKSOS · СТРАХОВАНИЕ</span><h1>Заявка на страхование грузовика</h1>
      <p>Выберите агента, проверьте свои данные и сведения о технике. Предложения и готовый полис придут в переписку по этой заявке.</p>
    </section>
    <div className="banner" role="note">Страховой агент оформляет документы вручную. Расчёт и выпуск полиса через API страховой компании пока не подключены.</div>
    {(!vehicles.data||!agents.data)?<Loading error={vehicles.error||agents.error}/>:
    <form ref={formRef} className="stack" onSubmit={submit} noValidate>
      <nav className="insurance-step-navigation" aria-label="Этапы страховой заявки">
        {['Агент','Страхователь','Автомобиль','Отправка'].map((label,index)=><button
          type="button" key={label} className={'btn ghost'+(step===index?' active':'')}
          aria-current={step===index?'step':undefined} disabled={index>step}
          onClick={()=>{setValidationError(null);setStep(index);}}>{index+1}. {label}</button>)}
      </nav>
      {validationError&&validationError.step===step&&
        <div className="insurance-validation-alert" id="insurance-form-error" role="alert">
          {validationError.message}
        </div>}
      {step===0&&<section className="card stack">
        <span className="insurance-step-title">01 · Кому отправить</span><h2>Страховой агент</h2>
        <label>Выберите партнёра
          <select className="field" value={agentId} data-insurance-field="agent"
            aria-invalid={validationError?.key==='agent'||undefined}
            aria-describedby={validationError?.key==='agent'?'insurance-form-error':undefined}
            onChange={e=>{setAgentId(e.target.value);setValidationError(null);}} required>
            <option value="">Выберите страхового агента</option>
            {agents.data.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {validationError?.key==='agent'&&<small className="insurance-field-inline-error">{validationError.message}</small>}
        </label>
        {agents.data.length===0&&<span className="note">Пока нет доступных страховых агентов. Администратор должен подключить партнёра.</span>}
      </section>}
      {step===1&&<section className="card stack">
        <span className="insurance-step-title">02 · Кто страхует</span><h2>Страхователь</h2>
        <p className="note">Данные из профиля подставлены автоматически, если были заполнены. Проверьте написание перед отправкой.</p>
        <div className="insurance-field-grid">
          {([['lastName','Фамилия'],['firstName','Имя'],['middleName','Отчество (при наличии)']] as const).map(([key,label])=>
            <label key={key}>{label}<input className="field" maxLength={90}
              required={key!=='middleName'} value={applicant[key]} data-insurance-field={key}
              aria-invalid={validationError?.key===key||undefined}
              aria-describedby={validationError?.key===key?'insurance-form-error':undefined}
              onChange={e=>{setApplicant(a=>({...a,[key]:e.target.value}));setValidationError(null);}}/>
              {validationError?.key===key&&<small className="insurance-field-inline-error">{validationError.message}</small>}
            </label>)}
        </div>
      </section>}
      {step===2&&<section className="card stack">
        <span className="insurance-step-title">03 · Что страхуем</span><h2>Грузовой автомобиль</h2>
        <label>Автомобиль из гаража (необязательно)
          <select className="field" value={selectedVehicleId} onChange={e=>setSelectedVehicleId(e.target.value)}>
            <option value="">Новый автомобиль — заполню данные ниже</option>
            {vehicles.data.map(v=><option key={v.id} value={v.id}>
              {[v.brand,v.model,v.year,v.plate,v.vin ? 'VIN '+String(v.vin).slice(-6) : ''].filter(Boolean).join(' · ')}
            </option>)}
          </select>
        </label>
        {!selectedVehicleId&&<p className="note">Заполните данные ниже. Если автомобиль ещё не сохранён, система проверит совпадения и добавит его в гараж при отправке заявки.</p>}
        <p className="note">Данные выбранного автомобиля подставляются автоматически. Проверьте VIN и обязательные сведения.</p>
        <div className="insurance-field-grid">
          {VEHICLE_FIELDS.filter(([,label])=>label.endsWith('*')).map(([key,label])=><label key={key}>{label}
            <input className="field" value={truck[key]} maxLength={120} required={label.endsWith('*')}
              inputMode={key==='year'?'numeric':'text'} data-insurance-field={key}
              aria-invalid={validationError?.key===key||undefined}
              aria-describedby={validationError?.key===key?'insurance-form-error':undefined}
              onChange={e=>{fill(key,e.target.value);setValidationError(null);}} />
            {validationError?.key===key&&<small className="insurance-field-inline-error">{validationError.message}</small>}
          </label>)}
        </div>
        <button className="btn ghost" type="button" aria-expanded={showVehicleDetails} onClick={()=>setShowVehicleDetails(v=>!v)}>
          {showVehicleDetails?'Скрыть дополнительные сведения':'Дополнительные сведения об автомобиле'}
        </button>
        {showVehicleDetails&&<div className="insurance-field-grid">
          {VEHICLE_FIELDS.filter(([,label])=>!label.endsWith('*')).map(([key,label])=>
            <label key={key}>{label}<input className="field" value={truck[key]} maxLength={120}
              onChange={e=>fill(key,e.target.value)}/></label>)}
        </div>}
      </section>}
      {step===3&&<section className="card stack">
        <span className="insurance-step-title">04 · Дополнительно</span>
        <label>Комментарий или пожелания
          <textarea className="field" value={comment} maxLength={2000} onChange={e=>setComment(e.target.value)}
            placeholder="Тип полиса, особенности эксплуатации, вопросы для агента"/></label>
        <label className="agree"><input type="checkbox" required checked={consent}
          data-insurance-field="consent" aria-invalid={validationError?.key==='consent'||undefined}
          aria-describedby={validationError?.key==='consent'?'insurance-form-error':undefined}
          onChange={e=>{setConsent(e.target.checked);setValidationError(null);}}/><span>Согласен на передачу указанных ФИО и данных грузовика выбранному страховому партнёру для обработки заявки. <a href="#/offer/privacy">Подробнее о данных</a></span></label>
        <button className="btn insurance-main-action" type="submit" disabled={busy||!agents.data.length}>
          Отправить заявку страховому агенту
        </button>
      </section>}
      {step<3&&<div className="insurance-wizard-actions">
        {step>0&&<button type="button" className="btn ghost" onClick={()=>{setValidationError(null);setStep(v=>v-1);}}>Назад</button>}
        <button type="button" className="btn insurance-main-action" onClick={nextStep}>Продолжить</button>
      </div>}
      {step===3&&<button type="button" className="btn ghost" onClick={()=>{setValidationError(null);setStep(2);}}>Вернуться к автомобилю</button>}
    </form>}
  </main>;
}

function InsuranceStageTimeline({ stage, activeIndex }: { stage: string; activeIndex: number }) {
  return <div className="insurance-progress" role="list" aria-label="Путь страховой заявки">
    {INSURANCE_STAGES.map((step,i)=>
      <div className={i===activeIndex?'current':i<activeIndex?'complete':'upcoming'}
        key={step} role="listitem" aria-current={step===stage?'step':undefined}>
        <span aria-hidden="true">{i<activeIndex?'✓':i+1}</span>
        <span>{stepLabels[step]}</span>
      </div>)}
  </div>;
}

export function InsuranceThread({requestId}:{requestId:string}){
  const {me}=useMe();const {busy,run}=useAction();
  const source=useLoad(()=>get<CaseData>('/api/insurance/requests/'+requestId),
    [requestId],e=>e.type==='vehicle_service'&&e.requestId===requestId);
  const [message,setMessage]=useState('');
  const [chatExpanded,setChatExpanded]=useState(false);
  const [drafts,setDrafts]=useState([{company:'',product:'',price:'',description:'',coverage:''}]);
  const [choice,setChoice]=useState('');
  const [expiresOn,setExpiresOn]=useState('');
  const [pdf,setPdf]=useState<File|null>(null);
  const d=source.data,r=d?.request;
  const stage=r?.insurance_stage||'';
  const selected=d?.proposals.find(p=>p.id===r?.insurance_choice_id);
  const isAgent=!!d?.isPartner;
  // The backend deliberately lets staff READ a dossier, but only the applicant
  // and assigned partner may SEND messages. Keep UI actions consistent with ACL.
  const isStaffViewer=!!d&&!d.isClient&&!d.isPartner;
  const isClosed=['cancelled','rejected'].includes(r?.status??'');
  const canSendMessage=!!d&&(d.isClient||d.isPartner)&&!isClosed;
  const backHref=isStaffViewer?(me?.roles.includes('admin')?'#/admin/section/vehicleServices':'#/moderation')
    :isAgent?'#/insurance':'#/garage';
  const backLabel=isStaffViewer?'К страховым обращениям':isAgent?'К списку страховых заявок':'Мой гараж';
  const status=insurancePresentation(stage,r?.status,isAgent?'partner':'client');
  const activeIndex=insuranceStepIndex(stage);
  const notify=()=>source.reload();
  const send=async()=>{
    const m=message.trim();if(!m||!canSendMessage)return;
    const v=await run(()=>post('/api/insurance/requests/'+requestId+'/messages',{message:m}),'Сообщение отправлено');
    if(v){setMessage('');notify();}
  };
  const publish=async()=>{
    const data=drafts.map(o=>({company:o.company.trim(),product:o.product.trim(),
      premiumKopecks:Math.round(Number(o.price.replace(',','.'))*100),
      description:o.description.trim(),coverage:o.coverage.trim()}));
    if(data.some(o=>!o.company||!o.product||!o.premiumKopecks||o.premiumKopecks<=0)){
      window.alert('Для каждого предложения заполните компанию, продукт и стоимость.');
      return;
    }
    const v=await run(()=>post('/api/insurance/requests/'+requestId+'/offers',{offers:data}),'Предложения отправлены клиенту');
    if(v)notify();
  };
  const upload=async()=>{
    if(!pdf||pdf.type!=='application/pdf'||pdf.size>4*1024*1024||pdf.size<100||!expiresOn){
      window.alert('Прикрепите PDF до 4 МБ и укажите дату окончания полиса.');return;
    }
    const dataUrl=await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(pdf);
    });
    const v=await run(()=>post('/api/insurance/requests/'+requestId+'/policy',{
      dataUrl,fileName:pdf.name,expiresOn}),'Готовый PDF отправлен клиенту');
    if(v){setPdf(null);notify();}
  };
  const download=async()=>{
    try{
      const response=await fetch(API_URL+'/api/insurance/requests/'+requestId+'/policy',{
        headers:{authorization:'Bearer '+(getToken()??'')},cache:'no-store'});
      if(!response.ok)throw new Error('Не удалось получить документ');
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=url;link.download='insurance-policy.pdf';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch{window.alert('Не удалось скачать PDF. Проверьте интернет и повторите.');}
  };
  const updateDraft=(i:number,key:string,value:string)=>setDrafts(prev=>prev.map((q,n)=>n===i?{...q,[key]:value}:q));
  return <main className="insurance-workflow stack">
    <a className="insurance-back" href={backHref}>← {backLabel}</a>
    {!d?<Loading error={source.error}/>:
    <>
      <section className="insurance-workflow-hero">
        <span>TRAKSOS · СТРАХОВАЯ ПЕРЕПИСКА</span>
        <h1>{r?.brand} {r?.model} · {r?.plate}</h1>
        <div className={'insurance-live-status tone-'+status.tone} aria-live="polite">
          <span className="insurance-live-orb" aria-hidden="true">{status.tone==='done'?'✓':status.tone==='action'?'!':'◉'}</span>
          <div className="insurance-live-copy">
            <span className="insurance-live-kicker">ТЕКУЩИЙ ЭТАП · {isStaffViewer?'ПРОСМОТР СОТРУДНИКА':isAgent?'КАБИНЕТ СТРАХОВЩИКА':'МОЯ СТРАХОВКА'}</span>
            <strong>{status.label}</strong>
            <p>{status.detail}</p>
            {!isStaffViewer&&<span className="insurance-live-next">{status.next}</span>}
          </div>
        </div>
        <p className="insurance-hero-footnote">Страховой агент: {r?.agent_name||'назначенный партнёр'} · Все предложения, уточнения и полис находятся в этом деле. Расчёт и выпуск полиса пока выполняются вручную.</p>
      </section>
      {isAgent&&d.isPartner&&r?.insurance_details&&<details className="card insurance-applicant-dossier">
        <summary className="insurance-dossier-toggle">
          <span className="insurance-dossier-symbol" aria-hidden="true">▤</span>
          <span><span className="insurance-step-title">ДАННЫЕ ЗАЯВИТЕЛЯ</span>
            <strong>Анкета для оформления</strong>
            <small>ФИО, VIN и сведения о грузовике · открыть досье</small>
          </span>
          <span className="insurance-dossier-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="insurance-field-grid">
          <div><b>Страхователь</b><p>{[
            r.insurance_details.applicant?.lastName,r.insurance_details.applicant?.firstName,
            r.insurance_details.applicant?.middleName].filter(Boolean).join(' ')}</p></div>
          {Object.entries(r.insurance_details.vehicle??{}).filter(([,v])=>!!v).map(([key,value])=>
            <div key={key}><b>{VEHICLE_FIELDS.find(([k])=>k===key)?.[1]||key}</b>
              <p>{String(value)}</p></div>)}
        </div>
      </details>}
      <div className="insurance-conversation">
        <section className="insurance-conversation-feed card stack" aria-label="Страховая сделка">
          {d.proposals.length>0&&<div className="insurance-offers">
            <h3>Предложения страховых компаний · {d.proposals.length}</h3>
            <p className="note">Окончательные условия и цена уточняются агентом перед выдачей полиса.</p>
            <div className="insurance-offer-grid">
              {d.proposals.map((o,i)=><div className={'insurance-offer '+(choice===o.id||r?.insurance_choice_id===o.id?'chosen':'')} key={o.id}>
                <span>Вариант {i+1}</span><h3>{o.company}</h3><b>{o.product}</b>
                <strong>{rub(o.premium_kopecks)}</strong>
                {o.coverage&&<p>{o.coverage}</p>}{o.description&&<small>{o.description}</small>}
                {d.isClient&&stage==='offers_sent'&&
                  <button className="btn ghost small" type="button" onClick={()=>setChoice(o.id)}
                    aria-pressed={choice===o.id}>{choice===o.id?'✓ Выбрано':'Выбрать'}</button>}
                {r?.insurance_choice_id===o.id&&<span className="pill good">Выбран клиентом</span>}
              </div>)}
            </div>
            {d.isClient&&stage==='offers_sent'&&
              <button className="btn" disabled={busy||!choice} type="button"
                onClick={async()=>{const v=await run(()=>post('/api/insurance/requests/'+requestId+'/choose',
                  {proposalId:choice}),'Выбор отправлен страховому агенту');if(v)notify();}}>Оформить выбранный вариант</button>}
          </div>}
          {d.hasPolicy&&<div className="insurance-policy">
            <b>✓ Готовый страховой полис</b>
            <span>Агент прикрепил итоговый PDF. Документ доступен в этой переписке.</span>
            <button type="button" className="btn" onClick={download}>Скачать PDF-полис</button>
          </div>}
          <section className="insurance-chat-panel stack" aria-label="Уточнения по заявке">
            <button type="button" className="btn ghost" aria-expanded={chatExpanded}
              onClick={()=>setChatExpanded(v=>!v)}>
              {chatExpanded?'Скрыть переписку':'Показать переписку'} · {d.messages.length}
            </button>
            {chatExpanded&&<>
              {d.messages.length===0&&<div className="empty">Сообщений пока нет.</div>}
              {d.messages.map(m=><div key={m.id} className={'insurance-message '+(m.sender==='you'?'mine':'')}>
                <small>{m.sender==='you'?'Вы':m.sender==='agent'?'Страховой агент':'Система'} · {fmtTime(m.created_at)}</small>
                <div>{m.body}</div>
              </div>)}
            </>}
          </section>
          {canSendMessage?<div className="insurance-chat-editor">
            <label>Сообщение агенту / клиенту
              <textarea className="field" maxLength={2000} rows={3} value={message}
                onChange={e=>setMessage(e.target.value)}
                placeholder="Уточнить сведения, запросить документы или ответить…" /></label>
            <button type="button" className="btn small" disabled={busy||!message.trim()}
              onClick={send}>Отправить сообщение</button>
          </div>:<div className="note" role="status">
            {isStaffViewer?'Только просмотр: отправлять сообщения могут заявитель и назначенный страховой агент.'
              :'Заявка закрыта. История переписки доступна только для чтения.'}
          </div>}
        </section>
        <aside className="insurance-conversation-tools stack">
          <section className="card stack insurance-desktop-stage-map">
            <span className="insurance-step-title">ЭТАП ЗАЯВКИ</span><h3>{insuranceStatus(stage)}</h3>
            <InsuranceStageTimeline stage={stage} activeIndex={activeIndex}/>
          </section>
          <details className="card insurance-mobile-stage-map">
            <summary className="insurance-mobile-stage-summary">
              <span className="insurance-mobile-stage-copy">
                <span className="insurance-step-title">ПУТЬ СТРАХОВОЙ ЗАЯВКИ</span>
                <strong>{activeIndex>=0?`Этап ${activeIndex+1} из ${INSURANCE_STAGES.length}`:'Этап уточняется'} · {insuranceStatus(stage)}</strong>
                <small>Показать все этапы и дальнейшие шаги</small>
                <span className="insurance-mobile-stage-progress" aria-hidden="true">
                  {INSURANCE_STAGES.map((step,i)=><span key={step} className={
                    i===activeIndex?'current':i<activeIndex?'complete':'upcoming'}/>)}
                </span>
              </span>
              <span className="insurance-mobile-stage-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="insurance-mobile-stage-expanded">
              <InsuranceStageTimeline stage={stage} activeIndex={activeIndex}/>
            </div>
          </details>
          {isAgent&&['received','selected'].includes(stage)&&<section className="card stack">
            <b>Следующий шаг</b>
            <p className="note">{stage==='received'?'Вы получили заявку. Примите её для подготовки предложений.':
              'Клиент выбрал вариант. Примите его в работу и оформите полис у страховой компании.'}</p>
            <button className="btn" type="button" disabled={busy}
              onClick={async()=>{const v=await run(()=>post('/api/insurance/requests/'+requestId+'/accept'),
                'Принято в работу');if(v)notify();}}>Принято в работу</button>
          </section>}
          {isAgent&&stage==='preparing'&&<section className="card stack">
            <b>Предложения от страховых компаний</b>
            <p className="note">Можно отправить от 1 до 20 вариантов. Расчёт проводится агентом вне TrakSOS.</p>
            {drafts.map((o,i)=><div className="insurance-quote-editor stack" key={i}>
              <b>Предложение {i+1}</b>
              {([['company','Страховая компания'],['product','Название полиса'],['price','Стоимость, ₽'],
                ['coverage','Покрытие / условия'],['description','Примечание']] as const).map(([key,label])=>
                <label key={key}>{label}<input className="field" value={o[key]}
                  inputMode={key==='price'?'decimal':'text'} maxLength={key==='price'?16:240}
                  onChange={e=>updateDraft(i,key,e.target.value)}/></label>)}
              {drafts.length>1&&<button type="button" className="btn ghost small"
                onClick={()=>setDrafts(old=>old.filter((_,n)=>n!==i))}>Удалить вариант</button>}
            </div>)}
            {drafts.length<20&&<button className="btn ghost" type="button" onClick={()=>
              setDrafts(old=>[...old,{company:'',product:'',price:'',description:'',coverage:''}])}>+ Ещё предложение</button>}
            <button className="btn" disabled={busy} type="button" onClick={publish}>Отправить {drafts.length} предложений клиенту</button>
          </section>}
          {isAgent&&stage==='processing'&&<section className="card stack">
            <b>Отправить готовый полис</b>
            <p className="note">Оформите полис у страховой компании и прикрепите полученный PDF. Файл до 4 МБ хранится в защищённом виде.</p>
            <label>Дата окончания действия<input type="date" className="field" value={expiresOn}
              onChange={e=>setExpiresOn(e.target.value)}/></label>
            <label>Файл PDF<input type="file" accept="application/pdf,.pdf" className="field"
              onChange={e=>setPdf(e.target.files?.[0]??null)}/></label>
            <button className="btn" type="button" disabled={busy||!pdf||!expiresOn} onClick={upload}>
              Отправить готовый полис клиенту</button>
          </section>}
        </aside>
      </div>
    </>}
  </main>;
}
