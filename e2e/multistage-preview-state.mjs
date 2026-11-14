// Pure in-memory regression of the administrator SOS training flow.
import assert from 'node:assert/strict';
globalThis.window={dispatchEvent(){}};
globalThis.location={hash:'#/admin/test-center/client'};
globalThis.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init?.detail;}};
const {rolePreviewApi:request,resetFullPreview}=await import('../web/src/demo/fullRolePreview.ts');
resetFullPreview();
const client=()=>{location.hash='#/admin/test-center/client';};
const master=()=>{location.hash='#/admin/test-center/master';};
const make=await request('POST','/api/orders',{
 service:'electric',isSos:true,zoneId:'spb',brand:'Scania',model:'R520',year:2019,
 description:'Поломка генератора, не заводится',address:'Санкт-Петербург, проспект Славы, 25',
 paymentMethod:'cash',
});
const id=make.order.id;
assert.equal((await request('GET','/api/orders/'+id)).canContinueWithTow,false);
await assert.rejects(request('POST','/api/orders',{
 service:'tow',continueFrom:id,description:'Нужен эвакуатор',
 address:'Санкт-Петербург, проспект Славы, 25',
}),/завершённый этап/i);
master();
await request('POST','/api/orders/'+id+'/offers',{price:350000});
client();
const quotes=await request('GET','/api/orders/'+id+'/offers');
await request('POST','/api/orders/'+id+'/offers/'+quotes.offers[0].id+'/choose',{});
master();
for(const action of ['depart','arrive','start_work'])
 await request('POST','/api/orders/'+id+'/step',{action});
await assert.rejects(request('POST','/api/orders/'+id+'/amount',{
 result:'cause_found',note:'кратко',
}),/причину/i);
await request('POST','/api/orders/'+id+'/amount',{
 result:'cause_found',note:'На дороге генератор не заменить, нужна эвакуация',
});
client();
await request('POST','/api/orders/'+id+'/confirm',{});
const first=await request('GET','/api/orders/'+id);
assert.equal(first.canContinueWithTow,true);
assert.equal(first.status,'completed');
await assert.rejects(request('POST','/api/orders/'+id+'/messages',{body:'Я на месте'}),/завершён/i);
const linked=await request('POST','/api/orders',{
 service:'tow',continueFrom:id,destination:'Грузовой сервис',
 description:'Эвакуация по той же поломке',address:'Санкт-Петербург, проспект Славы, 25',
});
const next=await request('GET','/api/orders/'+linked.order.id);
assert.equal(next.continuationOf,id);
assert.equal(next.caseSummary.stages.length,2);
assert.equal(next.caseSummary.confirmedTotal,first.money.total);
assert.notEqual(next.money.total,first.money.total);
assert.equal((await request('GET','/api/orders/'+id)).canContinueWithTow,false);
await assert.rejects(request('POST','/api/orders',{
 service:'tow',continueFrom:id,destination:'Повтор',address:'Тот же адрес',
}),/уже добавлен/i);
const archive=await request('GET','/api/orders?as=client');
assert.equal(archive.find(x=>x.id===linked.order.id).case_root_id,id);
console.log('Admin training: failed repair, separate tow stage, receipt, deduplication and closed chat: OK');
