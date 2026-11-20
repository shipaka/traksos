import { useState } from 'react';
import { get, fmtTime } from '../api.ts';
import { useLoad } from '../ui.tsx';
import { ModQueue } from './moderation.tsx';
import { SupportQueue } from './support.tsx';
import { Verify, Flagged } from './admin.tsx';

type DeskTab = 'cases' | 'support' | 'verify' | 'flagged' | 'log';

export function ModeratorDesk() {
  const [tab, setTab] = useState<DeskTab>('cases');
  const cases = useLoad<any>(() => get('/api/mod/cases?kind=dispute'), [], e => e.type==='mod_case');
  const urgent = cases.data?.items?.filter((c:any)=>c.priority===1).length;
  const total = cases.data?.counts
    ? Object.values(cases.data.counts as Record<string,number>).reduce((a,b)=>a+b,0) : undefined;
  const focus = cases.data?.items?.[0];
  const options: [DeskTab, string][] = [
    ['cases', 'Споры и жалобы'],
    ['support', 'Обращения'],
    ['verify', 'Проверка мастеров'],
    ['flagged', 'Подозрительные сообщения'],
    ['log', 'Журнал решений'],
  ];
  return <main className="moderator-workspace stack">
    <section className="internal-role-hero internal-role-hero-moderator"><span>TRAKSOS · КАЧЕСТВО И БЕЗОПАСНОСТЬ</span><h1>Модерация</h1>
    <p>Рабочая очередь площадки. Финансы, статистика, тарифы и настройки здесь недоступны.</p></section>
    <div className="and20-moderator-metrics" aria-label="Состояние очереди модерации">
      <div><small>В очереди</small><strong>{total??'—'}</strong></div>
      <div><small>Срочные споры</small><strong>{urgent??'—'}</strong></div>
      <div><small>Проверка</small><strong>По списку</strong></div>
    </div>
    <div className="moderator-action-grid" aria-label="Быстрый доступ к рабочим очередям">
      {options.filter(([key])=>key!=='flagged').map(([key,name],i)=><button type="button" key={key}
        className={tab===key?'moderator-action active':'moderator-action'} onClick={()=>setTab(key)}
        aria-pressed={tab===key}>
        <span aria-hidden="true">{['⚖','▣','✓','☷'][i]}</span>
        <b>{name}</b><small>Открыть рабочий раздел →</small>
      </button>)}
    </div>
    {focus&&tab==='cases'&&<a className="and20-moderator-focus" href={'#/admin/case/'+encodeURIComponent(focus.id)}>
      <span className="and20-state">{focus.priority===1?'Срочно':'Требует проверки'}</span>
      <strong>Обращение №{focus.number??'—'}</strong>
      <span>{focus.title||'Спор по заявке'}</span>
      <small>Поступило {fmtTime(focus.createdAt)}</small>
      <b>Открыть дело ›</b>
    </a>}
    <div className="scroll-x" role="tablist" aria-label="Разделы модерации">
      {options.map(([key, name]) => <button type="button" role="tab" key={key}
        aria-selected={tab === key} className="chip" onClick={() => setTab(key)}>{name}</button>)}
    </div>
    {tab === 'cases' && <ModQueue />}
    {tab === 'log' && <ModQueue key="journal" initialKind="log" />}
    {tab === 'support' && <SupportQueue />}
    {tab === 'verify' && <Verify />}
    {tab === 'flagged' && <Flagged />}
  </main>;
}
