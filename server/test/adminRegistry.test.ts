import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { safeCsvCell } from '../src/services/adminRegistry.ts';

test('CRM registry: real roles, regional source, combined filters, export and audit', {timeout:60000}, async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995550001');
    const master=await t.login('+79995550002','master');
    const tow=await t.login('+79995550003','tow');
    const base=await t.login('+79995550004','service');
    const stranger=await t.login('+79995550005');

    ok(await t.api('PATCH','/api/me',
      {name:'Анна',companyName:'Тестовая логистика',companyInn:'7800000000'},client.token));
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'master',name:'Электрик 24',specialties:['electric'],taxStatus:'self_employed',inn:'780000000001'},master.token));
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'tow',name:'Эвакуация 78',specialties:['tow'],taxStatus:'ip',inn:'780000000002'},tow.token));
    ok(await t.api('PUT','/api/base',
      {name:'Рембаза Центр',address:'Санкт-Петербург, Софийская улица, 8'},base.token));

    // Also include partner roles without a performer profile.
    await t.db.query(
      "insert into users(phone,name,roles) values($1,$2,$3::text[]),($4,$5,$6::text[])",
      ['+79995550006','Агент ОСАГО',['insurer'],'+79995550007','Оператор ТО',['inspection_operator']]);

    assert.equal((await t.api('GET','/api/admin/registry',undefined,stranger.token)).status,403);
    assert.equal((await t.api('POST','/api/admin/registry/export',{},stranger.token)).status,403);
    assert.equal((await t.api('POST',`/api/admin/registry/${master.id}/metadata`,{region:'lo'},stranger.token)).status,403);

    const all=ok(await t.api('GET','/api/admin/registry?pageSize=30',undefined,admin.token));
    assert.ok(all.total>=8,'includes all accounts including inspector and insurer');
    const clientRow=all.items.find((x:any)=>x.id===client.id);
    const baseRow=all.items.find((x:any)=>x.id===base.id);
    assert.equal(clientRow.company_name,'Тестовая логистика');
    assert.equal(clientRow.company_inn,'7800000000');
    assert.equal(baseRow.region,'spb','STO with explicit SPb address can be classified');
    assert.equal(baseRow.region_source,'адрес СТО');
    assert.ok(all.items.some((x:any)=>x.roles.includes('insurer')));
    assert.ok(all.items.some((x:any)=>x.roles.includes('inspection_operator')));
    assert.ok(all.items.some((x:any)=>x.roles.includes('master')));
    assert.ok(all.items.some((x:any)=>x.roles.includes('tow')));

    const onePage=ok(await t.api('GET','/api/admin/registry?pageSize=1&page=2',undefined,admin.token));
    assert.equal(onePage.items.length,1);
    assert.equal(onePage.total,all.total);

    const edited=ok(await t.api('POST',`/api/admin/registry/${master.id}/metadata`,{
      region:'lo',city:'Гатчина',tags:['ночная помощь','VIP'],note:'Ночной мастер, подтвердил готовность',
    },admin.token));
    assert.equal(edited.ok,true);

    const lo=ok(await t.api('GET','/api/admin/registry?region=lo&role=master&tag=VIP&city=%D0%93%D0%B0%D1%82%D1%87%D0%B8%D0%BD%D0%B0',undefined,admin.token));
    assert.equal(lo.total,1);
    assert.equal(lo.items[0].id,master.id);
    assert.equal(lo.items[0].region_source,'указан администратором');
    assert.equal(lo.items[0].note,'Ночной мастер, подтвердил готовность');

    const company=ok(await t.api('GET','/api/admin/registry?company=yes&q=%D0%A2%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D0%B0%D1%8F',undefined,admin.token));
    assert.equal(company.total,1);
    assert.equal(company.items[0].id,client.id);
    const towers=ok(await t.api('GET','/api/admin/registry?role=tow',undefined,admin.token));
    assert.ok(towers.items.some((x:any)=>x.id===tow.id));
    const service=ok(await t.api('GET','/api/admin/registry?kind=service',undefined,admin.token));
    assert.ok(service.items.some((x:any)=>x.id===base.id));
    assert.equal((await t.api('GET','/api/admin/registry?role=superadmin',undefined,admin.token)).status,400);

    const csv=ok(await t.api('POST','/api/admin/registry/export',{region:'lo',tag:'VIP'},admin.token));
    assert.equal(csv.total,1);
    assert.equal(csv.count,1);
    assert.equal(csv.truncated,false);
    assert.ok(csv.csv.startsWith('\uFEFF'));
    assert.ok(csv.csv.includes('Гатчина'));
    assert.ok(csv.csv.includes('Ночной мастер'));
    assert.ok(!csv.csv.includes('Тестовая логистика'),'export does not include unmatched entries');
    assert.match(safeCsvCell('=HYPERLINK("bad")'),/^"'=HYPERLINK/);
    assert.match(safeCsvCell('+79990000001'),/^"'/);
    const log=await t.db.query("select action from audit_log where action in ('crm.update','crm.export')");
    assert.ok(log.some((x:any)=>x.action==='crm.update'));
    assert.ok(log.some((x:any)=>x.action==='crm.export'));

    const invalid=await t.api('POST',`/api/admin/registry/${client.id}/metadata`,{note:'a'.repeat(2001)},admin.token);
    assert.equal(invalid.status,400);
    assert.equal((await t.api('GET','/api/admin/registry?region=unassigned',undefined,admin.token)).status,200);
  } finally {await t.close();}
});

test('CRM region is not silently derived from a customer last trip as a permanent address', {timeout:60000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const customer=await t.login('+79995550901');
    const order=ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',description:'Свет пропал'},customer.token)).order;
    assert.ok(order.id);
    const rows=ok(await t.api('GET','/api/admin/registry?region=spb',undefined,admin.token));
    const user=rows.items.find((x:any)=>x.id===customer.id);
    assert.ok(user);
    assert.equal(user.region_source,'регион последней заявки');
    assert.equal(user.city,null);
    ok(await t.api('POST',`/api/admin/registry/${customer.id}/metadata`,{
      region:'Москва',city:'Москва',tags:['межрегиональный'],note:'Проверено администратором',
    },admin.token));
    const updated=ok(await t.api('GET','/api/admin/registry?region=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0',undefined,admin.token));
    assert.equal(updated.items[0].id,customer.id);
    assert.equal(updated.items[0].region_source,'указан администратором');
  } finally {await t.close();}
});
