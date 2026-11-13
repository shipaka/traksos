// Real insurance UI backed by *only* browser-local training records in admin preview.
// Never import production API here. Unknown requests fail closed; no real insurance, payments, SMS.
import {ApiError} from '../api.ts';
export const PREVIEW_ROOT='admin/test-center/insurer';
export const PREVIEW_AGENT='#/'+PREVIEW_ROOT;
export const PREVIEW_CLIENT='#/'+PREVIEW_ROOT+'/client';
export const PREVIEW_NEW=PREVIEW_CLIENT+'/new';
export const demoVehicleId='demo-insurance-truck';
const now=()=>new Date().toISOString();
const fail=(message:string):never=>{throw new ApiError(400,'demo_error',message);};
export function insurerPreviewActive(){return location.hash.replace(/^#\/?/,'').startsWith(PREVIEW_ROOT);}
export function insurerPreviewClient(){return location.hash.replace(/^#\/?/,'').startsWith(PREVIEW_ROOT+'/client');}
export function insurerPreviewRequestHref(id:string,client=false){
 return (client?PREVIEW_CLIENT:PREVIEW_AGENT)+(client?'/request/':'/insurance/request/')+id;
}
type Case={id:string;owner_id:string;assigned_to:string;kind:'insurance';status:string;
 insurance_stage:string;insurance_choice_id:string|null;insurance_details:{
 applicant:{lastName:string;firstName:string;middleName:string};
 vehicle:Record<string,string>;consentAt:string};
 brand:string;model:string;plate:string;year:number;created_at:string;updated_at:string;
 comment:string;agent_name:string;policy_expires_on:string|null};
type Proposal={id:string;company:string;product:string;premium_kopecks:number;description:string;coverage:string;created_at:string};
type Message={id:number;kind:'status'|'message'|'offers'|'selection'|'policy';sender:'agent'|'client'|'system';
 body:string;created_at:string};
type RecordItem={request:Case;proposals:Proposal[];messages:Message[];pdf:Blob|null};
const clone=<T>(x:T):T=>structuredClone(x);
const vehicle={id:demoVehicleId,brand:'Scania',model:'R520',year:2019,plate:'А123АА78',
 trailer_plate:'В678ВВ78',vin:'YS2R4X20001234567'};
const truckData={brand:vehicle.brand,model:vehicle.model,year:String(vehicle.year),vin:vehicle.vin,
 plate:vehicle.plate,category:'N3',bodyType:'Седельный тягач',enginePower:'520',
 maximumMass:'19000',emptyMass:'8600',chassisNumber:'R520-7788',
 engineNumber:'DC13',registrationCertificate:'78АВ123456',
 trailerPlate:vehicle.trailer_plate,registrationRegion:'Санкт-Петербург',
 usage:'Междугородные грузовые перевозки'};
const ticket=(id:string,stage:string,brand=vehicle.brand,model=vehicle.model,plate=vehicle.plate):RecordItem=>({
 request:{id,owner_id:'demo-customer',assigned_to:'demo-agent',kind:'insurance',
  status:'sent_to_partner',insurance_stage:stage,insurance_choice_id:null,
  insurance_details:{applicant:{lastName:'Иванов',firstName:'Иван',middleName:'Иванович'},
   vehicle:{...truckData,brand,model,plate},consentAt:now()},
  brand,model,plate,year:2019,created_at:now(),updated_at:now(),comment:'ОСАГО для юридического лица',
  agent_name:'Демо · Страховой партнёр',policy_expires_on:null},
 proposals:[],messages:[{id:1,kind:'status',sender:'system',body:'Получено страховым агентом',
  created_at:now()}],pdf:null});
const seed=():RecordItem[]=>[ticket('demo-insurance-1','received')];
let records=seed();
let counter=20, messageId=100;
const item=(id:string)=>records.find(r=>r.request.id===id)??fail('Тестовая заявка не найдена');
const view=(r:RecordItem,client=insurerPreviewClient())=>{
 const d=clone({request:r.request,proposals:r.proposals,messages:r.messages.map(m=>({
  ...m,sender:m.sender==='system'?'system':client?(m.sender==='client'?'you':'agent'):
   (m.sender==='agent'?'you':'client')})),hasPolicy:!!r.pdf,isClient:client,isPartner:!client});
 return d;
};
const emit=(r:RecordItem)=>{r.request.updated_at=now();window.dispatchEvent(new CustomEvent('traksos-insurance-preview-change',{detail:{id:r.request.id}}));};
const log=(r:RecordItem,kind:Message['kind'],sender:Message['sender'],body:string)=>{
 r.messages.push({id:++messageId,kind,sender,body,created_at:now()});
};
export function resetInsurerPreview(){records=seed();counter=20;messageId=100;}
export function insurerPreviewPdf(id:string):Blob{
 const pdf=item(id).pdf;if(!pdf)return fail('Полис ещё не загружен');return pdf;
}
function assertSide(client:boolean){if(insurerPreviewClient()!==client)return fail('Откройте соответствующий вид в верхней тестовой панели');}
export async function previewInsurerApi(method:'GET'|'POST'|'PATCH',path:string,body:any={}):Promise<any>{
 if(!insurerPreviewActive())return fail('Недоступно вне тестового режима');
 const p=path.split('?')[0];
 if(method==='GET'&&p==='/api/insurance/agents')
  return [{id:'demo-agent',name:'Демо · Страховой партнёр'}];
 if(method==='GET'&&p==='/api/vehicles')return [clone(vehicle)];
 if(method==='GET'&&p==='/api/insurer/requests'){
  assertSide(false);
  return records.map(x=>clone({...x.request,...x.request.insurance_details.vehicle,insurance_stage:x.request.insurance_stage,
   id:x.request.id,created_at:x.request.created_at,staff_note:'',
   policy_expires_on:x.request.policy_expires_on}));
 }
 if(method==='POST'&&p==='/api/vehicle-service-requests'){
  assertSide(true);
  if(body.kind!=='insurance'||body.vehicleId!==demoVehicleId||body.insurance?.agentId!=='demo-agent'
     ||body.insurance.consentToPartner!==true) return fail('Выберите агента и подтвердите передачу данных');
  const d=body.insurance.details;
  if(!d?.applicant?.firstName?.trim()||!d?.applicant?.lastName?.trim()||!d?.vehicle?.vin?.trim()||
     !d?.vehicle?.plate?.trim())return fail('Заполните анкету страхователя и грузовика');
  const r=ticket('demo-insurance-'+(++counter),'received',d.vehicle.brand,d.vehicle.model,d.vehicle.plate);
  r.request.insurance_details=clone({...d,consentAt:now()});r.request.comment=String(body.comment??'');
  records.unshift(r);emit(r);return {id:r.request.id,insurance_stage:'received'};
 }
 const m=/^\/api\/insurance\/requests\/([^/]+)(?:\/(accept|offers|choose|messages|policy))?$/.exec(p);
 if(!m)return fail('Внешние действия недоступны в страховой песочнице');
 const r=item(m[1]),action=m[2]??'';
 if(method==='GET'&&!action)return view(r);
 if(method==='GET'&&action==='policy')return fail('Используйте локальную кнопку скачивания PDF');
 if(method!=='POST')return fail('Изменение тестовой заявки недоступно');
 if(action==='accept'){
  assertSide(false);
  const stage=r.request.insurance_stage;
  if(stage!=='received'&&stage!=='selected')return fail('Сначала дождитесь заявки или выбора клиента');
  r.request.insurance_stage=stage==='received'?'preparing':'processing';
  log(r,'status','agent',stage==='received'?'Принято в работу: подготовка предложений':'Принято в работу: оформление полиса');
 }else if(action==='offers'){
  assertSide(false);
  if(r.request.insurance_stage!=='preparing')return fail('Заявка пока не на этапе предложений');
  if(!Array.isArray(body.offers)||body.offers.length<1||body.offers.length>20)return fail('От одного до 20 предложений');
  for(const x of body.offers)if(!x.company?.trim()||!x.product?.trim()||
    !Number.isInteger(x.premiumKopecks)||x.premiumKopecks<=0)return fail('Укажите компанию, название и стоимость');
  r.proposals=body.offers.map((o:Proposal,index:number)=>({
   ...o,id:'demo-proposal-'+r.request.id+'-'+index,created_at:now()}));
  r.request.insurance_stage='offers_sent';log(r,'offers','agent','Отправлено предложений: '+r.proposals.length);
 }else if(action==='choose'){
  assertSide(true);
  if(r.request.insurance_stage!=='offers_sent')return fail('Предложения ещё не готовы');
  const o=r.proposals.find(p=>p.id===body.proposalId);
  if(!o)return fail('Выберите предложение из списка');
  r.request.insurance_choice_id=o.id;r.request.insurance_stage='selected';
  log(r,'selection','client','Выбран полис: '+o.company+' · '+o.product);
 }else if(action==='messages'){
  const value=String(body.message??'').trim();
  if(!value||value.length>2000)return fail('Введите сообщение длиной до 2000 символов');
  log(r,'message',insurerPreviewClient()?'client':'agent',value);
 }else if(action==='policy'){
  assertSide(false);
  if(r.request.insurance_stage!=='processing'||!r.request.insurance_choice_id)
   return fail('Сначала клиент должен выбрать полис, затем агент примет его в работу');
  if(!/^data:application\/pdf;base64,[a-zA-Z0-9+/=]+$/.test(body.dataUrl||''))
    return fail('Нужен PDF-файл');
  const encoded=String(body.dataUrl).split(',')[1];
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  if(bytes.length<100||bytes.length>4*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')
   return fail('PDF-файл должен быть настоящим и размером до 4 МБ');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn))return fail('Укажите дату окончания полиса');
  r.pdf=new Blob([bytes],{type:'application/pdf'});
  r.request.policy_expires_on=body.expiresOn;
  r.request.status='completed';r.request.insurance_stage='policy_sent';
  log(r,'policy','agent','Готовый PDF-полис прикреплён к переписке');
 }else return fail('Неизвестная операция');
 emit(r);return {stage:r.request.insurance_stage,ok:true};
}
