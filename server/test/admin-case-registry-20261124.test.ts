import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,ok} from './helpers.ts';

test('real case center: admin list/detail/notes/CSV are audited; client cannot open them',
  {timeout:60000},async()=>{
    const t=await setup();
    try{
      const admin=await t.login('+79990000001');
      const client=await t.login('+79997774651','client');
      const other=await t.login('+79997774652','client');
      const order=ok(await t.api('POST','/api/orders',
        {service:'electric',zoneId:'spb',description:'Проверяем реестр мультизаявок'},client.token)).order;
      assert.ok(order.id);
      const link='/api/admin/cases/'+order.id;
      for(const token of [client.token,other.token]){
        assert.equal((await t.api('GET','/api/admin/cases',undefined,token)).status,403);
        assert.equal((await t.api('GET',link,undefined,token)).status,403);
        assert.equal((await t.api('GET',link+'/export',undefined,token)).status,403);
        assert.equal((await t.api('POST',link+'/notes',{comment:'Чужое изменение'},token)).status,403);
        assert.equal((await t.api('GET','/api/admin/orders/'+order.id+'/route',undefined,token)).status,403);
      }
      const list=ok(await t.api('GET','/api/admin/cases?q='+order.number,
        undefined,admin.token));
      assert.ok(Array.isArray(list));
      assert.ok(list.some((x:any)=>x.id===order.id),'actual order is listed');
      const card=ok(await t.api('GET',link,undefined,admin.token));
      assert.equal(card.root_id,order.id);
      assert.ok(card.stages.some((s:any)=>s.id===order.id));
      assert.ok(Array.isArray(card.events));
      assert.ok(Array.isArray(card.chat));
      assert.equal((await t.api('POST',link+'/notes',{comment:'x'},admin.token)).status,400);
      const reason='Проверена фактическая история заявки без изменения статуса';
      assert.equal(ok(await t.api('POST',link+'/notes',{comment:reason},admin.token)).ok,true);
      const after=ok(await t.api('GET',link,undefined,admin.token));
      assert.ok(after.notes.some((x:any)=>x.action==='admin.case_note'&&x.data.comment===reason));
      const csv=ok(await t.api('GET',link+'/export',undefined,admin.token));
      assert.ok(csv.csv.startsWith('\uFEFF'));
      assert.match(csv.notice,/Не является/);
      assert.match(csv.filename,/\.csv$/);
      const log=await t.db.query<{action:string}>(
        "select action from audit_log where target=$1 and action like 'admin.case_%'",[order.id]);
      assert.ok(log.some(x=>x.action==='admin.case_view'));
      assert.ok(log.some(x=>x.action==='admin.case_note'));
      assert.ok(log.some(x=>x.action==='admin.case_export'));
      const route=ok(await t.api('GET','/api/admin/orders/'+order.id+'/route',undefined,admin.token));
      assert.equal(route.orderId,order.id);
      assert.deepEqual(route.points,[],'no synthetic GPS data from empty actual route');
    }finally{await t.close();}
  });

test('real unified registry: sensitive export is admin-only, metadata is validated and filtered',
  {timeout:60000},async()=>{
    const t=await setup();
    try{
      const admin=await t.login('+79990000001');
      const user=await t.login('+79997774653','client');
      assert.equal((await t.api('GET','/api/admin/registry',undefined,user.token)).status,403);
      assert.equal((await t.api('POST','/api/admin/registry/export',{},user.token)).status,403);
      assert.equal((await t.api('POST','/api/admin/registry/'+user.id+'/metadata',{
        tags:['неразрешённый']
      },user.token)).status,403);
      assert.equal((await t.api('POST','/api/admin/registry/'+user.id+'/metadata',{
        tags:['x'.repeat(41)]
      },admin.token)).status,400);
      const saved=ok(await t.api('POST','/api/admin/registry/'+user.id+'/metadata',{
        region:'lo',city:'Выборг',tags:['Тестовый контур','Проверка'],note:'Внутренний кейс тестирования'
      },admin.token));
      assert.equal(saved.ok,true);
      const filter='/api/admin/registry?region=lo&tag='+encodeURIComponent('Тестовый контур');
      const list=ok(await t.api('GET',filter,undefined,admin.token));
      assert.ok(list.items.some((x:any)=>x.id===user.id));
      assert.ok(list.items.every((x:any)=>Array.isArray(x.tags)&&x.tags.includes('Тестовый контур')));
      const csv=ok(await t.api('POST','/api/admin/registry/export',{
        region:'lo',tag:'Тестовый контур'
      },admin.token));
      assert.ok(csv.csv.startsWith('\uFEFF'));
      assert.ok(csv.csv.includes('Выборг'));
      assert.equal(csv.total,1);
      assert.equal(csv.count,1);
      assert.ok((await t.db.query<{action:string}>(
        "select action from audit_log where action in ('crm.update','crm.export')"))
        .some(x=>x.action==='crm.export'));
    }finally{await t.close();}
  });

test('UI isolation gates: no stale record, note, export or external GPS on account/case change',()=>{
  const read=(name:string)=>readFileSync(
    new URL('../../web/src/screens/'+name,import.meta.url),'utf8');
  const cases=read('adminCaseCenter.tsx');
  const registry=read('adminRegistry.tsx');
  const map=read('AdminRouteMap.tsx');
  assert.match(cases,/\[me\?\.id,q,scope,listKey,listBefore\]/);
  assert.match(cases,/const listKey=JSON\.stringify\(\[me\?\.id\?\?null,q,scope,refresh,listBefore\]\)/);
  assert.match(cases,/setListCursors\(\[null\]\);setListState\(null\);setListFailure\(null\)/);
  assert.match(cases,/listState\?\.key===listKey/);
  assert.match(cases,/detailState\?\.key===detailKey/);
  assert.match(cases,/setListState\(null\);setListFailure\(null\)/);
  assert.match(cases,/setDetailState\(null\);setDetailFailure\(null\)/);
  assert.match(cases,/active\.current\.id!==target\|\|active\.current\.owner!==owner/);
  assert.match(cases,/savingRef\.current=true/);
  assert.match(cases,/exportingRef\.current=true/);
  assert.match(cases,/focusBack\?\.isConnected/);
  assert.match(cases,/Повторить загрузку обращения/);
  assert.match(registry,/\[params,me\?\.id,reloadToken\]/);
  assert.match(registry,/result\.data\.version===reloadToken/);
  assert.match(registry,/setReloadToken\(v=>v\+1\)/);
  assert.match(registry,/result\.data\?\.ownerId===me\.id/);
  assert.match(registry,/activeAccount\.current!==owner/);
  assert.match(registry,/activeFilters\.current!==filterKey/);
  assert.match(registry,/exportLock\.current=true/);
  assert.match(registry,/Каждый тег должен быть не длиннее 40 символов/);
  assert.match(map,/route\.data\?\.ownerId===me\.id/);
  assert.match(map,/externalFor===externalKey/);
  assert.match(map,/Открыть внешнюю карту с GPS/);
  assert.match(map,/Повторить загрузку GPS-истории/);
});
