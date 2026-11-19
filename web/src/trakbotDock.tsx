import { useEffect, useRef, useState } from 'react';
import { TrakBotChat } from './screens/trakbot.tsx';

/** A user-opened side assistant, never a popup on its own. No public-feed activity. */
export function TrakBotDock({ authenticated }: { authenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedRef = useRef(false);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    const navigation = () => setOpen(false);
    document.addEventListener('keydown', escape);
    window.addEventListener('hashchange', navigation);
    if (!openedRef.current) { closeRef.current?.focus(); openedRef.current = true; }
    return () => {
      document.removeEventListener('keydown', escape);
      window.removeEventListener('hashchange', navigation);
      openedRef.current = false;
    };
  }, [open]);

  return (
    <aside className="trakbot-dock" aria-label="Помощник TrakBot">
      {open && <div className="trakbot-dock-panel" role="dialog" aria-label="TrakBot — личный помощник" aria-modal="false">
        <header className="trakbot-dock-head">
          <div className="trakbot-dock-brand"><span className="trakbot-dock-avatar" aria-hidden="true">T</span>
            <span><b>TrakBot</b><small>На связи, когда нужен</small></span></div>
          <button ref={closeRef} type="button" className="trakbot-dock-close" onClick={close} aria-label="Закрыть TrakBot">×</button>
        </header>
        {authenticated ? <TrakBotChat compact onNavigate={() => setOpen(false)} /> :
          <div className="trakbot-dock-guest">
            <p>Здорово! Могу показать, как устроен TrakSOS. А личный диалог по машине доступен после входа.</p>
            <nav aria-label="Что посмотреть в TrakSOS">
              <a href="#/explore/van" onClick={() => setOpen(false)}>Услуги и выездная помощь</a>
              <a href="#/join" onClick={() => setOpen(false)}>Как стать партнёром</a>
              <a href="#/offers" onClick={() => setOpen(false)}>Условия и документы</a>
              <a href="#/login" onClick={() => setOpen(false)}>Войти и поговорить с TrakBot</a>
            </nav>
            <p className="note">Подсказки ИИ справочные, не заменяют диагностику.</p>
          </div>}
      </div>}
      <button ref={triggerRef} type="button" className="trakbot-dock-launcher"
        aria-label={open ? 'Закрыть TrakBot' : 'Открыть TrakBot'} aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <span className="trakbot-dock-mark" aria-hidden="true">{open ? '×' : 'T'}</span>
        <span className="trakbot-dock-label">{open ? 'Закрыть' : 'TrakBot'}</span>
      </button>
    </aside>
  );
}
