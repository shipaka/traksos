// Browser-side security regression: currently installed web bundles must
// never place a long-lived bearer login token in the WebSocket request URL.
// This runs on the disposable CI app after the full role-flow fixture.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE=process.env.BASE_URL??'http://localhost:8080';
const login=await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79991112233',password:'TrakSOS-Test-2026!'}),
});
assert.equal(login.status,200,'existing test client must be logged in');
const credentials=await login.json();
assert.ok(credentials.token);
const browser=await chromium.launch();
try{
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  try{
    await context.addInitScript(token=>localStorage.setItem('traksos.token',token),credentials.token);
    const page=await context.newPage();
    let resolveSocket;
    const seen=new Promise((resolve,reject)=>{
      resolveSocket=resolve;
      setTimeout(()=>reject(new Error('Browser never opened a realtime WebSocket')),10000);
    });
    const opened=[];
    page.on('websocket',ws=>{
      if(!ws.url().includes('/ws?'))return;
      const url=new URL(ws.url());
      opened.push(url);
      resolveSocket(url);
    });
    await page.goto(BASE+'/#/orders');
    const socket=await seen;
    assert.equal(socket.searchParams.has('token'),false,'permanent token in WebSocket URL');
    assert.equal(socket.searchParams.has('ticket'),true,'one-use ticket must authorize new WS');
    assert.match(socket.searchParams.get('ticket'),/^[A-Za-z0-9_-]{43}$/);
    assert.ok(opened.every(u=>!u.searchParams.has('token')),'no bearer-token URL in browser connections');
    await page.getByRole('heading',{name:'Заявки',exact:true}).waitFor({timeout:12000});
    console.log('PASS: browser WebSocket connected using an expiring ticket, without the login token in its URL');
  }finally{await context.close()}
}finally{await browser.close()}
