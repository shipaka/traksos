import { useState } from 'react';
import { ModQueue } from './moderation.tsx';
import { SupportQueue } from './support.tsx';
import { Verify, Flagged } from './admin.tsx';

type DeskTab = 'cases' | 'support' | 'verify' | 'flagged';

export function ModeratorDesk() {
  const [tab, setTab] = useState<DeskTab>('cases');
  const options: [DeskTab, string][] = [
    ['cases', 'Споры и жалобы'],
    ['support', 'Обращения'],
    ['verify', 'Проверка мастеров'],
    ['flagged', 'Подозрительные сообщения'],
  ];
  return <main className="moderator-workspace stack">
    <section className="internal-role-hero internal-role-hero-moderator"><span>TRACKSOS · КАЧЕСТВО И БЕЗОПАСНОСТЬ</span><h1>Модерация</h1>
    <p>Рабочая очередь: споры, обращения, проверка партнёров. Финансы и тарифы здесь недоступны.</p></section>
    <div className="moderator-action-grid" aria-label="Быстрый доступ к рабочим очередям">
      {options.map(([key,name],i)=><button type="button" key={key}
        className={tab===key?'moderator-action active':'moderator-action'} onClick={()=>setTab(key)}
        aria-pressed={tab===key}>
        <span aria-hidden="true">{['⚑','▣','✓','◈'][i]}</span>
        <b>{name}</b><small>Открыть рабочий раздел →</small>
      </button>)}
    </div>
    <div className="scroll-x" role="tablist" aria-label="Разделы модерации">
      {options.map(([key, name]) => <button type="button" role="tab" key={key}
        aria-selected={tab === key} className="chip" onClick={() => setTab(key)}>{name}</button>)}
    </div>
    {tab === 'cases' && <ModQueue />}
    {tab === 'support' && <SupportQueue />}
    {tab === 'verify' && <Verify />}
    {tab === 'flagged' && <Flagged />}
  </main>;
}
