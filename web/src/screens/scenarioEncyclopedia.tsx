import { useState } from 'react';
import { Back, useMe } from '../ui.tsx';
import { learningRole } from './platformIntro.tsx';
import { allowedScenario, chooseScenarioOption, scenariosForRole,
  type CourseRole, type Scenario } from './scenarioLibrary.ts';

function progressKey(userId:string,role:CourseRole):string {
  return 'traksos.scenario.progress.v1.'+userId+'.'+role;
}
function loadProgress(userId:string,role:CourseRole):string[] {
  try {
    const values:unknown=JSON.parse(localStorage.getItem(progressKey(userId,role))??'[]');
    return Array.isArray(values) ? values.filter((x):x is string=>typeof x==='string') : [];
  } catch {return [];}
}
function saveProgress(userId:string,role:CourseRole,id:string):void {
  try {
    const next=[...new Set([...loadProgress(userId,role),id])];
    localStorage.setItem(progressKey(userId,role),JSON.stringify(next));
  } catch {/* disabled storage — the course remains available */}
}
function sortedChoiceIndexes(scenario:Scenario,stage:number):number[] {
  // Deterministic reshuffling means the recommended answer is NOT always first.
  // A learner sees stable ordering when returning to a previous step.
  const seed=(scenario.id.split('').reduce((n,c)=>n+c.charCodeAt(0),0)+stage*7)%6;
  const permutations=[[0,1,2],[1,0,2],[2,1,0],[1,2,0],[2,0,1],[0,2,1]];
  return permutations[seed];
}

export function ScenarioEncyclopedia({query=''}:{query?:string}) {
  const {me,mode}=useMe();
  const role=learningRole(mode,me?.roles??[]);
  const [done]=useState<string[]>(()=>me?loadProgress(me.id,role):[]);
  if(!me)return null;
  const cases=scenariosForRole(role,query);
  const total=scenariosForRole(role).length;
  const count=done.filter(id=>scenariosForRole(role).some(s=>s.id===id)).length;
  return <section className="scenario-encyclopedia stack" aria-label="Энциклопедия ситуаций TrakSOS">
    <div className="scenario-heading">
      <div>
        <span className="label">TRAKSOS · УЧЕБНАЯ ЭНЦИКЛОПЕДИЯ</span>
        <h2>Что делать, если что-то пошло не так?</h2>
        <p className="note">Выбирайте реальные по смыслу ситуации и тренируйтесь принимать решения без риска для заказов, денег или аккаунта.</p>
      </div>
      <div className="scenario-progress-chip" aria-label={'Курсы пройдены: '+count+' из '+total}>
        <b>{count} / {total}</b><small>пройдено</small>
      </div>
    </div>
    {!cases.length && <div className="empty">По запросу не найдено ситуаций для вашего кабинета. Попробуйте другое слово.</div>}
    <div className="scenario-catalog-grid">
      {cases.map(s=><a className="scenario-course-card" href={'#/help/case/'+encodeURIComponent(s.id)} key={s.id}>
        <span className="scenario-course-top"><span>{s.category}</span>
          {done.includes(s.id) ? <span className="scenario-completed">Пройдено</span>
            : <span className="scenario-difficulty">{s.difficulty}</span>}
        </span>
        <b>{s.title}</b>
        <p>{s.summary}</p>
        <span className="scenario-course-bottom">
          <small>{s.steps.length} учебных решения</small>
          <strong>{done.includes(s.id)?'Повторить':'Пройти сценарий'} →</strong>
        </span>
      </a>)}
    </div>
    <p className="note">Это справочные тренировки. Они не заменяют экстренные службы, специалиста и рассмотрение реального спора по фактам. При необходимости откройте личную поддержку.</p>
  </section>;
}

export function ScenarioLesson({id}:{id:string}) {
  const {me,mode}=useMe();
  const role=learningRole(mode,me?.roles??[]);
  const scenario=allowedScenario(role,id);
  const [index,setIndex]=useState(0);
  const [selected,setSelected]=useState<number|null>(null);
  const [finished,setFinished]=useState(false);
  const [helpOpen,setHelpOpen]=useState(true);

  if(!me||!scenario)return <main className="stack"><Back to="help" />
    <h1>Курс недоступен</h1><p>Эта ситуация не относится к вашему кабинету. Выберите другую в справке.</p>
    <a className="btn" href="#/help">К энциклопедии</a></main>;
  const stage=scenario.steps[index];
  const response=selected===null?null:chooseScenarioOption(scenario,index,selected);
  const options=sortedChoiceIndexes(scenario,index);
  const restart=()=>{setIndex(0);setSelected(null);setFinished(false);};
  const goNext=()=>{
    if(!response?.recommended)return;
    if(response.finished){
      saveProgress(me.id,role,scenario.id);
      setFinished(true);
    }else{
      setIndex(response.nextStage);
      setSelected(null);
    }
  };
  return <main className="scenario-lesson stack" style={{maxWidth:970}}>
    <Back to="help" />
    <div className="scenario-lesson-title">
      <span className="label">{scenario.category.toUpperCase()} · {scenario.difficulty}</span>
      <h1>{scenario.title}</h1>
      <p className="sub">{scenario.summary}</p>
    </div>
    <div className="training-practice-alert" role="note">
      <strong>ДЕМОНСТРАЦИЯ · БЕЗ НАСТОЯЩИХ ДЕЙСТВИЙ</strong>
      <span>Это обучающий пример. Ни одно решение не создаст заявку, жалобу, платёж, блокировку или уведомление сотрудникам.</span>
    </div>
    {finished?<section className="card stack" role="status">
      <span className="label">СЦЕНАРИЙ ПРОЙДЕН</span>
      <h2>Вы разобрали ситуацию</h2>
      <p>{scenario.outcome}</p>
      <p className="note">На практике любой спор проверяется по конкретным обстоятельствам; обучение не гарантирует исход дела.</p>
      <div className="row" style={{gap:10,flexWrap:'wrap'}}>
        <button type="button" className="btn" onClick={restart}>Пройти ещё раз</button>
        <a className="btn ghost" href="#/help">Другие ситуации</a>
      </div>
      <a href={'#'+scenario.link}>Где это в настоящем кабинете: {scenario.linkLabel}</a>
    </section>:<>
      <div className="between" style={{gap:12,flexWrap:'wrap'}}>
        <b>Решение {index+1} из {scenario.steps.length}</b>
        <span className="note">В конце увидите итог и сможете повторить курс</span>
      </div>
      <div className="training-demo-progress" role="progressbar" aria-label="Прогресс ситуационного курса"
        aria-valuemin={0} aria-valuemax={scenario.steps.length} aria-valuenow={index+1}>
        <span style={{width:(((index+1)/scenario.steps.length)*100)+'%'}} />
      </div>
      <div className="training-demo-workspace">
        <section className="card stack scenario-decision-panel" aria-label="Учебная ситуация">
          <span className="pill accent">СЛУЧАЙ · ДЕМО</span>
          <h2>{stage.situation}</h2>
          <p className="note">Выберите действие. Мы объясним его последствия. Вопрос можно попробовать ещё раз.</p>
          <div className="scenario-answer-list">
            {options.map((optionIndex,i)=>{
              const choice=stage.choices[optionIndex];
              const active=selected===optionIndex;
              return <button key={optionIndex} type="button"
                disabled={selected!==null} aria-pressed={active}
                className={'scenario-answer'+(active?' selected':'')}
                onClick={()=>setSelected(optionIndex)}>
                <span className="scenario-answer-number">{i+1}</span>
                <span>{choice.label}</span>
              </button>;
            })}
          </div>
          {response && <div className={'scenario-feedback '+(response.recommended?'recommended':'caution')} role="status">
            <strong>{response.recommended?'Хороший выбор':'Этот вариант создаст проблемы'}</strong>
            <p>{response.feedback}</p>
          </div>}
          <div className="row scenario-next-controls" style={{gap:8,flexWrap:'wrap'}}>
            <button className="btn ghost" type="button" disabled={index===0}
              onClick={()=>{setIndex(n=>Math.max(0,n-1));setSelected(null);}}>Назад</button>
            {response?.recommended
              ? <button className="btn" type="button" onClick={goNext}>
                  {response.finished?'Показать итог':'Следующая ситуация'}
                </button>
              : response
                ? <button className="btn" type="button" onClick={()=>setSelected(null)}>Попробовать другой вариант</button>
                : <span className="note">Выберите одно из действий</span>}
          </div>
        </section>
        <aside className="scenario-aside stack" aria-label="Подсказки и помощь">
          <section className="card stack">
            <div className="between" style={{gap:8}}>
              <b>Подсказка к ситуации</b>
              <button type="button" className="btn ghost small" aria-expanded={helpOpen}
                onClick={()=>setHelpOpen(v=>!v)}>{helpOpen?'Свернуть':'Открыть'}</button>
            </div>
            {helpOpen&&<>
              <div><span className="label">Где искать</span><p>{stage.where}</p></div>
              <div><span className="label">Зачем это важно</span><p>{stage.why}</p></div>
            </>}
          </section>
          <section className="card stack">
            <b>Полезные разделы</b>
            <a href="#/help">Энциклопедия и поиск по справке</a>
            <a href="#/learn">Знакомство и обычная учебная заявка</a>
            <a href="#/trakbot">TrakBot · личные подсказки</a>
            <a href="#/support/new">Написать в поддержку</a>
            <p className="note">Если вы перейдёте в рабочий раздел, действия там будут настоящими. Этот курс остаётся тренировкой.</p>
          </section>
        </aside>
      </div>
    </>}
  </main>;
}
