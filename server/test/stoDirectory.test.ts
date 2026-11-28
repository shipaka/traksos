import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
let t:T;
let admin:{id:string;token:string},client:{id:string;token:string};
const id='directory:integration-test';
const site={id,name:'Тестовая СТО',address:'Тестовый адрес 1',phone:'+79990000099',category:'sto',lat:59.9,lng:30.3,services:['Ремонт'],hours:null,source:'https://example.com/'};
before(async()=>{t=await setup();admin=await t.login('+79990000001');client=await t.login('+79991234998');});
after(async()=>{await t.close();});
test('independent directory import, review, feedback, edit and hide',async()=>{
 assert.deepEqual(ok(await t.api('GET','/api/public/sto-directory')).points,[]);
 assert.equal((await t.api('POST','/api/admin/sto-directory/import',[site],client.token)).status,403);
 assert.equal(ok(await t.api('POST','/api/admin/sto-directory/import',[site],admin.token)).inserted,1);
 assert.equal(ok(await t.api('POST','/api/admin/sto-directory/import',[site],admin.token)).existing,1);
 assert.equal((await t.api('PUT','/api/admin/sto-directory/'+id+'/review',{revision:1,state:'published',sourceReuseChecked:false,locationChecked:true},admin.token)).status,400);
 assert.equal((await t.api('PUT','/api/sto-directory/'+id+'/feedback',{verdict:'working'},client.token)).status,404);
 ok(await t.api('PUT','/api/admin/sto-directory/'+id+'/review',{revision:1,state:'published',sourceReuseChecked:true,locationChecked:true},admin.token));
 const points=ok(await t.api('GET','/api/public/sto-directory')).points;
 assert.equal(points.length,1);assert.equal(points[0].directory,true);assert.equal(points[0].id,id);assert.equal(points[0].reviewed_by,undefined);
 assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
 assert.equal((await t.api('PUT','/api/sto-directory/'+id+'/feedback',{verdict:'working'})).status,401);
 ok(await t.api('PUT','/api/sto-directory/'+id+'/feedback',{verdict:'working'},client.token));
 ok(await t.api('PUT','/api/sto-directory/'+id+'/feedback',{verdict:'not_working'},client.token));
 const rows=await t.db.query<any>('select verdict from sto_directory_feedback where site_id=$1',[id]);
 assert.equal(rows.length,1);assert.equal(rows[0].verdict,'not_working');
 assert.equal(ok(await t.api('GET','/api/public/sto-directory')).points.length,1);
 assert.equal((await t.api('PUT','/api/admin/sto-directory/'+id,{revision:1,site},admin.token)).status,409);
 ok(await t.api('PUT','/api/admin/sto-directory/'+id,{revision:2,site:{...site,lat:60}},admin.token));
 assert.deepEqual(ok(await t.api('GET','/api/public/sto-directory')).points,[]);
});

test('geocode batch only changes matching missing-GPS drafts; never publishes or overwrites',async()=>{
 const draft={...site,id:'directory:geocode-test',lat:null,lng:null};
 ok(await t.api('POST','/api/admin/sto-directory/import',[draft],admin.token));
 const result={id:draft.id,revision:1,address:draft.address,matchedAddress:draft.address,lat:59.9,lng:30.3,accuracy:'building',source:'https://example.com/geo',reuseAllowed:true};
 assert.equal((await t.api('POST','/api/admin/sto-directory/geocode-results',[result],client.token)).status,403);
 assert.equal((await t.api('POST','/api/admin/sto-directory/geocode-results',[{...result,accuracy:'city'}],admin.token)).status,400);
 assert.equal(ok(await t.api('POST','/api/admin/sto-directory/geocode-results',[{...result,address:'Другой адрес'}],admin.token)).skipped,1);
 assert.equal(ok(await t.api('POST','/api/admin/sto-directory/geocode-results',[result],admin.token)).saved,1);
 assert.equal(ok(await t.api('POST','/api/admin/sto-directory/geocode-results',[result],admin.token)).skipped,1);
 const row=await t.db.one<any>('select state,location_checked,geocode_accuracy from sto_directory_sites where id=$1',[draft.id]);
 assert.equal(row?.state,'draft');assert.equal(row?.location_checked,false);assert.equal(row?.geocode_accuracy,'building');
 assert.deepEqual(ok(await t.api('GET','/api/public/sto-directory')).points,[]);
});

test('first-party map pilot publishes only unchanged drafts through admin approval',async()=>{
 const root='/api/admin/sto-directory';
 assert.equal((await t.api('GET',root+'/pilot',undefined,client.token)).status,403);
 const pilot=ok(await t.api('GET',root+'/pilot',undefined,admin.token));
 assert.equal(pilot.items.length,16);
 assert.equal(pilot.items.filter((x:any)=>x.status==='ready').length,16);
 assert.equal((await t.api('POST',root+'/publish-pilot',{batch:pilot.batch,confirmSourceReview:true},client.token)).status,403);
 assert.equal((await t.api('POST',root+'/publish-pilot',{batch:pilot.batch,confirmSourceReview:false},admin.token)).status,400);
 const held=pilot.items[0].id;
 ok(await t.api('PUT',root+'/'+held+'/review',{revision:1,state:'hidden',sourceReuseChecked:false,locationChecked:false},admin.token));
 const result=ok(await t.api('POST',root+'/publish-pilot',{batch:pilot.batch,confirmSourceReview:true},admin.token));
 assert.equal(result.published,15);assert.equal(result.skipped,1);
 const points=ok(await t.api('GET','/api/public/sto-directory')).points;
 assert.equal(points.length,15);assert.ok(points.every((p:any)=>p.directory===true&&p.id!==held&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)));
 assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
 const again=ok(await t.api('POST',root+'/publish-pilot',{batch:pilot.batch,confirmSourceReview:true},admin.token));
 assert.equal(again.published,0);assert.equal(again.alreadyPublished,15);assert.equal(again.skipped,1);
});

test('bulk reviewed publication skips stale, hidden and missing GPS drafts and forbids client use',async()=>{
 const root='/api/admin/sto-directory';
 const valid={...site,id:'directory:bulk-review-ok'},stale={...site,id:'directory:bulk-review-stale'},missing={...site,id:'directory:bulk-review-missing',lat:null,lng:null},hidden={...site,id:'directory:bulk-review-hidden'};
 ok(await t.api('POST',root+'/import',[valid,stale,missing,hidden],admin.token));
 ok(await t.api('PUT',root+'/'+stale.id,{revision:1,site:{...stale,lat:60}},admin.token));
 ok(await t.api('PUT',root+'/'+hidden.id+'/review',{revision:1,state:'hidden',sourceReuseChecked:false,locationChecked:false},admin.token));
 const rows=[valid,stale,missing,hidden].map(p=>({id:p.id,revision:1,sourceReuseChecked:true,locationChecked:true}));
 assert.equal((await t.api('POST',root+'/publish-reviewed',rows,client.token)).status,403);
 assert.equal((await t.api('POST',root+'/publish-reviewed',[{...rows[0],locationChecked:false}],admin.token)).status,400);
 const result=ok(await t.api('POST',root+'/publish-reviewed',rows,admin.token));
 assert.equal(result.published,1);assert.equal(result.skipped,3);
 const publicIds=ok(await t.api('GET','/api/public/sto-directory')).points.map((p:any)=>p.id);
 assert.ok(publicIds.includes(valid.id));assert.ok(![stale,missing,hidden].some(p=>publicIds.includes(p.id)));
 assert.equal(ok(await t.api('POST',root+'/publish-reviewed',rows,admin.token)).published,0);
});
