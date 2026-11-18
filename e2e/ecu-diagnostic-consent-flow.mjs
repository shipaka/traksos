// Full browser acceptance for a stationary ECU diagnostic quote.
// Synthetic users only, localhost-only, isolated CI DB, no live SMS/push/payments.
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

const BASE=process.env.BASE_URL??'http://localhost:8080';
const parsed=new URL(BASE);
if(!['localhost','127.0.0.1'].includes(parsed.hostname))
  throw Error('ECU quote browser acceptance is strictly local CI only');
const OUT=process.env.SHOTS_DIR??'e2e/shots/ecu-quote';
await mkdir(OUT,{recursive:true});
const api=async(method,path,body,token)=>{
  const response=await fetch(BASE+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error(method+' '+path+' HTTP '+response.status+': '+JSON.stringify(result));
  return result;
};
const register=async(phone,accountType)=>{
  const code=await api('POST','/api/auth/code',{phone});
  if(!/^\d{4,6}$/.test(code.devCode??''))
    throw Error('CI local-only test SMS code is unavailable');
  return api('POST','/api/auth/verify',{
    phone,code:code.devCode,accountType,password:'OnlySynthetic-Ecu2026!'
  });
};
const adminPhone='+79990000001';
// Existing CI admin fixture already has roles; never request a new client role.
const admin=await register(adminPhone);
if(!admin.user?.roles?.includes('admin'))throw Error('Missing local CI admin fixture');
const allSettings=await api('GET','/api/admin/settings',undefined,admin.token);
const oldVerification=allSettings.verification;
if(!oldVerification||typeof oldVerification.requireDocs!=='boolean')
  throw Error('Cannot capture original local verification settings');
let browser;
try{
  // The production rule is not changed; only synthetic CI's independent DB.
  await api('PUT','/api/admin/settings/verification',
    {...oldVerification,requireDocs:false},admin.token);
  const client=await register('+79990000985','owner');
  const expert=await register('+79990000986','master');
  if(!client.user?.roles?.includes('client')||!expert.user?.roles?.includes('master'))
    throw Error('Synthetic identities have unexpected roles');
  await api('PUT','/api/performer/profile',
    {kind:'ecu',name:'ЭБУ лаборатория для CI',specialties:['diag']},expert.token);
  await api('POST','/api/admin/performers/'+expert.user.id+'/verify',
    {decision:'approved'},admin.token);
  await api('PUT','/api/admin/ecu/stations/'+expert.user.id,{
    name:'Стационарная лаборатория ЭБУ CI',
    address:'Санкт-Петербург, проверочная мастерская, 1',
    lat:59.94,lng:30.34,published:true,consentConfirmed:true,
    reason:'Только синтетическая мастерская для проверки предварительной цены диагностики'
  },admin.token);
  await api('POST','/api/performer/line',{lineStatus:'online'},expert.token);
  const vehicle=await api('POST','/api/vehicles',{
    brand:'Renault',model:'Premium',year:2010
  },client.token);
  const created=await api('POST','/api/orders',{
    service:'ecu',ecuSpecialistId:expert.user.id,vehicleId:vehicle.id,
    zoneId:'ecu_station',paymentMethod:'cash',
    description:'Проверить питание и ошибки блока управления'
  },client.token);
  const orderId=created.order?.id;
  if(!orderId||created.order.money?.total!==0)
    throw Error('Initial inquiry must exist without charge');
  browser=await chromium.launch();
  const openPage=async(token,mode,width)=>{
    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({token,mode})=>{
      localStorage.setItem('traksos.token',token);
      localStorage.setItem('traksos.mode',mode);
    },{token,mode});
    await page.goto(BASE+'/#/order/'+orderId,{waitUntil:'domcontentloaded'});
    for(let i=0;i<6;i++){
      const modal=page.locator('[role="dialog"]').first();
      if(!await modal.isVisible().catch(()=>false))break;
      const checkbox=modal.locator('input[type="checkbox"]');
      if(await checkbox.count())await checkbox.first().check();
      const accept=modal.getByRole('button',{name:/Принимаю/});
      if(!await accept.count())break;
      await accept.click();
      await modal.waitFor({state:'hidden'});
    }
    const cookie=page.getByRole('button',{name:'Понятно'});
    if(await cookie.isVisible().catch(()=>false))await cookie.click();
    return {context,page,errors};
  };
  const specialist=await openPage(expert.token,'performer',390);
  const customer=await openPage(client.token,'client',390);
  try{
    const form=specialist.page.getByRole('region',{name:'Предложение диагностики ЭБУ'});
    await form.waitFor({timeout:20000});
    await form.locator('input[inputmode="numeric"]').fill('420');
    await form.locator('textarea').fill('Проверка питания электронного блока и чтение кодов ошибок');
    await form.getByRole('button',{name:'Предложить диагностику клиенту'}).click();
    await specialist.page.getByText(/Цена диагностики отправлена/).waitFor();
    await customer.page.reload({waitUntil:'domcontentloaded'});
    const choice=customer.page.getByRole('button',{name:/Подтвердить диагностику/});
    await choice.waitFor({timeout:20000});
    if(!(await choice.isDisabled()))throw Error('Client chose diagnostic quote without checkbox');
    await customer.page.getByText(/Проверка питания электронного блока/).waitFor();
    const assent=customer.page.locator('.offer label.agree input[type=checkbox]').first();
    await assent.check();
    if(await choice.isDisabled())throw Error('Client cannot agree to a valid quoted diagnostic');

    // Change the quote while the buyer has the old agreement checked.
    await api('POST','/api/orders/'+orderId+'/offers',{
      price:43000,diagnosticScope:'Проверка питания, чтение памяти ошибок и письменный отчёт'
    },expert.token);
    await customer.page.reload({waitUntil:'domcontentloaded'});
    await customer.page.getByText(/43[^\n]*₽/).first().waitFor({timeout:15000});
    const revised=customer.page.getByRole('button',{name:/Подтвердить диагностику/});
    if(!(await revised.isDisabled()))throw Error('Edited price incorrectly retained old consent');
    const fresh=customer.page.locator('.offer label.agree input[type=checkbox]').first();
    if(await fresh.isChecked())throw Error('Checkbox must reset on new quote');
    await fresh.check();
    await revised.click();
    await customer.page.getByText(/Согласованная цена диагностики/).waitFor({timeout:20000});
    await customer.page.getByText(/43[^\n]*₽/).first().waitFor();
    await customer.page.getByText(/Проверка питания, чтение памяти ошибок/).first().waitFor();
    await customer.page.screenshot({path:OUT+'/mobile-customer-agreed.png',fullPage:true});
    await specialist.page.reload({waitUntil:'domcontentloaded'});
    await specialist.page.getByRole('button',{name:'Приступили к диагностике блока'}).waitFor();
    await specialist.page.screenshot({path:OUT+'/mobile-specialist-start.png',fullPage:true});
    const ready=await api('GET','/api/orders/'+orderId,undefined,client.token);
    if(ready.status!=='accepted'||ready.ecuDiagnosticQuote?.price!==43000)
      throw Error('Approved scope/price not present in resulting order');
    if(ready.ecuDiagnosticQuote?.scope!=='Проверка питания, чтение памяти ошибок и письменный отчёт')
      throw Error('Final accepted diagnostic scope is not the latest version');
    if(customer.errors.length||specialist.errors.length)
      throw Error('Browser errors '+[...customer.errors,...specialist.errors].join(' | '));
  }finally{
    await customer.context.close();
    await specialist.context.close();
  }
  const desktop=await openPage(client.token,'client',1440);
  try{
    await desktop.page.getByText('Согласованная цена диагностики').waitFor({timeout:20000});
    await desktop.page.screenshot({path:OUT+'/desktop-customer-agreed.png',fullPage:true});
    const overflow=await desktop.page.evaluate(()=>
      document.documentElement.scrollWidth>document.documentElement.clientWidth+3);
    if(overflow)throw Error('Desktop ECU agreement has horizontal overflow');
    if(desktop.errors.length)throw Error('Desktop JS errors: '+desktop.errors.join('; '));
  }finally{await desktop.context.close();}
  // A stationary ECU profile never asks for or displays a personal service vehicle.
  const expertProfile=await openPage(expert.token,'performer',390);
  try{
    await expertProfile.page.goto(BASE+'/#/work/me',{waitUntil:'domcontentloaded'});
    await expertProfile.page.getByText('TRAKSOS · СТАЦИОНАРНАЯ РАБОТА ЭБУ').waitFor({timeout:20000});
    if(await expertProfile.page.locator('button.linkrow').filter({hasText:'Машины'}).count())
      throw Error('Stationary ECU profile incorrectly exposes a roadside vehicle section');
    await expertProfile.page.goto(BASE+'/#/work/me/cars',{waitUntil:'domcontentloaded'});
    await expertProfile.page.getByText(/Личный автомобиль не требуется/).waitFor();
    if(expertProfile.errors.length)
      throw Error('ECU stationary profile browser errors: '+expertProfile.errors.join('; '));
  }finally{await expertProfile.context.close();}
  console.log('PASS ECU full browser flow: specialist price, scope, changed quote, fresh client consent; mobile+desktop');
}finally{
  if(browser)await browser.close();
  await api('PUT','/api/admin/settings/verification',oldVerification,admin.token);
}
