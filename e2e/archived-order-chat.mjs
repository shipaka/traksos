// Regression for #34: no writable chat in finished or cancelled requests.
// Runs against the disposable CI application/database, never against VPS.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? 'e2e/shots';
await mkdir(OUT, { recursive: true });

async function api(method, path, body, token) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? {authorization:'Bearer ' + token} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(method+' '+path+' returned '+response.status+' '+JSON.stringify(data));
  return data;
}
async function login(phone, role) {
  const one = await api('POST','/api/auth/code',{phone});
  if (!one.devCode) throw new Error('The isolated test server must supply a development code');
  const verified = await api('POST','/api/auth/verify',{phone,code:one.devCode,...(role?{role}:{})});
  return {id:verified.user.id,token:verified.token};
}

const admin = await login('+79990000001');
const client = await login('+79993657101');
const performer = await login('+79993657102','master');
await api('PUT','/api/performer/profile', {
  kind:'master',name:'Тестовый мастер архива',specialties:['electric'],
  brands:{},taxStatus:'self_employed',inn:'780000000001',
}, performer.token);
await api('POST','/api/admin/performers/'+performer.id+'/verify',
  {decision:'approved'}, admin.token);
await api('POST','/api/performer/line',{lineStatus:'online'},performer.token);

const created = await api('POST','/api/orders',{
  service:'consult',description:'Тест: диагностика электропроводки',brand:'Scania',zoneId:'spb',
},client.token);
const id = created.order.id;
await api('POST','/api/orders/'+id+'/offers',{},performer.token);
const bids = await api('GET','/api/orders/'+id+'/offers',undefined,client.token);
const mine = bids.offers.find(x=>x.performer_id===performer.id);
assert.ok(mine,'our verified specialist must see the consultation');
await api('POST','/api/orders/'+id+'/offers/'+mine.id+'/choose',{},client.token);
await api('POST','/api/orders/'+id+'/consult-finish',
  {hints:['Масса'],confidence:'likely'},performer.token);

const browser = await chromium.launch();
const contexts = [];
async function pageFor(token,width,height,id) {
  const context=await browser.newContext({
    viewport:{width,height},locale:'ru-RU',deviceScaleFactor:1,
  });
  contexts.push(context);
  await context.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
  const page=await context.newPage();
  await page.goto(BASE+'/#/order/'+id);
  return page;
}
async function openArchive(page,label) {
  await page.getByRole('button',{name:/Архив переписки/}).click();
  const archived=page.locator('[aria-label="Архив переписки по заявке"]');
  await archived.waitFor({state:'visible',timeout:12000});
  assert.equal(await archived.locator('input').count(),0,label+': archive must not contain message inputs');
  assert.equal(await archived.locator('form.compose').count(),0,label+': archive must not contain send form');
  assert.equal(await archived.locator('button.chip').count(),0,label+': archive must not offer quick messages');
  assert.equal(await archived.getByText('Завершить диалог').count(),1,label+': archive must have collapse action');
  assert.equal(await archived.getByText('Я на месте',{exact:true}).count(),0,label+': status action cannot be chat text');
  return archived;
}
try {
  const customerPage=await pageFor(client.token,390,844,id);
  await customerPage.getByRole('button',{name:/Чат по заявке/}).click();
  const live=customerPage.locator('form.compose');
  await live.waitFor({state:'visible',timeout:12000});
  assert.equal(await customerPage.locator('.card').getByText('Я на месте',{exact:true}).count(),0);
  // Confirm on the same screen. The Chat component must update without reload.
  await customerPage.getByRole('button',{name:/Вопрос решён ·/}).click();
  const archived=customerPage.locator('[aria-label="Архив переписки по заявке"]');
  await archived.waitFor({state:'visible',timeout:12000});
  assert.equal(await archived.locator('form.compose').count(),0,'chat must become read-only without reload');
  assert.equal(await archived.locator('input').count(),0,'mobile composer must disappear');
  await customerPage.screenshot({path:OUT+'/closed-chat-client-mobile.png'});
  await archived.getByText('Завершить диалог').click();
  const reopened=await openArchive(customerPage,'reopened client');
  assert.ok((await reopened.locator('.msg').count())>0,'archived messages must remain readable');

  const masterPage=await pageFor(performer.token,1440,900,id);
  await openArchive(masterPage,'performer desktop');
  await masterPage.screenshot({path:OUT+'/closed-chat-performer-desktop.png'});

  const cancelled=await api('POST','/api/orders',{
    service:'consult',description:'Тест закрытого чата при отмене',zoneId:'spb'
  },client.token);
  await api('POST','/api/orders/'+cancelled.order.id+'/cancel',
    {reason:'Тестовая отмена до согласования'},client.token);
  const cancelledPage=await pageFor(client.token,390,844,cancelled.order.id);
  await openArchive(cancelledPage,'cancelled customer mobile');
  await cancelledPage.screenshot({path:OUT+'/closed-chat-cancelled-mobile.png'});
  for(const status of [id,cancelled.order.id]) {
    const r=await fetch(BASE+'/api/orders/'+status+'/messages',{
      method:'POST',headers:{authorization:'Bearer '+client.token,'content-type':'application/json'},
      body:JSON.stringify({body:'Попытка писать после завершения'}),
    });
    const json=await r.json();
    assert.equal(r.status,409);
    assert.equal(json.error,'chat_closed');
  }
  console.log('PASS: archived consultations and cancellations are read-only on phone and PC, chat history preserved');
} finally {
  await Promise.all(contexts.map(c=>c.close()));
  await browser.close();
}
