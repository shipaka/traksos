import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { setup, ok } from './helpers.ts';
import { attachRealtimeGateway } from '../src/realtime/gateway.ts';

test('real WebSocket handshake accepts a one-time ticket, then closes after logout', {timeout:15000}, async()=>{
  const t=await setup();
  const server=http.createServer((req,res)=>void t.app.handle(req,res));
  attachRealtimeGateway(server,t.app,t.db,{reauthEveryMs:75,pingEveryMs:500});
  await new Promise<void>(resolve=>server.listen(0,resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw Error('No test listener');
  const base=`ws://127.0.0.1:${address.port}/ws`;
  const driver=await t.login('+79994990521','driver');
  const sockets:WebSocket[]=[];
  try{
    const {ticket}=ok(await t.api('POST','/api/auth/realtime-ticket',{},driver.token));
    assert.notEqual(ticket,driver.token);
    const socket=new WebSocket(base+'?ticket='+encodeURIComponent(ticket));
    sockets.push(socket);
    const hello=await new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('ticket socket did not open')),4000);
      socket.once('message',buf=>{
        clearTimeout(timeout);
        try{resolve(JSON.parse(buf.toString()))}catch(e){reject(e)}
      });
      socket.once('error',e=>{clearTimeout(timeout);reject(e)});
    });
    assert.equal(hello.type,'hello');
    assert.equal(hello.userId,driver.id);

    const closed=new Promise<number>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('logout did not revoke WebSocket')),4000);
      socket.once('close',code=>{clearTimeout(timeout);resolve(code)});
    });
    ok(await t.api('POST','/api/auth/logout',{},driver.token));
    assert.equal(await closed,1008);

    // The same URL must never be reusable, even if it was intercepted.
    const replay=new WebSocket(base+'?ticket='+encodeURIComponent(ticket));
    sockets.push(replay);
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('replayed ticket unexpectedly connected')),4000);
      replay.once('open',()=>{clearTimeout(timeout);reject(new Error('replayed ticket accepted'))});
      replay.once('error',()=>{clearTimeout(timeout);resolve()});
      replay.once('close',()=>{clearTimeout(timeout);resolve()});
    });
  }finally{
    for(const ws of sockets)if(ws.readyState!==WebSocket.CLOSED)ws.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await t.close();
  }
});

test('legacy token URL remains temporarily compatible for installed APKs', {timeout:15000},async()=>{
  const t=await setup();
  const server=http.createServer((req,res)=>void t.app.handle(req,res));
  attachRealtimeGateway(server,t.app,t.db,{reauthEveryMs:125,pingEveryMs:500});
  await new Promise<void>(resolve=>server.listen(0,resolve));
  const addr=server.address();
  if(!addr||typeof addr==='string')throw Error('No listener');
  const user=await t.login('+79994990522','driver');
  const ws=new WebSocket(`ws://127.0.0.1:${addr.port}/ws?token=${encodeURIComponent(user.token)}`);
  try{
    const hello=await new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('legacy APK token not accepted')),4000);
      ws.once('message',data=>{clearTimeout(timeout);resolve(JSON.parse(data.toString()))});
      ws.once('error',error=>{clearTimeout(timeout);reject(error)});
    });
    assert.equal(hello.userId,user.id,'phase 1 must not break older installed APKs');
  }finally{
    ws.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await t.close();
  }
});
