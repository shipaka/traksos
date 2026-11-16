import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {suggestPartnerLevel} from '../src/services/partnerLevels.ts';

let t:T,admin:any,master:any,client:any;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79998881101');
  master=await t.login('+79998881102','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Тестовый электрик',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000008822'
  },master.token));
});
after(()=>t.close());

test('partner advisory never uses a universal five-jobs rule for low demand',()=>{
  const basic={offered:1,completedFromOffers:1,completedTotal:1,
    approvedKnowledge:0,complaints:0,drops:0,rating:4.9,ratingCount:3};
  const small=suggestPartnerLevel(basic,true);
  assert.equal(small.candidate,'priority');
  assert.equal(small.confidence,'limited','do not pretend a single offer is statistically conclusive');
  assert.equal(small.manualReviewRequired,true);
  const idle=suggestPartnerLevel({...basic,offered:0,completedFromOffers:0,
    completedTotal:0,rating:null,ratingCount:0},true);
  assert.equal(idle.candidate,'start');
  assert.match(idle.reasons.join(' '),/Низкий спрос не считается нарушением/);
  const expert=suggestPartnerLevel({...basic,offered:0,completedFromOffers:0,
    approvedKnowledge:2,rating:null,ratingCount:0},true);
  assert.equal(expert.candidate,'priority','alternate path for expert contributions without unfair order count');
  const unverified=suggestPartnerLevel({...basic,approvedKnowledge:5},false);
  assert.equal(unverified.candidate,'start');
});

test('partner program is private, status is independent of legacy rating and not a dispatch feature',async()=>{
  assert.equal((await t.api('GET','/api/partner/level')).status,401);
  assert.equal((await t.api('GET','/api/partner/level',undefined,client.token)).status,403);
  const beforeReview=ok(await t.api('GET','/api/partner/level',undefined,master.token));
  assert.equal(beforeReview.level,'start');
  assert.equal(beforeReview.verification,'pending');
  assert.equal(beforeReview.metrics.offered,0);
  assert.equal(beforeReview.metrics.opportunityCompletionRate,null);
  assert.equal(beforeReview.recommendation.confidence,'limited');
  assert.equal(beforeReview.privileges.priorityDispatch,false);
  assert.equal(beforeReview.privileges.reducedCommission,false);
  assert.equal(beforeReview.automaticDemotion,false);
  assert.equal((await t.api('POST','/api/admin/partner/levels/'+master.id+'/decision',{
    level:'priority',reason:'Квалификация пока не прошла проверку'
  },admin.token)).status,409);
  ok(await t.api('POST','/api/admin/performers/'+master.id+'/verify',{decision:'approved'},admin.token));
  const afterReview=ok(await t.api('GET','/api/partner/level',undefined,master.token));
  assert.equal(afterReview.verification,'approved');
  assert.equal(afterReview.level,'start','verification does not silently confer priority');
  assert.equal((await t.api('POST','/api/admin/partner/levels/'+master.id+'/decision',{
    level:'active',reason:'Подтвержденный профиль и реальный профессиональный опыт работы'
  },master.token)).status,403);
  const decision=ok(await t.api('POST','/api/admin/partner/levels/'+master.id+'/decision',{
    level:'active',reason:'Подтвержден профиль, проверили рекомендации и работу по профилю'
  },admin.token));
  assert.equal(decision.level,'active');
  assert.equal(decision.automaticFeeChange,false);
  assert.equal(decision.automaticDispatchChange,false);
  const current=ok(await t.api('GET','/api/partner/level',undefined,master.token));
  assert.equal(current.level,'active');
  assert.equal(current.recommendation.candidate,'start','current admin decision is independent of advisory candidate');
  assert.ok(current.lastDecisionReason);
  t.clock.advance(120*86400);
  const overdue=ok(await t.api('GET','/api/partner/level',undefined,master.token));
  assert.equal(overdue.level,'active','past review date never causes automatic downgrade');
  const q=ok(await t.api('GET','/api/admin/partner/levels',undefined,admin.token));
  assert.ok(q.reviewDue.some((x:any)=>x.user_id===master.id));
});

test('self-service level appeal is unique, private and closed only by admin',async()=>{
  assert.equal((await t.api('GET','/api/admin/partner/levels',undefined,master.token)).status,403);
  const reason='В нашем районе было только одно подходящее предложение за месяц, прошу учесть профессиональные статьи';
  const created=ok(await t.api('POST','/api/partner/level/appeal',{message:reason},master.token));
  assert.equal(created.status,'open');
  assert.equal((await t.api('POST','/api/partner/level/appeal',{message:reason},master.token)).status,409);
  assert.equal((await t.api('POST','/api/partner/level/appeal',{message:reason},client.token)).status,403);
  const queue=ok(await t.api('GET','/api/admin/partner/levels',undefined,admin.token));
  assert.ok(queue.appeals.some((a:any)=>a.id===created.id));
  assert.equal((await t.api('POST','/api/admin/partner/appeals/'+created.id+'/resolve',{
    resolution:'Исполнитель действовал обоснованно, проверены сезонность и доступные запросы'
  },master.token)).status,403);
  const resolved=ok(await t.api('POST','/api/admin/partner/appeals/'+created.id+'/resolve',{
    resolution:'Рассмотрены реальные предложения в регионе, информация о низком спросе подтверждена'
  },admin.token));
  assert.equal(resolved.status,'resolved');
  assert.equal((await t.api('POST','/api/admin/partner/appeals/'+created.id+'/resolve',{
    resolution:'Повторная обработка обращений должна быть заблокирована'
  },admin.token)).status,409);
  assert.equal(ok(await t.api('GET','/api/partner/level',undefined,master.token)).appeal,null);
});

test('presence history begins at observation, no artificial prior online hours',async()=>{
  // Create controlled hours relative to the fake clock, not implied historical online time.
  const ended=t.clock.now();
  await t.db.query('insert into partner_presence_events(user_id,line_status,paused,observed_at) values($1,$2,$3,$4)',
    [master.id,'online',false,new Date(ended.getTime()-7200000)]);
  await t.db.query('insert into partner_presence_events(user_id,line_status,paused,observed_at) values($1,$2,$3,$4)',
    [master.id,'offline',false,new Date(ended.getTime()-3600000)]);
  const v=ok(await t.api('GET','/api/partner/level',undefined,master.token));
  assert.ok(v.metrics.observedHours>=1);
  assert.ok(v.metrics.offered===0);
  assert.equal(v.metrics.opportunityDefinition.includes('персонально'),true);
});
