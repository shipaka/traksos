import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ModQueue } from './moderation.tsx';
import { SupportQueue } from './support.tsx';
import { Verify, Flagged } from './admin.tsx';
import { NavGlyph } from '../navGlyph.tsx';
import '../moderatorWorkspace20261124.css';

type DeskTab = 'cases' | 'support' | 'verify' | 'flagged';
const OPTIONS: { key: DeskTab; label: string; glyph: string }[] = [
  { key: 'cases', label: 'Споры и жалобы', glyph: '⚑' },
  { key: 'support', label: 'Обращения', glyph: 'chat' },
  { key: 'verify', label: 'Проверка мастеров', glyph: 'check' },
  { key: 'flagged', label: 'Подозрительные сообщения', glyph: 'alert' },
];

export function ModeratorDesk({initialTab='cases'}:{initialTab?:DeskTab}={}) {
  const [tab, setTab] = useState<DeskTab>(initialTab);
  const tabButtons = useRef<Partial<Record<DeskTab, HTMLButtonElement | null>>>({});

  // The same mounted component is reused for #/moderation/* routes. A sidebar
  // or direct-link change must override the previous local tab selection.
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: DeskTab) => {
    const index = OPTIONS.findIndex(item => item.key === current);
    const next = event.key === 'ArrowRight' ? (index + 1) % OPTIONS.length
      : event.key === 'ArrowLeft' ? (index + OPTIONS.length - 1) % OPTIONS.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? OPTIONS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    const key = OPTIONS[next].key;
    setTab(key);
    tabButtons.current[key]?.focus();
  };
  const activeLabel = OPTIONS.find(option => option.key === tab)?.label ?? OPTIONS[0].label;

  return <main className="moderator-workspace stack">
    <section className="internal-role-hero internal-role-hero-moderator"><span>TRAKSOS · КАЧЕСТВО И БЕЗОПАСНОСТЬ</span><h1>Модерация</h1>
    <p>Рабочая очередь площадки. Финансы, статистика, тарифы и настройки здесь недоступны.</p></section>
    <div className="moderator-action-grid" aria-label="Быстрый доступ к рабочим очередям">
      {OPTIONS.map(({key,label,glyph})=><button type="button" key={key}
        className={tab===key?'moderator-action active':'moderator-action'}
        onClick={()=>setTab(key)} aria-pressed={tab===key}>
        <span aria-hidden="true"><NavGlyph glyph={glyph}/></span>
        <b>{label}</b><small>Открыть рабочий раздел →</small>
      </button>)}
    </div>
    {/* Preserve the approved desktop tab strip. On mobile the action cards
        already provide the same four controls; avoid a duplicate strip. */}
    <div className="scroll-x moderator-desk-tabs" role="tablist" aria-label="Разделы модерации">
      {OPTIONS.map(({key,label})=><button type="button" role="tab" key={key}
        id={`moderator-desk-tab-${key}`} aria-controls="moderator-desk-panel"
        ref={element=>{ tabButtons.current[key] = element; }}
        tabIndex={tab === key ? 0 : -1}
        aria-selected={tab === key} className="chip"
        onKeyDown={event=>onTabKey(event,key)}
        onClick={()=>setTab(key)}>{label}</button>)}
    </div>
    <div id="moderator-desk-panel" role="tabpanel" aria-label={`Рабочий раздел · ${activeLabel}`}
      aria-labelledby={`moderator-desk-tab-${tab}`} tabIndex={0}>
      {tab === 'cases' && <ModQueue />}
      {tab === 'support' && <SupportQueue />}
      {tab === 'verify' && <Verify />}
      {tab === 'flagged' && <Flagged />}
    </div>
  </main>;
}
