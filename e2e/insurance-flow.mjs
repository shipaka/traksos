// TrakSOS insurance/inspection partner workflow. Local CI only; synthetic accounts.
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
async function acceptPendingOffers(page,token) {
  const response=await fetch(BASE+'/api/me/offers',{headers:{authorization:'Bearer '+token}});
  if(!response.ok) throw Error('Could not read pending offer status');
  const offers=await response.json();
  for (const item of offers.filter(x=>x.current && !x.accepted)) {
    const dialog=page.getByRole('dialog',{name:item.name});
    await dialog.waitFor({state:'visible',timeout:15000});
    await dialog.locator('input[type=checkbox]').check();
    await dialog.getByRole('button',{name:'Принимаю'}).click();
    await dialog.waitFor({state:'detached',timeout:15000});
  }
}

async function register(phone,accountType) {
  const {devCode}=await api('POST','/api/auth/code',{phone,accountType});
  assert(/^\d{4}$/.test(devCode??''),'Dev-only code required in local CI');
  return api('POST','/api/auth/verify',{phone,code:devCode,accountType,password:'CI-Insurance-Test-2026!'});
}
const [owner,partner,outsider]=await Promise.all([
  register('+79990000651','owner'),
  register('+79990000652','insurer'),
  register('+79990000653','owner')
]);
const admin=await api('POST','/api/auth/login',{phone:'+79990000001',password:'TrakSOS-Test-2026!'});
assert(admin.user.roles.includes('admin'),'Admin role not present');
const policy=await api('GET','/api/admin/insurance-access',undefined,admin.token);
assert(policy.registrationOpen===false,'Insurer registration must be closed by default');
assert(policy.registeredCount>=1,'Initial insurer not recorded');
await api('GET','/api/admin/insurance-access',undefined,partner.token,403);
await api('PUT','/api/admin/settings/insurancePartners',{registrationOpen:true},partner.token,403);
await api('PUT','/api/admin/settings/insurancePartners',{registrationOpen:'yes'},admin.token,400);
if(policy.primaryConfigured) {
  await api('PUT','/api/admin/settings/insurancePartners',{registrationOpen:true},admin.token);
  const enabled=await api('GET','/api/admin/insurance-access',undefined,admin.token);
  assert(enabled.registrationOpen===true,'Admin enable action not reflected');
  await api('PUT','/api/admin/settings/insurancePartners',{registrationOpen:false},admin.token);
} else {
  await api('PUT','/api/admin/settings/insurancePartners',{registrationOpen:true},admin.token,400);
}
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
    {name:'insurer',token:partner.token,hash:'#/insurance',heading:'Страхование',expected:'Полис оформлен'},
    {name:'admin',token:admin.token,hash:'#/admin/section/vehicleServices',heading:'Страхование и ТО',expected:'Страхование и ТО'}
  ]){
    const context=await browser.newContext({...devices['Pixel 7'],deviceScaleFactor:1,locale:'ru-RU'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','client')},item.token);
    await page.goto(BASE+'/'+item.hash,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:item.heading}).waitFor();
    await acceptPendingOffers(page,item.token);
    if(item.name==='insurer') await page.getByRole('button',{name:'Все',exact:true}).click();
    if(item.name!=='admin') await page.getByText(item.expected,{exact:false}).first().waitFor();
    if(item.name==='admin') {
      await page.locator('.admin-stage-head h2').getByText('Страхование и ТО',{exact:true}).waitFor();
      await page.getByRole('link',{name:'Управлять регистрацией страховых агентов'}).click();
      await page.getByRole('button',{name:/Страховые агенты/}).click();
       await page.getByText('Страховые партнёры',{exact:true}).waitFor();
      await page.getByRole('button',{name:/Регистрация новых партнёров закрыта/}).waitFor();
    }
    if(item.name==='owner')await page.getByText('Страхование и техосмотр',{exact:false}).first().click();
    await page.screenshot({path:OUT+'/'+item.name+'.png',fullPage:true});
    assert(errors.length===0,item.name+' JS errors: '+errors.join(' | '));
    await context.close();
  }
  // Preview the NEW manual agent workflow using the actual registered client and insurer screens.
  const truck=await api('POST','/api/vehicles',{brand:'DAF',model:'XF',year:2018,plate:'Р444РР78'},owner.token);
  const clientCtx=await browser.newContext({...devices['Pixel 7'],deviceScaleFactor:1,locale:'ru-RU',acceptDownloads:true});
  const clientPage=await clientCtx.newPage();
  await clientPage.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','client')},owner.token);
  await clientPage.goto(BASE+'/#/insurance/request/new/'+truck.id);
  await acceptPendingOffers(clientPage,owner.token);
  await clientPage.getByRole('heading',{name:'Заявка на страхование грузовика'}).waitFor();
  await clientPage.locator('select').first().selectOption(partner.user.id);
  await clientPage.getByRole('button',{name:'Продолжить'}).click();
  await clientPage.getByLabel('Фамилия').fill('Иванов');
  await clientPage.getByLabel('Имя',{exact:true}).fill('Иван');
  await clientPage.getByRole('button',{name:'Продолжить'}).click();
  await clientPage.getByLabel('Автомобиль из гаража (необязательно)').selectOption(truck.id);
  await clientPage.getByLabel('VIN / номер рамы *').fill('XLRTE47XS0E123456');
  await clientPage.getByRole('button',{name:'Продолжить'}).click();
  await clientPage.locator('input[type=checkbox]').last().check();
  await clientPage.screenshot({path:OUT+'/client-application.png',fullPage:true});
  await clientPage.getByRole('button',{name:'Отправить заявку страховому агенту'}).click();
  await clientPage.waitForURL(/#\/insurance\/request\/[0-9a-f-]{36}$/,{timeout:15000});
  // The temporary success message is visible on the phone, yet never hides
  // the approved brand header or covers fixed bottom navigation actions.
  const successToast=clientPage.locator('.toast');
  await successToast.getByText('Заявка отправлена выбранному страховому агенту').waitFor();
  const toastRect=await successToast.boundingBox();
  const headerRect=await clientPage.locator('header.top').boundingBox();
  const navRect=await clientPage.locator('.tabbar').boundingBox();
  const viewport=clientPage.viewportSize();
  assert(!!toastRect&&!!headerRect&&!!viewport,'Mobile toast/header must be measurable');
  assert(toastRect.y >= headerRect.y+headerRect.height+6,
    'Mobile toast covers the TrakSOS header and logo');
  assert(toastRect.y+toastRect.height <= viewport.height-6,
    'Mobile toast falls outside the visible device viewport');
  if(navRect)assert(toastRect.y+toastRect.height <= navRect.y-6,
    'Mobile toast covers a bottom navigation action');
  await clientPage.screenshot({path:OUT+'/client-submit-toast-mobile.png',fullPage:false});
  const requestId=clientPage.url().split('/').pop();
  assert(requestId&&requestId!==truck.id,'New insurance dossier was not opened');
  await clientPage.getByText('Заявка отправлена страховому агенту',{exact:true}).waitFor();
  await clientPage.screenshot({path:OUT+'/client-sent-status.png',fullPage:true});
  // The MAIN customer dashboard must not hide the newly submitted request.
  await clientPage.goto(BASE+'/#/');
  const homeInsurance=clientPage.getByRole('region',{name:'Мои активные страховые заявки'});
  await homeInsurance.getByText('Заявка отправлена страховому агенту',{exact:true}).waitFor();
  await clientPage.screenshot({path:OUT+'/client-home-insurance-submitted.png',fullPage:true});
  // A submitted insurance request must be visible WITHOUT expanding garage history.
  await clientPage.goto(BASE+'/#/garage');
  const activeInsurance=clientPage.getByRole('region',{name:'Активные страховые заявки'});
  await activeInsurance.getByText('Заявка отправлена страховому агенту',{exact:true}).waitFor();
  await clientPage.screenshot({path:OUT+'/client-garage-active-insurance.png',fullPage:true});
  await clientPage.goto(BASE+'/#/insurance/request/'+requestId);
  await clientPage.getByText('Заявка отправлена страховому агенту',{exact:true}).waitFor();
  const incoming=await api('GET','/api/insurance/requests/'+requestId,undefined,partner.token);
  assert(incoming.request.insurance_stage==='received','Agent did not receive insurance dossier');
  const inboxContext=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,locale:'ru-RU'});
  const inboxPage=await inboxContext.newPage();
  await inboxPage.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','insurer')},partner.token);
  await inboxPage.goto(BASE+'/#/insurance');
  await acceptPendingOffers(inboxPage,partner.token);
  await inboxPage.getByText('Получена новая заявка',{exact:true}).waitFor();
  await inboxPage.getByRole('button',{name:'Требуют действий'}).waitFor();
  await inboxPage.screenshot({path:OUT+'/insurer-desktop-incoming.png',fullPage:true});
  await inboxPage.getByRole('button',{name:'В работе',exact:true}).click();
  await inboxPage.getByText('Нет заявок в работе.',{exact:true}).waitFor();
  await api('POST','/api/insurance/requests/'+requestId+'/accept',{},partner.token);
  const one={company:'Страховая А',product:'ОСАГО грузовика',premiumKopecks:3250000,
    description:'Цена агентом рассчитана вручную',coverage:'Условия согласовываются'};
  await api('POST','/api/insurance/requests/'+requestId+'/offers',
    {offers:[one,{...one,company:'Страховая Б',premiumKopecks:3560000}]},partner.token);
  await inboxPage.reload();
  await inboxPage.getByRole('button',{name:'В работе',exact:true}).click();
  await inboxPage.getByText('Предложения отправлены клиенту',{exact:true}).waitFor();
  await inboxPage.screenshot({path:OUT+'/insurer-desktop-working.png',fullPage:true});
  await inboxContext.close();
  await clientPage.reload();
  await clientPage.getByRole('heading',{name:/DAF XF/}).waitFor();
  await clientPage.getByText('Страховая А',{exact:true}).waitFor();
  await clientPage.getByText('Страховая Б',{exact:true}).waitFor();
  await clientPage.getByText('Предложения готовы — выберите вариант',{exact:true}).waitFor();
  await clientPage.screenshot({path:OUT+'/client-offers.png',fullPage:true});
  // After the agent's quote arrives, the homepage must explicitly call for choice.
  await clientPage.goto(BASE+'/#/');
  await clientPage.getByRole('region',{name:'Мои активные страховые заявки'})
    .getByText('Предложения готовы — выберите вариант',{exact:true}).waitFor();
  await clientPage.screenshot({path:OUT+'/client-home-offers-ready.png',fullPage:true});
  await clientPage.goto(BASE+'/#/insurance/request/'+requestId);
  await clientPage.getByText('Предложения готовы — выберите вариант',{exact:true}).waitFor();
  await clientPage.getByRole('button',{name:'Выбрать',exact:true}).first().click();
  await clientPage.getByRole('button',{name:'Оформить выбранный вариант'}).click();
  await clientPage.locator('.insurance-live-status').getByText('Вы выбрали страховое предложение',{exact:true}).waitFor();
  const agentCtx=await browser.newContext({...devices['Pixel 7'],deviceScaleFactor:1,locale:'ru-RU'});
  const agentPage=await agentCtx.newPage();
  await agentPage.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','insurer')},partner.token);
  await agentPage.goto(BASE+'/#/insurance/request/'+requestId);
  await acceptPendingOffers(agentPage,partner.token);
  await agentPage.getByRole('heading',{name:/DAF XF/}).waitFor();
  await agentPage.getByText('Анкета для оформления').waitFor();
  // The working action is immediately available before a long progress list
  // on a real narrow-screen insurer workspace.
  const mobileStages=agentPage.locator('.insurance-mobile-stage-map');
  await mobileStages.waitFor();
  assert(!(await agentPage.locator('.insurance-desktop-stage-map').isVisible()),
    'Desktop stage map should be hidden on a phone');
  const actionCard=agentPage.locator('.insurance-conversation-tools>section:not(.insurance-desktop-stage-map)').first();
  const actionBounds=await actionCard.boundingBox();
  const stagesBounds=await mobileStages.boundingBox();
  assert(actionBounds&&stagesBounds&&actionBounds.y<stagesBounds.y,
    'Agent must see the immediate next action before the full timeline');
  assert(!(await mobileStages.getAttribute('open')),
    'Expanded timeline must not consume the first phone screen by default');
  await agentPage.screenshot({path:OUT+'/agent-mobile-action-ready.png',fullPage:true});
  await mobileStages.locator('summary').click();
  await mobileStages.locator('.insurance-progress').waitFor();
  await mobileStages.locator('summary').click();
  await agentPage.locator('.insurance-dossier-toggle').click();
  await agentPage.getByText('XLRTE47XS0E123456',{exact:true}).waitFor();
  await agentPage.screenshot({path:OUT+'/agent-dossier.png',fullPage:true});
  await agentPage.getByRole('button',{name:'Принято в работу'}).click();
  await agentPage.getByRole('button',{name:'Отправить готовый полис клиенту'}).waitFor();
  await agentPage.screenshot({path:OUT+'/agent-mobile-policy-action.png',fullPage:true});
  await agentPage.locator('input[type=date]').fill('2030-12-31');
  await agentPage.locator('input[type=file]').setInputFiles({
    name:'policy.pdf',mimeType:'application/pdf',
    buffer:Buffer.from('%PDF-1.4\n'+'TrakSOS synthetic test '.repeat(20)),
  });
  await agentPage.getByRole('button',{name:'Отправить готовый полис клиенту'}).click();
  await agentPage.getByText('Готовый страховой полис').first().waitFor();
  await clientPage.reload();
  await clientPage.getByRole('button',{name:'Скачать PDF-полис'}).waitFor();
  const downloadEvent=clientPage.waitForEvent('download');
  await clientPage.getByRole('button',{name:'Скачать PDF-полис'}).click();
  const dl=await downloadEvent;
  assert(dl.suggestedFilename()==='insurance-policy.pdf','Policy PDF download is missing');
  await clientPage.screenshot({path:OUT+'/client-final-policy.png',fullPage:true});
  await agentCtx.close();
  await clientCtx.close();
} finally { await browser.close(); }
console.log('Insurance and inspection E2E: partner assignment, role restrictions, history and mobile screens OK');
