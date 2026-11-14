// Closed, browser-memory-only API for the admin's FULL registered-role walkthrough.
// No data persisted to production, never sends SMS, payments, GPS or service orders.
// Every endpoint not expressly listed here fails CLOSED and never falls through to fetch.
export const PREVIEW_ROOT='admin/test-center';
export const PREVIEW_ROLES=['client','owner','driver','master','tow','master_service','insurer','moderator','admin'] as const;
export type Role=typeof PREVIEW_ROLES[number];
export function currentPreviewRole():Role|null{
  const path=location.hash.replace(/^#\/?/,'').split('?')[0].split('/');
  if(path[0]!=='admin'||path[1]!=='test-center')return null;
  return PREVIEW_ROLES.includes(path[2] as Role)?path[2] as Role:null;
}
export function previewLink(role:Role,path=''){
  return '#/'+PREVIEW_ROOT+'/'+role+(path?'/'+path.replace(/^\/+/, ''):'');
}
export function previewHref(path:string){
  const role=currentPreviewRole();return role?previewLink(role,path):'#/'+path.replace(/^\/+/,'');
}
export function previewNavigate(path:string){
  const role=currentPreviewRole();
  location.hash=role?previewLink(role,path):'#/'+path.replace(/^\/+/,'');
}
const err=(message:string):never=>{throw new Error('Тестовый режим: '+message);};
const clone=<T,>(v:T):T=>structuredClone(v);
const stamp=()=>new Date().toISOString();
let counter=100, mid=100;
export type DemoOrder={id:string;number:number;created_at:string;createdAt:string;
 service:string;status:string;description:string;address:string;brand:string;model:string;
 year:number;plate:string;vehicle:any;vehicleId:string;zoneId:string;lat:number;lng:number;
 paymentMethod:'cash';is_sos:boolean;isSos:boolean;night:boolean;tier:string;
 estimate:any;money:any;site:any;actions:string[];bill:any;points:any;result:string;
 assigned:boolean;offerPrice:number|null;messages:any[];limits:any;
 caseRootId?:string|null;continuationOf?:string|null;resultNote?:string|null};
let modCases:any[]=[
 {id:'demo-mod-1',number:801,kind:'dispute',kindName:'Спор',title:'Спор по стоимости диагностики',
  text:'Клиент просит проверить расхождение в стоимости работы.',createdAt:stamp(),
  openedBy:'Демо · Клиент',target:null,order:null,booking:null,review:null,chat:[],
  status:'open',priority:2,decisions:{warn:'Предупреждение',dismiss:'Без нарушения',resolve:'Урегулировано'},
  log:[],decisionName:null,decisionNote:null,decidedAt:null},
 {id:'demo-mod-2',number:802,kind:'appeal',kindName:'Обжалование',title:'Проверка ответа поддержки',
  text:'Запрос на повторное рассмотрение решения.',createdAt:stamp(),
  openedBy:'Демо · Выездной мастер',target:null,order:null,booking:null,review:null,chat:[],
  status:'open',priority:3,decisions:{approve:'Удовлетворить',reject:'Отклонить'},
  log:[],decisionName:null,decisionNote:null,decidedAt:null},
];
const vehicles:any[]=[
 {id:'demo-truck-1',brand:'Scania',model:'R520',year:2019,plate:'А123АА78',trailer_plate:'В987ВВ78',vin:'YS2R4X20001234567'},
 {id:'demo-truck-2',brand:'DAF',model:'XF',year:2018,plate:'М555ММ78',trailer_plate:''},
];
const samplePricing={
 nightNow:false,billingStep:30,
 tiers:{eco:{callOut:350000},comfort:{callOut:450000},pro:{callOut:550000}},
 zones:[{id:'spb',name:'Санкт-Петербург',km:0},{id:'lo',name:'Ленинградская область',km:45}],
 consult:{price:70000},towBase:3000000,
 payments:{online:false,invoice:false},fees:{clientFeePct:0},nightPct:0,
};
const estimate=(input:any)=>({
 zoneId:input?.zoneId??'spb',
 zoneName:input?.zoneId==='lo'?'Ленинградская область':'Санкт-Петербург',
 callOut:input?.service==='tow'?3000000:input?.service==='consult'?70000:input?.tier==='pro'?550000:350000,
 hour:input?.service==='tow'||input?.service==='consult'?null:220000,
 step:30,night:!!input?.night,group:!!input?.group,km:0,roadKm:0,
});
let orders:DemoOrder[]=[];
const defaultFleet=()=>({mode:'approve',perOrder:null as number|null,perMonth:null as number|null,
 allow:{repair:true,tow:true,consult:true,service:true,shop:false,insurance:true,inspection:true}});
let fleetSettings=defaultFleet();
const findOrder=(id:string)=>orders.find(o=>o.id===id)??err('Заявка не найдена');
export function resetFullPreview(){orders=[];counter=100;mid=100;vehicles.splice(2);fleetSettings=defaultFleet();modCases.forEach(x=>{x.status='open';x.decisionName=null;x.decisionNote=null;x.decidedAt=null;x.log=[];});}
const who=()=>currentPreviewRole();
const isWorker=()=>['master','tow','master_service'].includes(who()??'');
const isCustomer=()=>['client','owner','driver'].includes(who()??'');
const forceRole=(allowed:boolean)=>{if(!allowed)err('Это действие доступно только соответствующей тестовой роли');};
const workerName=()=>who()==='tow'?'Демо · Эвакуаторщик':'Демо · Выездной мастер';
const myId=()=>isWorker()?'demo-performer':'demo-customer';
const offerOf=(o:DemoOrder)=>o.offerPrice==null?[]:[{
 id:'demo-offer-'+o.id,name:'Демо · Выездной мастер',rating:4.9,rating_count:78,
 completed:132,price:o.offerPrice,diffPct:Math.round((o.offerPrice/o.limits.usual-1)*100),
 eta_minutes:35,distance_km:8.5,hour_price:o.estimate.hour,
}];
const viewOrder=(o:DemoOrder)=>{
 const actor=isWorker()?'performer':isCustomer()?'client':'admin';
 const rootId=o.caseRootId??o.id;
 const steps=orders.filter(x=>x.id===rootId || x.caseRootId===rootId)
   .sort((a,b)=>a.number-b.number);
 const caseRows=steps.map(x=>({
   id:x.id,number:x.number,service:x.service,status:x.status,
   result:x.result,resultNote:x.resultNote??null,money:clone(x.money),
 }));
 const confirmedTotal=steps.filter(x=>x.status==='completed')
   .reduce((sum,x)=>sum+Number(x.money.total??0),0);
 const canContinueWithTow=actor==='client'&&o.status==='completed'&&o.service!=='tow'&&
   ['cause_found','not_found'].includes(o.result)&&
   !steps.some(x=>x.continuationOf===o.id && x.status!=='cancelled');
 return {...clone(o),you:actor,owner_id:'demo-customer',
  caseRootId:rootId,continuationOf:o.continuationOf??null,canContinueWithTow,
  caseSummary:{rootId,stages:caseRows,serviceBookings:[],confirmedTotal,multiStage:steps.length>1},
  performer:o.assigned?{id:'demo-performer',name:workerName(),rating:4.9,rating_count:78,
   car:{brand:who()==='tow'?'MAN':'Volkswagen',plate:'Т111ТТ78'}}:null,
  client:{id:'demo-customer',name:'Демо · Клиент',company_name:'Демо Транспорт',rating:5},
  search:{candidates:1},autoPick:false,auctionUntil:null,
  consultFrom:null,consultBack:null,recommendedCenter:null,
  limits:clone(o.limits),points:{max:0,balance:0},money:clone(o.money),
  bill:clone(o.bill),actions:actor==='client'&&!['completed','cancelled'].includes(o.status)?['cancel']:[],
  };
};
const update=(o:DemoOrder)=>{o.createdAt??=o.created_at;window.dispatchEvent(new CustomEvent('traksos-sandbox-order-change',{detail:{id:o.id}}));};
export async function rolePreviewApi(method:string, path:string, body:any={}):Promise<any>{
 const role=who();
 if(!role)return err('Нет активной тестовой роли');
 const p=path.split('?')[0],qs=new URLSearchParams(path.includes('?')?path.split('?')[1]:'');
 if(method==='GET'&&p==='/api/pricing')return clone(samplePricing);
 if(method==='POST'&&p==='/api/pricing/estimate')return estimate(body);
 if(method==='GET'&&p==='/api/live')return {masters_online:2,tow_online:1,in_work:orders.filter(o=>!['completed','cancelled'].includes(o.status)).length,
  orders_24h:orders.length,done_24h:orders.filter(o=>o.status==='completed').length};
 if(method==='GET'&&p==='/api/vehicles')return clone(isWorker()?[]:vehicles);
 if(method==='POST'&&p==='/api/vehicles'){
  forceRole(isCustomer());if(!String(body.brand??'').trim())return err('Укажите марку');
  const v={id:'demo-truck-'+(++counter),brand:body.brand,model:body.model??'',
    year:body.year??null,plate:body.plate??'',trailer_plate:body.trailerPlate??''};
  vehicles.push(v);return clone(v);
 }
 if(method==='GET'&&p==='/api/fleet')return {
   settings:clone(fleetSettings),
   company:{inn:'',edoOperator:'',edoId:'',pdfOnly:true},
   cars:clone(vehicles.map(v=>({...v,qrCode:'DEMO-NOT-FOR-ENTRY',driver:null}))),
   pending:orders.filter(o=>o.status==='awaiting_owner').map(o=>({...o,driver_name:'Демо · Водитель',amount:o.estimate.callOut,owner_note:'Водитель запрашивает помощь'})),
 };
 if(method==='PUT'&&p==='/api/fleet'){
   forceRole(who()==='owner');
   fleetSettings={...fleetSettings,...clone(body)};
   return {settings:clone(fleetSettings),
    company:{inn:'',edoOperator:'',edoId:'',pdfOnly:body.edoPdfOnly??true},
    cars:clone(vehicles.map(v=>({...v,qrCode:'DEMO-NOT-FOR-ENTRY',driver:null}))),pending:orders.filter(o=>o.status==='awaiting_owner').map(o=>({...o,driver_name:'Демо · Водитель',amount:o.estimate.callOut,owner_note:'Водитель запрашивает помощь'}))};
 }
 if(method==='GET'&&p==='/api/fleet/rules')return {owner:'Демо Транспорт',...clone(fleetSettings),monthSpent:0};
 if(method==='GET'&&p==='/api/insurance-reminders/settings')return {enabled:false};
 if(method==='PUT'&&p==='/api/insurance-reminders/settings')return {enabled:!!body.enabled};
 if(method==='GET'&&p==='/api/vehicle-service-requests')return [];
 if(method==='GET'&&p==='/api/vehicles/demo-truck-1/service-history')return [];
 if(method==='GET'&&p==='/api/vehicles/demo-truck-2/service-history')return [];
 if(method==='GET'&&p==='/api/orders'){
  const byWorker=qs.get('as')==='performer'||(isWorker()&&qs.get('as')!=='client');
  return clone(orders.filter(o=>byWorker?o.assigned:!isWorker()).map(o=>({
    ...o,created_at:o.created_at,case_root_id:o.caseRootId??null,continuation_of:o.continuationOf??null
   })));
 }
 if(method==='POST'&&p==='/api/orders'){
  forceRole(isCustomer());
  const prior=body.continueFrom ? findOrder(body.continueFrom) : null;
  if(prior){
    if(body.service!=='tow'||prior.service==='tow'||prior.status!=='completed'||
      !['cause_found','not_found'].includes(prior.result))
      return err('Продолжить можно только завершённый этап мастера с невозможностью ремонта на дороге');
    if(orders.some(x=>x.continuationOf===prior.id && x.status!=='cancelled'))
      return err('Эвакуатор уже добавлен к этому обращению');
    if(prior.vehicleId && body.vehicleId && prior.vehicleId!==body.vehicleId)
      return err('Продолжение должно относиться к прежнему грузовику');
    body={...body,vehicleId:prior.vehicleId??body.vehicleId,
      brand:prior.brand,model:prior.model,year:prior.year,address:body.address||prior.address,
      description:body.description||prior.description||'Эвакуация после диагностики',isSos:true};
  }
  const hasCar=body.vehicleId||String(body.brand??'').trim();
  if(!hasCar||!body.service||!String(body.description??'').trim()||!String(body.address??'').trim())
    return err('Укажите машину, проблему и адрес');
  const v=vehicles.find(v=>v.id===body.vehicleId)??{id:'',brand:body.brand,model:body.model,year:body.year,plate:''};
  const e=estimate(body),id='demo-order-'+(++counter);
  const o:DemoOrder={id,number:counter,created_at:stamp(),createdAt:stamp(),
   service:body.service,status:who()==='driver'&&fleetSettings.mode==='approve'?'awaiting_owner':'searching',description:body.description,address:body.address,
   brand:v.brand,model:v.model??'',year:v.year??2019,plate:v.plate??'',vehicle:clone(v),
   vehicleId:v.id,zoneId:body.zoneId??'spb',
   // Fictitious map marker for sandbox ONLY; never geolocate the administrator.
   // The UI labels it DEMO and does not present it as the address entered by a client.
   lat:body.zoneId==='lo'?60.03:59.9343,lng:body.zoneId==='lo'?30.53:30.3351,
   paymentMethod:'cash',
   is_sos:!!body.isSos,isSos:!!body.isSos,night:!!body.night,tier:body.tier??'eco',
   estimate:e,money:{callOut:e.callOut,hour:e.hour,clientFee:0,total:e.callOut+(e.hour??0)},
   site:body.site??{},actions:['cancel'],bill:{callOut:e.callOut,hour:e.hour,step:30,extras:[],total:e.callOut+(e.hour??0)},
   points:{max:0,balance:0},result:'solved',resultNote:null,assigned:false,offerPrice:null,messages:[],
   caseRootId:prior ? prior.caseRootId??prior.id : null,
   continuationOf:prior?.id??null,
   limits:{usual:e.callOut,floor:Math.round(e.callOut*.85),ceil:Math.round(e.callOut*1.3)}};
  orders.unshift(o);update(o);return {order:{id:o.id},confirmationUrl:null};
 }
 if(method==='GET'&&p==='/api/bookings')return [];
 if(method==='GET'&&p==='/api/masters-nearby')return {items:[],online:2,free:2,match:1};
 if(method==='GET'&&p==='/api/performer/auctions'){
   forceRole(isWorker());return orders.filter(o=>o.status==='searching'&&!o.offerPrice
     &&(who()==='tow'?o.service==='tow':o.service!=='tow')).map(o=>({
     order_id:o.id,is_sos:o.is_sos,service:o.service,brand:o.brand,
     address:o.address,description:o.description,distance_km:8.5,
     limits:clone(o.limits),my_price:null,estimate:clone(o.estimate),
   }));
 }
 if(method==='GET'&&p==='/api/performer/balance')return {to_pay:0,cash_debt:0,paused:false,cashDebtLimit:0};
 if(method==='GET'&&p==='/api/performer/nearby')return {openNearby:orders.filter(o=>o.status==='searching').length,ahead:0};
 if(method==='POST'&&p==='/api/performer/line')return {line_status:body.lineStatus??'offline',ok:true};
 if(method==='GET'&&p==='/api/performer/blacklist')return [];
 if(method==='GET'&&p==='/api/performer/incoming')return [];
 if(method==='GET'&&p==='/api/my-performers')return [];
 if(method==='GET'&&p==='/api/me/referral')return {balance:0,rules:{spendCapPct:50}};
 if(method==='GET'&&p==='/api/performer/profile')return {ok:true};
 if(method==='GET'&&p==='/api/insurer/requests')return [];
 if(method==='GET'&&p==='/api/mod/cases'){
  const counts={dispute:modCases.filter(x=>x.kind==='dispute'&&x.status==='open').length,
    appeal:modCases.filter(x=>x.kind==='appeal'&&x.status==='open').length,
    review:modCases.filter(x=>x.kind==='review'&&x.status==='open').length};
  const filter=qs.get('kind');
  return {counts,items:clone(modCases.filter(x=>qs.get('status')==='resolved'?x.status==='resolved':
    x.status==='open'&&(!filter||x.kind===filter)))};
 }
 if(p.startsWith('/api/mod/cases/')){
  const parts=p.split('/');const x=modCases.find(x=>x.id===parts[4]);if(!x)return err('Обращение не найдено');
  if(method==='GET')return clone(x);
  if(method==='POST'){
   forceRole(who()==='moderator');
   const action=parts[5];if(action==='priority'&&[1,2,3].includes(body.priority))x.priority=body.priority;
   else if(action==='decide'&&x.status==='open'&&x.decisions[body.decision]){
    x.status='resolved';x.decisionName=x.decisions[body.decision];x.decisionNote=body.note??null;
    x.decidedAt=stamp();x.decidedBy='Демо · Модератор';x.decision=body.decision;
   }else if(action==='reopen'&&x.status==='resolved'){x.status='open';x.decisionName=null;}
   else return err('Недоступный этап обращения');
   x.log.push({action:'mod.'+action,created_at:stamp(),data:clone(body)});
   return clone(x);
  }
 }
 if(method==='GET'&&p==='/api/admin/support')return [];
 if(method==='GET'&&p==='/api/admin/chat/flagged')return [];
 if(method==='GET'&&p==='/api/admin/users')return [];
 if(method==='GET'&&p==='/api/admin/performers')return [];

 if(method==='GET'&&p==='/api/pricing/settings')return clone(samplePricing);
 if(p.startsWith('/api/orders/')){
   const match=p.match(/^\/api\/orders\/([^/]+)(?:\/(.*))?$/);
   if(!match)return err('Некорректная заявка');
   const o=findOrder(match[1]),action=match[2]??'';
   if(method==='GET'){
     if(action==='')return viewOrder(o);
     if(action==='offers')return {offers:offerOf(o),limits:clone(o.limits),until:null};
     if(action==='messages')return {messages:clone(o.messages),quickReplies:[],participants:[]};
     if(action==='payments')return [];
     if(action==='history')return [];
   }
   if(method==='POST'&&action==='offers'){
     forceRole(isWorker());
     if(o.status!=='searching')return err('Заявка уже обрабатывается');
     const price=body.price??o.limits.usual;
     if(price<o.limits.floor||price>o.limits.ceil)return err('Цена за пределами коридора');
     o.offerPrice=price;update(o);return {ok:true};
   }
   if(method==='DELETE'&&action==='offers'){
     forceRole(isWorker());o.offerPrice=null;update(o);return {ok:true};
   }
   if(method==='POST'&&/offers\/[^/]+\/choose$/.test(action)){
     forceRole(isCustomer());if(o.status!=='searching'||o.offerPrice===null)return err('Отклика больше нет');
     o.status='accepted';o.assigned=true;o.money.callOut=o.offerPrice;
     o.money.total=o.offerPrice+(o.estimate.hour??0);
     update(o);return {ok:true};
   }
   if(method==='POST'&&action==='step'){
     forceRole(isWorker());if(!o.assigned)return err('Заявка ещё не назначена');
     const stages:Record<string,[string,string]>={depart:['accepted','en_route'],arrive:['en_route','arrived'],
       start_work:['arrived','working']};
     const rule=stages[body.action];
     if(!rule||o.status!==rule[0])return err('Неверная последовательность действий');
     o.status=rule[1];update(o);return {ok:true};
   }
   if(method==='POST'&&action==='amount'){
     forceRole(isWorker());if(!['arrived','working','awaiting_confirmation'].includes(o.status))
       return err('Сначала начните работу');
     o.status='awaiting_confirmation';o.bill.extras=clone(body.extras??[]);
     o.bill.total=o.money.total+o.bill.extras.reduce((sum:number,x:any)=>sum+x.amount,0);
     o.money.total=o.bill.total;update(o);return {ok:true};
   }
   if(method==='POST'&&action==='confirm'){
     forceRole(isCustomer());if(o.status!=='awaiting_confirmation')return err('Сумма ещё не выставлена');
     o.status='completed';update(o);return {ok:true};
   }
   if(method==='POST'&&action==='owner-decision'){
     forceRole(who()==='owner');if(o.status!=='awaiting_owner')return err('Заявка уже рассмотрена');
     o.status=body.approve?'searching':'cancelled';
     o.messages.push({id:++mid,order_id:o.id,kind:'system',body:body.approve?'Владелец разрешил выезд':'Владелец отклонил заявку',sender_id:null,created_at:stamp()});
     update(o);return {ok:true};
   }
   if(method==='POST'&&action==='cancel'){
     forceRole(isCustomer());o.status='cancelled';update(o);return {ok:true};
   }
   if(method==='POST'&&action==='drop'){
     forceRole(isWorker());o.status='searching';o.assigned=false;o.offerPrice=null;update(o);return {ok:true};
   }
   if(method==='POST'&&action==='messages'){
     if(!String(body.body??'').trim())return err('Введите сообщение');
     const msg={id:++mid,order_id:o.id,kind:body.kind??'text',body:String(body.body).slice(0,2000),
       sender_id:myId(),sender_role:isWorker()?'performer':'client',sender_name:isWorker()?workerName():'Клиент',
       created_at:stamp()};o.messages.push(msg);update(o);return clone(msg);
   }
 }
 if(method==='GET'&&p.startsWith('/api/vehicles/'))return [];
 if(method==='GET'&&p.startsWith('/api/reviews/'))return {items:[],total:0,average:0};
 // Importantly: every unimplemented operation STOPS HERE. No real writes possible.
 return err('Эта функция пока не подключена к общей песочнице: '+method+' '+p);
}
