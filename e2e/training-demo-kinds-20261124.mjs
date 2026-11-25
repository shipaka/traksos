// PR #274 · TRAINING-DEMO-KINDS: pure model regression, no server, SMS,
// money, database, private vehicle data or browser mocks.
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({
  entryPoints:['web/src/screens/trainingDemoModel.ts'],
  bundle:true,write:false,platform:'node',format:'esm',
});
const data='data:text/javascript;base64,'+
  Buffer.from(bundle.outputFiles[0].text).toString('base64');
const {practiceKindFor,practiceStages,nextPracticeStage,customerStageFor}=await import(data);

const required={
  owner:'customer',driver:'customer',
  master:'performer',tow:'performer',master_service:'performer',
  service:'service',insurer:'insurance',inspection:'inspection',
  courier:'courier',moderator:'staff',admin:'staff',
};
for(const [role,kind] of Object.entries(required)){
  assert.equal(practiceKindFor(role),kind,'Wrong learning kind for '+role);
  const stages=practiceStages[kind];
  assert.ok(stages?.length>=3,'Missing safe role training: '+role);
  for(const [i,step] of stages.entries()){
    assert.ok(step.title&&step.explanation&&step.where&&step.why&&step.button&&step.status,
      'Incomplete learning step '+role+' #'+(i+1));
    assert.equal(nextPracticeStage(kind,i,{
      vehicle:'Учебный грузовик',problem:'Учебная неисправность',service:'Выездной мастер',
    }),i===stages.length-1?0:i+1,
    'Training stage cannot proceed/restart in '+role);
  }
}
assert.notEqual(practiceKindFor('courier'),practiceKindFor('moderator'),
  'Courier unexpectedly sees staff moderation workflow');
assert.notEqual(practiceKindFor('inspection'),practiceKindFor('insurer'),
  'Inspection unexpectedly sees insurance offers workflow');
assert.match(practiceStages.courier[4].explanation,/шестизначный код/);
assert.match(practiceStages.courier[5].explanation,/клиент/);
assert.match(practiceStages.courier[5].explanation,/отдельным действием/);
assert.ok(practiceStages.courier.every(x=>!/реальный код курьера здесь:/i.test(x.explanation)),
  'Training must not expose real delivery codes');
assert.match(practiceStages.inspection[2].explanation,/фактическим осмотром/);
assert.match(practiceStages.inspection.at(-1).explanation,/документы не оформлены/);
const input={vehicle:'Учебный грузовик',problem:'',service:'Выездной мастер'};
assert.equal(nextPracticeStage('customer',1,input),1,'Customer cannot skip problem');
input.problem='Не заводится';
assert.equal(nextPracticeStage('customer',1,input),2);
for(const service of ['СТО','Консультация по телефону']){
  assert.ok(!/Выехал/.test(customerStageFor(service,5).status),
    'Non-road customer service must not simulate departure');
}
const insuranceInput={vehicle:'Учебный грузовик',problem:'Учебное ОСАГО',service:'Страхование'};
assert.equal(nextPracticeStage('customer',5,insuranceInput),5,'Insurance selection must be explicit');
assert.equal(nextPracticeStage('customer',5,{...insuranceInput,chosenOffer:'real-id'}),5);
for(const chosenOffer of ['demo-a','demo-b']){
  for(let index=0;index<practiceStages.customer.length;index++){
    assert.equal(nextPracticeStage('customer',index,{...insuranceInput,chosenOffer}),index===8?0:index+1);
    const stage=customerStageFor('Страхование',index);
    assert.ok(stage.title&&stage.explanation&&stage.button&&stage.status);
    assert.ok(!/^(Выехал|На месте)$/.test(stage.status),'Insurance must not simulate a road call');
  }
}
assert.match(customerStageFor('Страхование',5).status,/Предложения/);
assert.match(customerStageFor('Страхование',7).status,/Полис отправлен/);
assert.match(customerStageFor('Страхование',8).status,/Демо завершено/);
console.log('PASS training-demo-kinds: all role state machines, courier hand-off, inspection, no external actions');
