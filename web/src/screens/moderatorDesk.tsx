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
  return <main>
    <h1>Модерация</h1>
    <p className="sub">Рабочая очередь площадки. Финансы, статистика, тарифы и настройки здесь недоступны.</p>
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
