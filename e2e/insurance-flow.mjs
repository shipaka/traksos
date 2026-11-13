// TrackSOS insurance/inspection partner workflow. Local CI only; synthetic accounts.
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const ROOT = new URL(BASE);
if (!['localhost','127.0.0.1'].includes(ROOT.hostname)) throw new Error('Insurance E2E is restricted to local development');
const OUT = process.env.SHOTS_DIR ?? 'e2e/shots/insurance';
await mkdir(OUT, { recursive: true });
async function api(method,path,body,token,status=200) {
  const r=await fetch(BASE+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json().catch(()=>null);
  if(r.status!==status) throw Error(method+' '+path+': expected '+status+' got '+r.status+' '+JSON.stringify(data));
  return data;
}
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
async function register(phone,accountType) {
  const {devCode}=await api('POST','/api/auth/code',{phone});
  assert(/^\d{4}$/.test(devCode??''),'Dev-only code required in local CI');
  return api('POST','/api/auth/verify',{phone,code:devCode,accountType,password:'CI-Insurance-Test-2026!'});
}
const [owner,partner,outsider]=await Promise.all([
  register('+79990000651','owner'),
  register('+79990000652','insurer'),
  register('+79990000653','owner')
]);
const admin=await api('POST','/api/auth/login',{phone:'+79990000001',password:'TrackSOS-Test-2026!'});
assert(admin.user.roles.includes('admin'),'Admin role not present');
const car=await api('POST','/api/vehicles',{brand:'Scania',model:'R520',year:2020,plate:'Т123ТТ78'},owner.token);
assert(car.id,'Vehicle was not created');
await api('GET','/api/vehicles/'+car.id+'/service-history',undefined,outsider.token,404);
const request=await api('POST','/api/vehicle-service-requests',{vehicleId:car.id,kind:'insurance',comment:'CI: проверить новый полис'},owner.token);
assert(request.id && request.kind==='insurance','Insurance request missing');
const hidden=await api('GET','/api/insurer/requests',undefined,partner.token);
assert(!hidden.some(x=>x.id===request.id),'Unassigned insurance request leaked to partner');
await api('GET','/api/admin/vehicle-service-requests',undefined,owner.token,403);
await api('PATCH','/api/admin/vehicle-service-requests/'+request.id,{status:'in_review'},admin.token);
await api('PATCH','/api/admin/vehicle-service-requests/'+request.id,{status:'sent_to_partner'},admin.token);
await api('POST','/api/admin/vehicle-service-requests/'+request.id+'/assign-insurer',{insurerId:partner.user.id},admin.token);
const assigned=await api('GET','/api/insurer/requests',undefined,partner.token);
assert(assigned.some(x=>x.id===request.id),'Assigned insurance request missing from insurer queue');
await api('PATCH','/api/insurer/requests/'+request.id,{status:'completed',policyExpiresOn:'2030-11-13'},outsider.token,403);
await api('PATCH','/api/insurer/requests/'+request.id,{status:'completed'},partner.token,400);
const completed=await api('PATCH','/api/insurer/requests/'+request.id,{status:'completed',policyExpiresOn:'2030-11-13'},partner.token);
assert(completed.status==='completed','Insurer completion not saved');
const history=await api('GET','/api/vehicles/'+car.id+'/service-history',undefined,owner.token);
assert(history.some(x=>x.id===request.id && x.status==='completed'),'Owner insurance history missing completion');
assert(history.find(x=>x.id===request.id).events.length>=3,'History events not preserved');

const browser=await chromium.launch();
try{
  for(const item of [
    {name:'owner',token:owner.token,hash:'#/garage',heading:'Мой гараж',expected:'Страхование и техосмотр'},
    {name:'insurer',token:partner.token,hash:'#/insurance',heading:'Кабинет страховщика',expected:'Полис оформлен'},
    {name:'admin',token:admin.token,hash:'#/admin',heading:'Администратор',expected:'Страхование и ТО'}
  ]){
    const context=await browser.newContext({...devices['Pixel 7'],deviceScaleFactor:1,locale:'ru-RU'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','client')},item.token);
    await page.goto(BASE+'/'+item.hash,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:item.heading}).waitFor();
    await page.getByText(item.expected,{exact:false}).first().waitFor();
    if(item.name==='admin')await page.getByRole('button',{name:'Страхование и ТО'}).click();
    if(item.name==='owner')await page.getByText('Страхование и техосмотр',{exact:false}).first().click();
    await page.screenshot({path:OUT+'/'+item.name+'.png',fullPage:true});
    assert(errors.length===0,item.name+' JS errors: '+errors.join(' | '));
    await context.close();
  }
} finally { await browser.close(); }
console.log('Insurance and inspection E2E: partner assignment, role restrictions, history and mobile screens OK');
