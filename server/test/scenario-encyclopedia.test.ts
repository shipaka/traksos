import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scenarioLibrary, scenariosForRole, allowedScenario, chooseScenarioOption,
  type CourseRole,
} from '../../web/src/screens/scenarioLibrary.ts';

const roles:CourseRole[]=['owner','driver','master','tow','service','insurer','inspection','moderator','admin'];

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
