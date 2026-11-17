/**
 * Local-only browser smoke of the sandbox checkpoint cabinets.
 * API, role restrictions and DB cleanup are covered by server tests.
 * This covers UI -> API -> independent manual review without device GPS.
 */
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const BASE=process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
  throw new Error('Checkpoint sandbox browser smoke is LOCAL ONLY');
const api=async(method,path,body,token,status=200)=>{
  const response=await fetch(BASE+path,{
    method,headers:{'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const json=await response.json().catch(()=>null);
  assert.equal(response.status,status,
    method+' '+path+' status '+response.status+' '+JSON.stringify(json));
  return json;
};
const login=async(phone,role)=>{
  const code=await api('POST','/api/auth/code',{phone});
  const verification=await api('POST','/api/auth/verify',
    {phone,code:code.devCode,...(role?{role}:{})});
  assert.ok(verification.token);
  return {id:verification.user.id,token:verification.token};
};
const admin=await login('+79990000001');
const client=await login('+79998887571');
const worker=await login('+79998887572','master');
await api('PUT','/api/performer/profile',{
  kind:'master',name:'Checkpoint sandbox test worker',specialties:['electric'],
  taxStatus:'self_employed',inn:'780000000557',
},worker.token);
await api('POST','/api/admin/performers/'+worker.id+'/verify',
  {decision:'approved'},admin.token);
await api('POST','/api/performer/line',{lineStatus:'online'},worker.token);
const order=await api('POST','/api/orders',{
  service:'electric',zoneId:'spb',paymentMethod:'cash',
  lat:59.9343,lng:30.3351,
},client.token);
const id=order.order.id;
await api('POST','/api/orders/'+id+'/offers',{},worker.token);
const offers=await api('GET','/api/orders/'+id+'/offers',undefined,client.token);
await api('POST','/api/orders/'+id+'/offers/'+offers.offers[0].id+'/choose',
  {},client.token);
await api('POST','/api/orders/'+id+'/step',{action:'depart'},worker.token);

await mkdir('e2e/shots/checkpoint',{recursive:true});
const browser=await chromium.launch();
const errors=[];
const page=async(person,sandbox=true)=>{
  const ctx=await browser.newContext({
    ...devices['Pixel 7'],deviceScaleFactor:1,locale:'ru-RU',
    permissions:[], // never authorize GPS in this smoke
  });
  await ctx.addInitScript(({token,sandbox})=>{
    localStorage.setItem('traksos.token',token);
    if(sandbox)sessionStorage.setItem('traksos.sandboxMode','1');
  },{token:person.token,sandbox});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(BASE+'/#/order/'+id);
  return {p,ctx};
};
try {
  // Checkpoint controls cannot appear in the ordinary public cabinet,
  // even when the backend sandbox switch is enabled for CI.
  const publicClient=await page(client,false);
  await publicClient.p.getByRole('heading',{name:/№/}).first().waitFor();
  assert.equal(await publicClient.p.getByRole('region',
    {name:'КПП: тестовое подтверждение прибытия'}).count(),0);
  await publicClient.ctx.close();

  const owner=await page(client);
  const ownerPanel=owner.p.getByRole('region',
    {name:'КПП: тестовое подтверждение прибытия'});
  await ownerPanel.waitFor();
  await ownerPanel.getByLabel('Широта').fill('59.9343');
  await ownerPanel.getByLabel('Долгота').fill('30.3351');
  await ownerPanel.getByRole('button',{name:'Согласовать тестовый КПП'}).click();
  await ownerPanel.getByText('Согласованная точка · версия 1').waitFor();
  const plan=await api('GET','/api/orders/'+id+'/checkpoint',undefined,client.token);
  assert.equal(plan.plans.length,1);
  await owner.p.screenshot({path:'e2e/shots/checkpoint/client.png',fullPage:true});

  const performer=await page(worker);
  const performerPanel=performer.p.getByRole('region',
    {name:'КПП: тестовое подтверждение прибытия'});
  await performerPanel.getByText('Согласованная точка · версия 1').waitFor();
  await performerPanel.getByRole('button',
    {name:'Разрешить фиксацию на 30 минут'}).click();
  await performerPanel.getByText(/Согласие на GPS: действует до/).waitFor();
  await performerPanel.getByRole('button',
    {name:'Записать попытку прибытия'}).click();
  await performerPanel.getByText(/Кандидат для ручной проверки|Требуется проверка/).first().waitFor();
  await performerPanel.getByRole('button',{name:'Мои GPS-согласия'}).click();
  await performerPanel.getByText('Моя история согласий').waitFor();
  await performerPanel.getByRole('button',{name:'Отозвать разрешение'}).click();
  await performerPanel.getByText(/Согласие на GPS: не действует или отозвано/).waitFor();
  await performer.p.screenshot({path:'e2e/shots/checkpoint/performer.png',fullPage:true});

  // The customer's separate decision still cannot advance arrival/status.
  await owner.p.reload();
  const latest=owner.p.getByRole('region',
    {name:'КПП: тестовое подтверждение прибытия'});
  await latest.getByText('Ручная оценка последней попытки').waitFor();
  await latest.getByLabel('Основания решения').fill(
    'Проверка в песочнице: координаты не подтверждены устройством, решение недостаточно.');
  await latest.getByRole('button',{name:'Записать решение'}).click();
  await latest.getByText(/Недостаточно доказательств/).first().waitFor();

  const adminPage=await page(admin);
  await adminPage.p.goto(BASE+'/#/admin/section/checkpoint');
  await adminPage.p.getByRole('heading',{name:'КПП · проверка'}).waitFor();
  await adminPage.p.getByText('КПП · контроль исторических данных').waitFor();
  await adminPage.p.getByText('Итог: нарушений нет').waitFor();
  await adminPage.p.getByText('Просроченные GPS-снимки').waitFor();
  await adminPage.p.screenshot({path:'e2e/shots/checkpoint/admin.png',fullPage:true});

  const current=await api('GET','/api/orders/'+id,undefined,client.token);
  assert.equal(current.status,'en_route');
  assert.equal(current.arrivedAt,null);
  assert.equal(current.waitStartedAt??null,null);
  const state=await api('GET','/api/orders/'+id+'/checkpoint',undefined,admin.token);
  assert.equal(state.startBilling,false);
  assert.equal(state.attempts.length,1);
  assert.equal(state.decisions.length,1);
  assert.equal(state.gpsConsent.active,false,'revocation is immediately effective');
  assert.deepEqual(errors,[],'Browser runtime errors');
  await owner.ctx.close();await performer.ctx.close();await adminPage.ctx.close();
  console.log('Checkpoint sandbox cabinets: client plan, performer consent, privacy, '+
    'candidate and separate decision, admin audit, no billing/GPS permissions');
} finally {
  await browser.close();
}
