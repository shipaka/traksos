import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attention, ageMinutes, latestEventAt, type LiveOrder }
  from '../../web/src/screens/dispatcherAttention20261124.ts';
import { setup, ok } from './helpers.ts';

const now = new Date('2026-11-24T12:00:00.000Z').getTime();
const before = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const row = (status: string, events: LiveOrder['events'] = []): LiveOrder => ({
  id:'a',number:1,service:'electric',status,is_sos:false,
  created_at:before(120),events,
});

test('live admin board never infers a stage delay from order age or another stage', () => {
  assert.equal(attention(row('accepted',[{type:'accepted',at:before(2)}]),now),null,
    'a new acceptance on an old order is not a ten-minute no-departure warning');
  assert.equal(attention(row('accepted',[{type:'dispatch_started',at:before(120)}]),now),null,
    'without a confirmed acceptance event, do not invent acceptance time');
  assert.equal(attention(row('accepted',[{type:'accepted',at:before(11)}]),now),'Нет отметки выезда');
  assert.equal(attention(row('arrived',[{type:'arrive',at:before(4)}]),now),null);
  assert.equal(attention(row('arrived',[{type:'accepted',at:before(80)}]),now),null,
    'never infer arrival time from acceptance or order creation');
  assert.equal(attention(row('arrived',[{type:'arrive',at:before(31)}]),now),
    'Давно на месте — уточнить ход работ');
  assert.equal(attention(row('awaiting_owner'),now),null);
  assert.equal(attention(row('awaiting_owner',[
    {type:'owner_approval_requested',at:before(11)}
  ]),now),'Ожидается решение владельца');
  assert.equal(attention(row('en_route',[{type:'depart',at:before(41)}]),now),
    'Давно нет событий в пути — проверьте ETA');
  assert.equal(attention(row('en_route',[
    {type:'depart',at:before(41)},{type:'chat_message',at:before(2)}
  ]),now),null);
  assert.equal(attention(row('working',[{type:'start_work',at:before(91)}]),now),
    'Давно нет обновлений о работе');
});

test('a second search wave resets elapsed-time alerts; ordering and invalid timestamps are safe', () => {
  const ongoing = row('searching',[
    {type:'dispatch_started',at:before(65)},
    {type:'retry',at:before(3)},
    {type:'ringing',at:before(2)},
  ]);
  assert.equal(attention(ongoing,now),null);
  assert.equal(attention(row('searching',[
    {type:'dispatch_started',at:before(11)}
  ]),now),'Долго ищем исполнителя');
  assert.equal(attention({...ongoing,is_sos:true},now),'Долго ищем исполнителя');
  assert.equal(attention({...ongoing,is_sos:true,events:[
    {type:'dispatch_started',at:before(60)},{type:'retry',at:before(1)}
  ]},now),null);
  assert.equal(latestEventAt(row('accepted',[
    {type:'accepted',at:'invalid'},{type:'accepted',at:before(2)},
    {type:'accepted',at:before(5)}
  ]),['accepted']),before(2));
  assert.equal(latestEventAt(row('accepted',[])),null);
  assert.equal(ageMinutes('not-a-date',now),0);
  assert.equal(ageMinutes(before(10),now),10);
});

test('real backend sort and dispatcher routes respect actual owner/staff permissions', async () => {
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const owner=await t.login('+79997774331','client');
    const stranger=await t.login('+79997774332','client');
    const created=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,zone_id,status,estimate)
      values ($1,$1,'electric','spb','searching',$2::jsonb) returning id`,
      [owner.id,JSON.stringify({callOut:150000,zoneName:'Санкт-Петербург'})]);
    assert.ok(created);
    await t.db.query(`
      insert into order_events(order_id,actor_id,type,data)
      values ($1,$2,'dispatch_started','{"candidates":0}'::jsonb)`,[created.id,owner.id]);
    const sorted=ok(await t.api('GET',
      '/api/orders/'+created.id+'/offers?sort=price',undefined,owner.token));
    assert.equal(sorted.sort,'price');
    assert.ok(Array.isArray(sorted.offers));
    assert.equal(sorted.offers.length,0,'never invent a performer when there are no bids');
    const fallback=ok(await t.api('GET',
      '/api/orders/'+created.id+'/offers?sort=malicious',undefined,owner.token));
    assert.equal(fallback.sort,'recommended');
    assert.equal((await t.api('GET',
      '/api/orders/'+created.id+'/offers?sort=price',undefined,stranger.token)).status,403);
    assert.equal((await t.api('GET','/api/admin/live',undefined,owner.token)).status,403);
    const live=ok(await t.api('GET','/api/admin/live',undefined,admin.token)) as LiveOrder[];
    const actual=live.find(o=>o.id===created.id);
    assert.ok(actual);
    assert.ok(actual!.events.some(e=>e.type==='dispatch_started'));
    assert.equal(actual!.status,'searching');
    // No fabricated accepted_at/arrived_at in this real endpoint. The UI
    // must derive a stage warning only from a confirmed event of that stage.
    assert.equal(actual!.accepted_at,undefined);
    assert.equal(actual!.arrived_at,undefined);
  }finally{await t.close();}
});

test('actual UI code rejects stale order responses and stale dispatcher metrics', () => {
  const search=readFileSync(new URL('../../web/src/screens/search.tsx',import.meta.url),'utf8');
  const board=readFileSync(new URL('../../web/src/screens/DispatcherDesk.tsx',import.meta.url),'utf8');
  const quick=readFileSync(new URL('../../web/src/screens/siteQuickSearch.tsx',import.meta.url),'utf8');
  assert.match(search,/current !== generation/);
  assert.match(search,/response\?\.key === key/);
  assert.match(search,/setResponse\(null\)/);
  assert.match(search,/choosingRef\.current/);
  assert.match(search,/submittingRef\.current/);
  assert.match(search,/window\.clearInterval\(interval\)/);
  assert.match(board,/const liveCurrent = !!live\.data && !live\.error/);
  assert.match(board,/const demandCurrent = !!demand\.data && !demand\.error/);
  assert.match(board,/type LiveOrder.*dispatcherAttention20261124/);
  assert.match(quick,/aria-activedescendant/);
  assert.match(quick,/ArrowDown/);
  assert.match(quick,/aria-expanded=\{expanded\}/);
});
