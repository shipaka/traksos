// In-memory responses for the ACTUAL BaseHome/BaseCar/BaseSetup/BaseMoney components.
// No network calls, no database mutations, no payments/SMS. Route restricted to admin test center.
// A reload resets the training records; production service requests use the regular API unchanged.
import { ApiError } from '../api.ts';

export const SERVICE_PREVIEW_ROOT = 'admin/test-center/service';
export function inServicePreview() {
  const hash = location.hash.replace(/^#\/?/,'');
  return hash===SERVICE_PREVIEW_ROOT || hash.startsWith(SERVICE_PREVIEW_ROOT+'/');
}
export function servicePreviewPath(path:string) {
  const clean=path.replace(/^\/+/, '');
  return inServicePreview()? SERVICE_PREVIEW_ROOT+'/'+clean:clean;
}
export function servicePreviewHref(path:string){return '#/'+servicePreviewPath(path);}
type RecordItem = {[k:string]:any};

const now='2026-11-13T14:00:00.000Z';
const truck=(brand:string,model:string,plate:string)=>({brand,model,plate,trailerPlate:''});
const original:RecordItem[]=[
  {id:'demo-booking-1',number:301,status:'new',vehicle:truck('Scania','R520','А123АА78'),
   client:{name:'ООО Северная логистика',rating:4.9},need:'engine',needName:'Двигатель',
   whenDay:'2026-11-16',whenTime:'10:00',arrival:'own',comment:'Проверить утечку масла',
   notes:[],notesPublic:false,works:[],amount:null,fromOrder:false,createdAt:now,
   statusName:'Новая заявка'},
  {id:'demo-booking-2',number:302,status:'new',vehicle:truck('DAF','XF','В404ВВ47'),
   client:{name:'ИП Грузовиков',rating:4.8},need:'air',needName:'Пневмосистема',
   whenDay:'2026-11-17',whenTime:'14:00',arrival:'tow',comment:'Падает давление воздуха',
   notes:[],notesPublic:false,works:[],amount:null,fromOrder:false,createdAt:now,
   statusName:'Новая заявка'},
  {id:'demo-booking-3',number:303,status:'expected',vehicle:truck('MAN','TGX','М333ММ78'),
   client:{name:'Транспортная компания «Вектор»',rating:5.0},
   need:'electric',needName:'Электрика',whenDay:'2026-11-16',whenTime:'12:00',acceptTime:'12:00',
   arrival:'own',notes:[],notesPublic:false,works:[],amount:null,fromOrder:false,createdAt:now,
   statusName:'Ожидаем'},
  {id:'demo-booking-4',number:304,status:'in_work',vehicle:truck('Volvo','FH','К777КК98'),
   client:{name:'ООО Северная логистика',rating:4.9},
   need:'gearbox',needName:'КПП',whenDay:'2026-11-12',whenTime:'09:00',
   arrival:'tow',arrivedAt:'2026-11-12T08:00:00Z',daysInRepair:2,
   notes:[{at:'2026-11-13T11:00:00Z',text:'Дефектовка КПП; ожидаем согласование'}],
   notesPublic:true,works:[],amount:null,fromOrder:false,createdAt:now,statusName:'В работе'},
  {id:'demo-booking-5',number:305,status:'closed',vehicle:truck('Mercedes-Benz','Actros','Е666ЕЕ47'),
   client:{name:'ООО Магистраль',rating:4.7},need:'tyre',needName:'Шины',
   whenDay:'2026-11-10',whenTime:'10:00',arrival:'own',notes:[],notesPublic:false,
   works:['Шины'],amount:1850000,commission:150000,discount:0,payout:1700000,points:0,
   paidOutAt:'2026-11-12T14:00:00Z',createdAt:'2026-11-10T10:00:00Z',statusName:'Закрыта'},
];

let center:RecordItem={
  id:'demo-center',name:'Северный грузовой сервис · ДЕМО',
  address:'Санкт-Петербург, демонстрационный адрес',
  hours:'Ежедневно 08:00–22:00', verification:'approved',rating:4.9,reviews:128,
  paused:false,closedToday:false,confirmDue:false,closed_days:[],
  inn:'',lat:null,lng:null,staff:{electric:'own',air:'own',engine:'own'},
  brands:['Scania','DAF','MAN','Volvo'],conditions:['parking','pit','night'],
  accepts:['quick','day'],closedDays:[],
};
let bookings=original.map(x=>structuredClone(x));
const clone=<T>(x:T):T=>structuredClone(x);
const labels:Record<string,string>={
  new:'Новая заявка',clarify:'Уточняем детали',expected:'Ожидаем',arrived:'Машина приехала',
  diagnostics:'Диагностика',in_work:'В работе',waiting_part:'Ждём запчасть',
  agreeing:'Согласуем с клиентом',ready:'Готова',invoiced:'Счёт выставлен',
  closed:'Закрыта',declined:'Отказ',disputed:'Спор',cancelled:'Отменена'};
const repair=['arrived','diagnostics','in_work','waiting_part','agreeing'];
const notFound=()=>{throw new ApiError(404,'demo_not_found','Тестовая запись не найдена');};
const invalid=(message:string):never=>{throw new ApiError(400,'demo_validation',message);};
const booking=(id:string):RecordItem=>{
 const b=bookings.find(b=>b.id===id);if(!b)return notFound();return b;
};
function groups(){
 return {requests:bookings.filter(b=>['new','clarify'].includes(b.status)),
   expected:bookings.filter(b=>b.status==='expected'),
   repair:bookings.filter(b=>repair.includes(b.status)),
   ready:bookings.filter(b=>['ready','invoiced','disputed'].includes(b.status)),
   done:bookings.filter(b=>['closed','declined','cancelled'].includes(b.status))};
}
function money(){
 const records=bookings.filter(b=>b.amount!=null).map(b=>({
   ...b,client:b.client?.name,vehicle:b.vehicle,
   amount:b.amount,discount:b.discount||0,commission:b.commission||0,points:b.points||0,
   commissionFull:b.commission||0,payout:b.amount-(b.commission||0),
   state:b.status==='closed'?(b.paidOutAt?'paid':'to_pay'):'awaiting',
   invoicedAt:b.createdAt,closedAt:b.createdAt}));
 const sum=(stage:string)=>records.filter(r=>r.state===stage).reduce((s,r)=>s+r.payout,0);
 return {summary:{toPay:sum('to_pay'),awaiting:sum('awaiting'),disputed:sum('disputed'),
   paid:sum('paid'),points:0},months:[],items:records,
   rule:{pct:8,max:200000,referralPct:3}};
}
export function resetServicePreview(){bookings=original.map(x=>clone(x));}

export async function previewServiceApi(method:string,path:string,body:any={}):Promise<any>{
  // Every action is local; unknown endpoints fail CLOSED instead of falling through to production.
  const p=path.split('?')[0];
  if(method==='GET'){
    if(p==='/api/base')return clone({center,groups:groups()});
    if(p==='/api/base/money')return clone(money());
    if(p==='/api/me/referral')return {balance:0,rules:{spendCapPct:50}};
    if(p==='/api/base/points')return {balance:0,max:0};
    if(p.startsWith('/api/bookings/')){
      const b=booking(p.split('/')[3]);return clone({...b,history:[
        {at:now,what:'Демонстрационная история технических работ',who:'Тестовая СТО'}],
        mine:true,center:{id:center.id,name:center.name,address:center.address}});
    }
    if(/^\/api\/base\/bookings\/[^/]+\/company$/.test(p)){
      return {inn:'',rating:4.9,ratingCount:20,since:'2025-01-01T00:00:00Z',
        park:12,closedRepairs:6,disputes:0,cars:[]};
    }
    return invalid('В тестовом кабинете доступен только учебный сервисный функционал');
  }
  if(method==='PUT'&&p==='/api/base'){
    center={...center,...clone(body),verification:'approved'};
    return clone(center);
  }
  if(method==='POST'&&p==='/api/base/confirm-accepts'){center.confirmDue=false;return {ok:true};}
  const m=/^\/api\/base\/bookings\/([^/]+)\/(respond|status|note|still-here|ready|invoice)$/.exec(p);
  if(method!=='POST'||!m)return invalid('В демонстрации внешние действия запрещены');
  const b=booking(m[1]),action=m[2];
  if(action==='respond'){
    if(body.action==='accept'){b.status='expected';b.acceptTime=body.time||b.whenTime||'12:00';}
    else if(body.action==='clarify'){if(!body.q?.trim())return invalid('Введите вопрос');b.status='clarify';b.clarifyQ=body.q;}
    else if(body.action==='decline'){b.status='declined';b.declineReason=body.reason||'Не можем принять';}
    else if(body.action==='undo'){b.status='new';b.acceptTime=null;}
    else return invalid('Неизвестное действие');
  }else if(action==='status'){
    if(!['arrived',...repair].includes(body.status))return invalid('Неизвестный статус');
    b.status=body.status;
    if(body.status==='arrived'){b.arrivedAt=now;b.daysInRepair=1;}
  }else if(action==='note'){
    if(body.notesPublic!==undefined)b.notesPublic=!!body.notesPublic;
    if(body.text?.trim())b.notes.push({at:now,text:String(body.text).slice(0,500)});
  }else if(action==='still-here'){b.stillHereDue=false;}
  else if(action==='ready'){
    if(!Array.isArray(body.works)||!body.works.length)return invalid('Выберите выполненные работы');
    b.status='ready';b.works=[...body.works];
  }else if(action==='invoice'){
    const amount=Number(body.amount);
    if(!Number.isInteger(amount)||amount<=0)return invalid('Укажите сумму счёта');
    b.amount=amount;b.commission=Math.min(200000,Math.round(amount*.08));
    b.payout=amount-b.commission;b.discount=0;b.points=0;b.status='invoiced';
  }
  b.statusName=labels[b.status]||b.status;
  return clone({...b,history:[],mine:true});
}
