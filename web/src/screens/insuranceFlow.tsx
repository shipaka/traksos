import {useEffect,useMemo,useState} from 'react';
import {API_URL,fmtTime,get,getToken,post,rub} from '../api.ts';
import {go,useAction,useLoad,useMe,Loading} from '../ui.tsx';

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
  const [applicant,setApplicant]=useState({lastName:'',firstName:'',middleName:''});
  const [truck,setTruck]=useState<Record<VehicleKey,string>>(emptyVehicle);
  const [comment,setComment]=useState('');
  const {busy,run}=useAction();
  useEffect(()=>{
    if(!me?.name)return;
    const words=me.name.trim().split(/\s+/);
    if(words.length>=2)setApplicant({lastName:words[0]||'',firstName:words[1]||'',middleName:words.slice(2).join(' ')});
  },[me?.name]);
  const vehicle=(vehicles.data??[]).find(v=>v.id===vehicleId);
  useEffect(()=>{
    if(!vehicle)return;
    setTruck(old=>({...old,brand:vehicle.brand??'',model:vehicle.model??'',
      year:String(vehicle.year??''),plate:vehicle.plate??'',trailerPlate:vehicle.trailer_plate??''}));
  },[vehicle?.id]);
  const fill=(key:VehicleKey,value:string)=>setTruck(prev=>({...prev,[key]:value}));
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(!agentId||!vehicleId||!applicant.lastName.trim()||!applicant.firstName.trim()||
      !truck.brand.trim()||!truck.model.trim()||!truck.plate.trim()||
      !/^\d{4}$/.test(truck.year)||truck.vin.trim().length<11){
      window.alert('Выберите агента и заполните все обязательные данные страхователя и грузовика.');
      return;
    }
    const result=await run(()=>post<{id:string}>('/api/vehicle-service-requests',{
      kind:'insurance',vehicleId,comment,
      insurance:{agentId,details:{applicant,vehicle:truck}},
    }),'Заявка отправлена выбранному страховому агенту');
    if(result)go('insurance/request/'+result.id);
  };
  return <main className="insurance-workflow stack">
    <a className="insurance-back" href="#/garage">← Мой гараж</a>
    <section className="insurance-workflow-hero">
      <span>TRACKSOS · СТРАХОВАНИЕ</span><h1>Заявка на страхование грузовика</h1>
      <p>Выберите агента, проверьте свои данные и сведения о технике. Предложения и готовый полис придут в переписку по этой заявке.</p>
    </section>
    <div className="banner" role="note">Страховой агент оформляет документы вручную. Расчёт и выпуск полиса через API страховой компании пока не подключены.</div>
    {(!vehicles.data||!agents.data)?<Loading error={vehicles.error||agents.error}/>:
    !vehicle?<div className="empty">Транспорт не найден в вашем гараже. Сначала добавьте машину.</div>:
    <form className="stack" onSubmit={submit}>
      <section className="card stack">
        <span className="insurance-step-title">01 · Кому отправить</span><h2>Страховой агент</h2>
        <label>Выберите партнёра
          <select className="field" value={agentId} onChange={e=>setAgentId(e.target.value)} required>
            <option value="">Выберите страхового агента</option>
            {agents.data.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {agents.data.length===0&&<span className="note">Пока нет доступных страховых агентов. Администратор должен подключить партнёра.</span>}
      </section>
      <section className="card stack">
        <span className="insurance-step-title">02 · Кто страхует</span><h2>Страхователь</h2>
        <p className="note">Данные из профиля подставлены автоматически, если были заполнены. Проверьте написание перед отправкой.</p>
        <div className="insurance-field-grid">
          {([['lastName','Фамилия'],['firstName','Имя'],['middleName','Отчество (при наличии)']] as const).map(([key,label])=>
            <label key={key}>{label}<input className="field" maxLength={90}
              required={key!=='middleName'} value={applicant[key]}
              onChange={e=>setApplicant(a=>({...a,[key]:e.target.value}))}/></label>)}
        </div>
      </section>
      <section className="card stack">
        <span className="insurance-step-title">03 · Что страхуем</span><h2>Грузовой автомобиль</h2>
        <p className="note">Все данные перечислены отдельными полями. Сведения из гаража можно проверить и дополнить. Для конкретной страховой компании агент может запросить дополнительные документы.</p>
        <div className="insurance-field-grid">
          {VEHICLE_FIELDS.map(([key,label])=><label key={key}>{label}
            <input className="field" value={truck[key]} maxLength={120} required={label.endsWith('*')}
              inputMode={key==='year'?'numeric':'text'} onChange={e=>fill(key,e.target.value)} />
          </label>)}
        </div>
      </section>
      <section className="card stack">
        <span className="insurance-step-title">04 · Дополнительно</span>
        <label>Комментарий или пожелания
          <textarea className="field" value={comment} maxLength={2000} onChange={e=>setComment(e.target.value)}
            placeholder="Тип полиса, особенности эксплуатации, вопросы для агента"/></label>
        <button className="btn insurance-main-action" type="submit" disabled={busy||!agents.data.length}>
          Отправить заявку страховому агенту
        </button>
      </section>
    </form>}
  </main>;
}

export function InsuranceThread({requestId}:{requestId:string}){
  const {me}=useMe();const {busy,run}=useAction();
  const source=useLoad(()=>get<CaseData>('/api/insurance/requests/'+requestId),
    [requestId],e=>e.type==='vehicle_service'&&e.requestId===requestId);
  const [message,setMessage]=useState('');
  const [drafts,setDrafts]=useState([{company:'',product:'',price:'',description:'',coverage:''}]);
  const [choice,setChoice]=useState('');
  const [expiresOn,setExpiresOn]=useState('');
  const [pdf,setPdf]=useState<File|null>(null);
  const d=source.data,r=d?.request;
  const stage=r?.insurance_stage||'';
  const selected=d?.proposals.find(p=>p.id===r?.insurance_choice_id);
  const isAgent=!!d?.isPartner;
  const notify=()=>source.reload();
  const send=async()=>{
    const m=message.trim();if(!m)return;
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
    <a className="insurance-back" href={isAgent?'#/insurance':'#/garage'}>← {isAgent?'К списку страховых заявок':'Мой гараж'}</a>
    {!d?<Loading error={source.error}/>:
    <>
      <section className="insurance-workflow-hero">
        <span>TRACKSOS · СТРАХОВАЯ ПЕРЕПИСКА</span>
        <h1>{r?.brand} {r?.model} · {r?.plate}</h1>
        <div className="insurance-stage"><b>{insuranceStatus(stage)}</b><span>{r?.agent_name}</span></div>
        <p>Все этапы согласования, цены и готовый полис находятся здесь. Оформление страховой компанией выполняется агентом вручную.</p>
      </section>
      {isAgent&&d.isPartner&&r?.insurance_details&&<section className="card stack">
        <span className="insurance-step-title">ДАННЫЕ ЗАЯВИТЕЛЯ</span>
        <h2>Анкета для оформления</h2>
        <div className="insurance-field-grid">
          <div><b>Страхователь</b><p>{[
            r.insurance_details.applicant?.lastName,r.insurance_details.applicant?.firstName,
            r.insurance_details.applicant?.middleName].filter(Boolean).join(' ')}</p></div>
          {Object.entries(r.insurance_details.vehicle??{}).filter(([,v])=>!!v).map(([key,value])=>
            <div key={key}><b>{VEHICLE_FIELDS.find(([k])=>k===key)?.[1]||key}</b>
              <p>{String(value)}</p></div>)}
        </div>
      </section>}
      <div className="insurance-conversation">
        <section className="insurance-conversation-feed card stack" aria-label="Переписка по страховой заявке">
          <div className="between"><h2>Переписка</h2><span className="pill">{d.messages.length} сообщений</span></div>
          {d.messages.length===0&&<div className="empty">Заявка получена. Напишите агенту вопрос.</div>}
          {d.messages.map(m=><div key={m.id} className={'insurance-message '+(m.sender==='you'?'mine':'')}>
            <small>{m.sender==='you'?'Вы':m.sender==='agent'?'Страховой агент':'Система'} · {fmtTime(m.created_at)}</small>
            <div>{m.body}</div>
          </div>)}
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
          <div className="insurance-chat-editor">
            <label>Сообщение агенту / клиенту
              <textarea className="field" maxLength={2000} rows={3} value={message}
                onChange={e=>setMessage(e.target.value)}
                placeholder="Уточнить сведения, запросить документы или ответить…" /></label>
            <button type="button" className="btn small" disabled={busy||!message.trim()||r?.status==='rejected'}
              onClick={send}>Отправить сообщение</button>
          </div>
        </section>
        <aside className="insurance-conversation-tools stack">
          <section className="card stack">
            <span className="insurance-step-title">ЭТАП ЗАЯВКИ</span><h3>{insuranceStatus(stage)}</h3>
            <div className="insurance-progress">
              {['received','preparing','offers_sent','selected','processing','policy_sent'].map((s,i)=>
                <div className={s===stage?'current':''} key={s}><span>{i+1}</span>{stepLabels[s]}</div>)}
            </div>
          </section>
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
            <p className="note">Можно отправить от 1 до 20 вариантов. Расчёт проводится агентом вне TrackSOS.</p>
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
