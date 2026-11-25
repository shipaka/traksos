import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setup, ok, type T } from './helpers.ts';

let t:T;
let owner:{token:string;id:string};
let master:{token:string;id:string};
let stranger:{token:string;id:string};
let admin:{token:string;id:string};
let orderId:string;
const payload=Buffer.concat([Buffer.from([0xff,0xd8,0xff]),randomBytes(4200)]);
const image=()=> 'data:image/jpeg;base64,'+payload.toString('base64');

before(async()=>{
  t=await setup();
  owner=await t.login('+79996502001');
  master=await t.login('+79996502002','master');
  stranger=await t.login('+79996502003','master');
  admin=await t.login('+79990000001');
  const order=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',description:'Проверка реальных фотографий в заявке'
  },owner.token)).order;
  orderId=order.id;
  await t.db.query(
    'update orders set performer_id=$2,status=$3,accepted_at=$4 where id=$1',
    [orderId,master.id,'accepted',t.clock.now()]
  );
});
after(()=>t.close());

test('order evidence: an unauthenticated person, stranger and owner cannot upload photos',async()=>{
  const endpoint='/api/orders/'+orderId+'/photos';
  assert.equal((await t.api('GET',endpoint)).status,401);
  assert.equal((await t.api('GET',endpoint,undefined,stranger.token)).status,403);
  assert.equal((await t.api('POST',endpoint,{dataUrl:image()},stranger.token)).status,403);
  assert.equal((await t.api('POST',endpoint,{dataUrl:image()},owner.token)).status,403);
});

test('assigned master uploads genuine photo once, customer reads encrypted original, no public access',async()=>{
  const endpoint='/api/orders/'+orderId+'/photos';
  const saved=ok(await t.api('POST',endpoint,{dataUrl:image()},master.token));
  assert.ok(saved.id,'a real database photo ID');
  assert.equal(saved.duplicate,false);
  const second=ok(await t.api('POST',endpoint,{dataUrl:image()},master.token));
  assert.equal(second.id,saved.id);
  assert.equal(second.duplicate,true,'deduplicate same photograph');

  const records=ok(await t.api('GET',endpoint,undefined,owner.token));
  assert.equal(records.length,1);
  assert.equal(records[0].id,saved.id);
  assert.ok(!JSON.stringify(records).includes('ciphertext'));
  const raw=await t.db.one<any>('select * from order_photos where id=$1',[saved.id]);
  assert.ok(raw?.ciphertext,'image ciphertext is stored in the DB');
  assert.ok(!JSON.stringify(raw).includes(image().slice(0,55)),'plaintext is absent');

  const reader=(id:string,roles:string[])=>({id,roles} as any);
  const photo=await t.app.orderPhotos.file(reader(owner.id,['client']),orderId,saved.id);
  assert.deepEqual(photo.body,payload,'authorized owner can read the original binary');
  assert.equal(photo.mime,'image/jpeg');
  const adminCopy=await t.app.orderPhotos.file(reader(admin.id,['admin']),orderId,saved.id);
  assert.deepEqual(adminCopy.body,payload);
  await assert.rejects(t.app.orderPhotos.file(reader(stranger.id,['master']),orderId,saved.id),
    /Нет доступа/);
  assert.equal((await t.api('GET',endpoint+'/'+saved.id+'/file',undefined,stranger.token)).status,403);
});

test('upload fails for incorrect MIME, huge data, and photos after closure',async()=>{
  const endpoint='/api/orders/'+orderId+'/photos';
  assert.equal((await t.api('POST',endpoint,{dataUrl:'data:image/svg+xml;base64,PHN2Zz4='},master.token)).status,400);
  assert.equal((await t.api('POST',endpoint,{dataUrl:'data:image/jpeg;base64,'+Buffer.from('not really jpeg'.repeat(200)).toString('base64')},master.token)).status,400);
  await t.db.query("update orders set status='completed',completed_at=$2 where id=$1",[orderId,t.clock.now()]);
  const closed=await t.api('POST',endpoint,{dataUrl:'data:image/jpeg;base64,'+
    Buffer.concat([Buffer.from([0xff,0xd8,0xff]),randomBytes(3000)]).toString('base64')},master.token);
  assert.equal(closed.status,409);
  assert.equal(ok(await t.api('GET',endpoint,undefined,owner.token)).length,1,'history still visible');
});
