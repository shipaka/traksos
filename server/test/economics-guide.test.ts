import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/domain/defaults.ts';
import { cappedPct, PER_SIDE_FEE_CAP, split } from '../src/domain/money.ts';
import { financeGuide, contractEconomyAnnex } from '../src/domain/economicsGuide.ts';
import { setup, ok, type T } from './helpers.ts';

test('one monetary rule powers client fee, worker commission, upper limit and offers',()=>{
  const fees=defaultSettings.fees;
  for(const amount of [1_000_000,20_000_000,100_000_000]) {
    const s=split(fees,amount,{isPriority:false});
    const c=financeGuide(defaultSettings,'owner').examples.find(x=>x.amount===amount);
    const p=financeGuide(defaultSettings,'master').examples.find(x=>x.amount===amount);
    assert.equal(s.clientFee,cappedPct(amount,fees.clientFeePct));
    assert.equal(s.commission,cappedPct(amount,fees.performerCommissionPct));
    assert.ok(s.clientFee<=PER_SIDE_FEE_CAP);
    assert.ok(s.commission<=PER_SIDE_FEE_CAP);
    if(c) {assert.equal(c.fee,s.clientFee);assert.equal(c.total,s.total);}
    if(p) {assert.equal(p.fee,s.commission);assert.equal(p.partnerReceives,s.toPerformer);}
  }
  assert.equal(split(fees,1_000_000,{isPriority:false}).total,1_050_000);
  assert.equal(split(fees,1_000_000,{isPriority:false}).toPerformer,950_000);
  assert.equal(split(fees,20_000_000,{isPriority:false}).clientFee,500_000);
  assert.equal(split(fees,20_000_000,{isPriority:false}).commission,500_000);
});

test('economy explainer shows only the own side and all actual bonus settings',()=>{
  const owner=financeGuide(defaultSettings,'owner');
  const master=financeGuide(defaultSettings,'master');
  const workshop=financeGuide(defaultSettings,'service');
  assert.equal(owner.rules.clientSharePct,10);
  assert.equal(owner.rules.referralDays,180);
  assert.equal(owner.rules.clientSpendCapPct,10);
  assert.match(owner.paragraphs.map(x=>x.text).join(' '),/10% стоимости заказа/);
  assert.doesNotMatch(owner.paragraphs.map(x=>x.text).join(' '),/комисси[яю] исполнителя\s*[—:-]\s*5%/);
  assert.doesNotMatch(master.paragraphs.map(x=>x.text).join(' '),/сбор с клиента\s*[—:-]\s*5%/);
  assert.equal(workshop.examples[1].fee,500_000);
  for(const role of ['insurer','inspection','moderator','admin'] as const) {
    assert.equal(financeGuide(defaultSettings,role).examples.length,0);
  }
  const clientDocument=contractEconomyAnnex(defaultSettings,'client');
  const performerDocument=contractEconomyAnnex(defaultSettings,'performer');
  assert.match(clientDocument,/10 500/);
  assert.match(clientDocument,/180 дней/);
  assert.match(performerDocument,/мастер|Мастер/);
  assert.match(performerDocument,/СТО/);
});

let t:T;
before(async()=>{t=await setup();});
after(()=>t.close());

test('economic help API blocks access to the commission of a different role',async()=>{
  const client=await t.login('+79997776641','client');
  const master=await t.login('+79997776642','master');
  const c=ok(await t.api('GET','/api/me/economics?role=owner',undefined,client.token));
  assert.equal(c.role,'owner');
  assert.equal(c.examples[0].total,1_050_000);
  assert.equal((await t.api('GET','/api/me/economics?role=master',undefined,client.token)).status,403);
  const m=ok(await t.api('GET','/api/me/economics?role=master',undefined,master.token));
  assert.equal(m.role,'master');
  assert.equal(m.examples[0].partnerReceives,950_000);
  assert.equal((await t.api('GET','/api/me/economics?role=owner',undefined,master.token)).status,403);
  assert.equal((await t.api('GET','/api/me/economics')).status,401);
});

test('pricing public endpoint does not expose contractor commission',async()=>{
  const prices=ok(await t.api('GET','/api/pricing'));
  assert.equal(Object.prototype.hasOwnProperty.call(prices,'performerCommissionPct'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(prices,'serviceCommissionPct'),false);
  assert.equal(prices.clientFeePct,defaultSettings.fees.clientFeePct);
});
