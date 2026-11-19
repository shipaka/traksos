import {useEffect, useRef, useState} from 'react';
import {go} from '../ui.tsx';
import {Work} from './performer.tsx';
import {Order} from './order.tsx';
import './performerOrderWindow.css';

/**
 * Approved 18 Nov desktop work pattern: keep the real dashboard visible behind a
 * compact order window, with working (not copied/demo) Order actions and data.
 * The Android/mobile view remains full-screen.
 */
export function PerformerOrderWindow({id}:{id:string}) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq=window.matchMedia('(max-width: 820px)');
    const sync=()=>setCompact(mq.matches);
    mq.addEventListener('change',sync);
    return ()=>mq.removeEventListener('change',sync);
  },[]);
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const desktop = window.matchMedia('(min-width: 821px)');
    if (compact || !desktop.matches) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow='hidden';
    close.current?.focus();
    const onKey = (event:KeyboardEvent)=>{
      if (event.key === 'Escape') {
        event.preventDefault();
        go('work');
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )??[]).filter(n=>n.getClientRects().length>0);
      if(!nodes.length) return;
      const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKey);
    return ()=>{
      document.removeEventListener('keydown',onKey);
      document.body.style.overflow=previousOverflow;
      if(previous?.isConnected) previous.focus();
    };
  },[id,compact]);
  // Android / narrow screen: never create a hidden desktop dashboard, GPS watcher
  // or inaccessible modal. Render the original order directly with live actions.
  if (compact) return <Order id={id}/>;
  return <div className="performer-order-workspace">
    <div className="performer-order-desk" aria-hidden="true"><Work background/></div>
    <div className="performer-order-shade" aria-hidden="true" onClick={()=>go('work')}/>
    <section ref={panel} className="performer-order-window" role="dialog"
      aria-modal="true" aria-labelledby="performer-order-dialog-heading">
      <header className="performer-order-window-top">
        <div><small>TrakSos · рабочее место</small>
          <h2 id="performer-order-dialog-heading">Карточка заявки</h2></div>
        <button ref={close} type="button" className="btn ghost small"
          onClick={()=>go('work')} aria-label="Закрыть заявку и вернуться к рабочему столу">
          Закрыть ✕
        </button>
      </header>
      <Order id={id}/>
    </section>
  </div>;
}
