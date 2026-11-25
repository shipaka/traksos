import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceKindFor, practiceStages } from '../../web/src/screens/trainingDemoModel.ts';
import {
  scenarioLibrary, scenariosForRole, allowedScenario, chooseScenarioOption,
  type CourseRole,
} from '../../web/src/screens/scenarioLibrary.ts';

const roles:CourseRole[]=['owner','driver','master','tow','service','insurer','inspection','courier','moderator','admin'];

test('each role receives its own curated and searchable scenario encyclopedia',()=>{
  const names=new Set<string>();
  for(const item of scenarioLibrary) {
    assert.match(item.id,/^[a-z][a-z0-9-]+$/);
    assert.equal(names.has(item.id),false,'duplicate scenario id: '+item.id);
    names.add(item.id);
    assert.ok(item.title.length>12,item.id);
    assert.ok(item.summary.length>20,item.id);
    assert.ok(item.outcome.length>20,item.id);
    assert.ok(item.steps.length>=3,item.id);
    assert.ok(item.link.startsWith('/')&&!item.link.includes('://'),item.id);
    assert.ok(item.roles.length>=1,item.id);
    for(const role of item.roles) assert.ok(roles.includes(role),item.id+': invalid role');
  }
  for(const role of roles) {
    const library=scenariosForRole(role);
    assert.ok(library.length>=2,role+' needs more than one situation');
    assert.ok(library.every(s=>s.roles.includes(role)),role+' leaked another role');
    assert.ok(library.every(s=>allowedScenario(role,s.id)?.id===s.id),role+' cannot open its case');
    assert.ok(scenariosForRole(role,'несуществующий-специальный-запрос').length===0);
  }
  assert.ok(scenariosForRole('master','клиент отказывается платить').some(s=>s.id==='refuses-to-pay'));
  assert.ok(scenariosForRole('owner','сумма выше').some(s=>s.id==='bill-changed'));
  assert.ok(scenariosForRole('driver','мастер не приехал').some(s=>s.id==='no-show'));
  assert.ok(scenariosForRole('admin','поддержка не ответила').some(s=>s.id==='admin-escalation'));
  assert.ok(scenariosForRole('inspection','ошибка в данных').some(s=>s.id==='inspection-conflict'));
});

test('only intended roles can see their cases even when they guess a URL',()=>{
  assert.equal(allowedScenario('service','advert-in-air'),null);
  assert.equal(allowedScenario('tow','bill-changed'),null);
  assert.equal(allowedScenario('driver','refuses-to-pay'),null);
  assert.equal(allowedScenario('insurer','moderator-conflict'),null);
  assert.ok(allowedScenario('master','refuses-to-pay'));
  assert.ok(allowedScenario('owner','advert-in-air'));
  assert.ok(allowedScenario('moderator','advert-in-air'));
  assert.equal(allowedScenario('driver','wrong-id'),null);
});

test('every case has three meaningful decisions and one recommended outcome per step',()=>{
  for(const scenario of scenarioLibrary) {
    scenario.steps.forEach((step,index)=>{
      assert.ok(step.situation.length>20,scenario.id+': situation');
      assert.ok(step.where.length>8,scenario.id+': location');
      assert.ok(step.why.length>15,scenario.id+': rationale');
      assert.equal(step.choices.length,3,scenario.id+': choice count');
      assert.equal(step.choices.filter(x=>x.recommended).length,1,scenario.id+': must not silently accept a harmful answer');
      const labels=new Set(step.choices.map(x=>x.label));
      assert.equal(labels.size,step.choices.length,scenario.id+': options must differ');
      for(const choice of step.choices) {
        assert.ok(choice.label.length>14,scenario.id+': short action');
        assert.ok(choice.feedback.length>25,scenario.id+': explain consequences');
      }
      const goodIndex=step.choices.findIndex(x=>x.recommended);
      const good=chooseScenarioOption(scenario,index,goodIndex);
      assert.equal(good.valid,true);
      assert.equal(good.recommended,true);
      assert.equal(good.finished,index===scenario.steps.length-1);
      assert.equal(good.nextStage,Math.min(index+1,scenario.steps.length-1));
      for(const [j,choice] of step.choices.entries()) {
        if(choice.recommended) continue;
        const bad=chooseScenarioOption(scenario,index,j);
        assert.equal(bad.valid,true);
        assert.equal(bad.recommended,false);
        assert.equal(bad.nextStage,index,'unsafe action must not skip course');
        assert.equal(bad.finished,false);
        assert.equal(bad.feedback,choice.feedback);
      }
    });
  }
});

test('invalid scenario inputs never advance or complete',()=>{
  const s=scenarioLibrary[0];
  for(const [stage,answer] of [[-1,0],[s.steps.length,0],[0,-1],[0,42],[1,1.5]]){
    const x=chooseScenarioOption(s,stage,answer);
    assert.equal(x.valid,false);
    assert.equal(x.finished,false);
  }
});

test('real staff escalation is taught accurately and does not auto-create a ticket',()=>{
  const admin=allowedScenario('admin','admin-escalation');
  assert.ok(admin);
  const text=admin.steps.map(x=>x.situation+' '+x.why+' '+x.choices.map(c=>c.feedback).join(' ')).join(' ');
  assert.match(text,/модератор/);
  assert.match(text,/60 минут/);
  assert.match(text,/администратор/);
  assert.match(allowedScenario('master','refuses-to-pay')?.steps[2].why??'',/модератор/);
  assert.match(allowedScenario('driver','no-show')?.summary??'',/пропал/);
  // Only help routes are suggested; there is no attempt to call a production endpoint.
  assert.ok(scenarioLibrary.every(x=>x.link.startsWith('/')));
});


test('performer training explains the actual immutable 0% promotion and fee cap',()=>{
  const closing=practiceStages.performer.find(s=>s.title.includes('В истории'));
  assert.ok(closing,'performer practice must end with real finance guidance');
  assert.match(closing.explanation,/5 000 ₽/);
  assert.match(closing.explanation,/0%/);
  assert.match(closing.explanation,/баллов мастера равны нулю/);
  assert.match(closing.why,/при создании реальной заявки/);
});

test('owner and driver course teaches the real verified-only dispatch policy',()=>{
  for(const role of ['owner','driver'] as const){
    const item=allowedScenario(role,'verified-only-search');
    assert.ok(item,role+' must receive verification choices');
    assert.equal(item.steps.length,3);
    const teaching=item.steps.map(step=>step.situation+' '+step.where+' '+step.why+' '+step.choices.map(c=>c.feedback).join(' ')).join(' ');
    assert.match(teaching,/Только проверенные/);
    assert.match(teaching,/непроверенн/);
    assert.match(teaching,/сервер сохранит/);
  }
  assert.equal(allowedScenario('master','verified-only-search'),null);
  assert.equal(allowedScenario('insurer','verified-only-search'),null);
});

test('courier has a private role-specific training path and truthful handover sequence',()=>{
  assert.equal(practiceKindFor('courier'),'courier');
  assert.equal(practiceKindFor('inspection'),'inspection');
  assert.equal(practiceStages.courier.length,7);
  assert.match(practiceStages.courier[4].explanation,/код/i);
  assert.match(practiceStages.courier[5].explanation,/подтверждает сам клиент/i);
  const courier=scenariosForRole('courier');
  assert.ok(courier.length>=3,'courier should have two private situations and safe common cases');
  assert.ok(courier.some(s=>s.id==='courier-code-handover'));
  assert.ok(courier.some(s=>s.id==='courier-code-locked'));
  assert.ok(courier.some(s=>s.id==='app-not-working'));
  for(const id of ['courier-code-handover','courier-code-locked']){
    const scenario=allowedScenario('courier',id);
    assert.ok(scenario);
    assert.equal(scenario.steps.length,3);
    for(const wrongRole of ['owner','driver','master','tow','service','insurer','inspection','moderator','admin'] as const)
      assert.equal(allowedScenario(wrongRole,id),null,wrongRole+' should not receive courier case');
    const text=scenario.steps.map(x=>x.situation+' '+x.why+' '+x.choices.map(c=>c.label).join(' ')).join(' ');
    assert.match(text,/код/i);
  }
  assert.ok(courier.every(x=>x.link.startsWith('/')));
});

test('training explains settlement separately from confirming the quote',()=>{
  const stages=Object.values(practiceStages).flat();
  const closing=stages.find(x=>x.title==='7. В истории');
  assert.ok(closing);
  assert.match(closing.explanation,/после подтверждённой оплаты/);
  assert.match(closing.explanation,/финансовых начислений здесь нет/);
});


test('calendar training separates pending proposals, reservations and actual availability by role',()=>{
  for(const role of ['owner','driver','master','tow'] as const){
    const item=allowedScenario(role,'calendar-reservation-conflict');
    assert.ok(item);
    assert.equal(item.steps.length,3);
    const text=item.steps.map(step=>step.situation+' '+step.why+' '+step.choices.map(c=>c.feedback).join(' ')).join(' ');
    assert.match(text,/желаемое время не обещает/);
    assert.match(text,/блокирует отправку и оплату/);
    assert.match(text,/неистёкший подтверждённый резерв/);
    assert.match(text,/пустой календарь не гарантирует/);
    assert.equal(item.link,'/help','course must not link a performer to a customer-only calendar');
  }
  for(const role of ['insurer','service','inspection','courier','moderator','admin'] as const)
    assert.equal(allowedScenario(role,'calendar-reservation-conflict'),null);
});

test('fleet course distinguishes scoped estimated budget, SOS and ambiguous owner decisions',()=>{
  for(const role of ['owner','driver'] as const){
    const item=allowedScenario(role,'driver-limit');
    assert.ok(item);
    const text=item.steps.map(x=>x.situation+' '+x.why+' '+x.choices.map(c=>c.label+' '+c.feedback).join(' ')).join(' ');
    assert.match(text,/расходы текущего автопарка/);
    assert.match(text,/предварительную стоимость вызова/);
    assert.match(text,/не гарантирует потолок итогового счёта/);
    assert.match(text,/SOS остаётся доступен при действующей привязке/);
    assert.match(text,/проверить фактический статус/);
    const last=item.steps.at(-1)!;
    assert.match(last.choices.find(c=>c.recommended)!.label,/проверить фактический статус/);
  }
  assert.equal(allowedScenario('master','driver-limit'),null);
});
