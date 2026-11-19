import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  customerStageFor, nextPracticeStage, practiceKindFor, practiceStages, type PracticeKind,
} from '../../web/src/screens/trainingDemoModel.ts';

test('onboarding training scenarios cover all TrakSOS cabinet roles safely', () => {
  const variants: Record<string,PracticeKind> = {
    owner:'customer',driver:'customer',master:'performer',tow:'performer',
    service:'service',insurer:'insurance',inspection:'insurance',
    moderator:'staff',admin:'staff',
  };
  for(const [role,kind] of Object.entries(variants)) {
    assert.equal(practiceKindFor(role),kind,role);
    const steps=practiceStages[kind];
    assert.ok(steps.length>=4,role);
    for(const step of steps) {
      for(const field of ['title','explanation','where','why','button','status'] as const)
        assert.ok(step[field].trim().length>3,role+': missing '+field);
    }
  }
});

test('test customer order cannot proceed without meaningful problem details', () => {
  const draft={vehicle:'Scania R520 · учебный',service:'Выездной мастер',problem:''};
  assert.equal(nextPracticeStage('customer',0,draft),1);
  assert.equal(nextPracticeStage('customer',1,draft),1);
  assert.equal(nextPracticeStage('customer',1,{...draft,problem:'???'}),1);
  assert.equal(nextPracticeStage('customer',1,{...draft,problem:'Не заводится грузовик'}),2);
  assert.equal(nextPracticeStage('customer',1,{...draft,vehicle:'',problem:'Не заводится грузовик'}),1);
});

test('scenario actions follow the correct sequence and can restart', () => {
  const input={vehicle:'Scania R520',problem:'Не запускается двигатель',service:'Выездной мастер'};
  for(const kind of Object.keys(practiceStages) as PracticeKind[]) {
    const steps=practiceStages[kind];
    let index=0;
    for(let i=1;i<steps.length;i++) {
      index=nextPracticeStage(kind,index,input);
      assert.equal(index,i,kind+' step '+i);
    }
    assert.equal(nextPracticeStage(kind,index,input),0);
    assert.equal(nextPracticeStage(kind,999,input),0);
    assert.equal(nextPracticeStage(kind,-1,input),0);
  }
  const performer=practiceStages.performer.map(x=>x.status);
  assert.ok(performer.indexOf('Выехал') > performer.indexOf('Принято'));
  assert.ok(performer.indexOf('На месте') > performer.indexOf('Выехал'));
  assert.ok(performer.indexOf('Завершено') > performer.indexOf('На месте'));
});

test('training model never contains payment execution or API request controls', () => {
  const all=Object.values(practiceStages).flat().map(s=>
    [s.title,s.explanation,s.where,s.why,s.button,s.status].join(' ')).join('\n');
  assert.doesNotMatch(all,/https?:\/\/|api\/orders|api\/payments|отправить SMS-код/i);
  assert.match(all,/справк|истори|заявк/i);
  assert.match(all,/демонстрац|учебн|вымышлен|тренаж/i);
});


test('phone consultations and workshop appointments never pretend a master drove to the car', () => {
  for (const option of ['СТО','Консультация по телефону']) {
    const steps=Array.from({length:practiceStages.customer.length},(_,i)=>customerStageFor(option,i));
    const text=steps.map(x=>[x.title,x.status,x.explanation,x.button].join(' ')).join('\n');
    assert.doesNotMatch(text,/исполнитель выехал|показать прибытие|«Выехал»|статус «На месте»/i,option);
    assert.ok(steps[4].status!==practiceStages.customer[4].status,option);
    assert.ok(steps[6].status!==practiceStages.customer[6].status,option);
    assert.match(steps[8].where,/История/);
  }
  assert.equal(customerStageFor('Выездной мастер',5).status,'Выехал');
  assert.equal(customerStageFor('Эвакуатор',6).status,'На месте');
});
