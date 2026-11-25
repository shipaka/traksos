import {useEffect,useRef,type ReactNode} from 'react';

/** Keep the approved native details menu; tolerate short mouse excursions
 * between its trigger and panel without treating touch as hover. */
export function AccountMenuDetails({children}:{children:ReactNode}) {
  const menu=useRef<HTMLDetailsElement>(null);
  const pending=useRef<number|null>(null);
  const cancel=()=>{
    if(pending.current!==null)window.clearTimeout(pending.current);
    pending.current=null;
  };
  const close=()=>{
    cancel();
    if(menu.current)menu.current.open=false;
  };
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      if(menu.current?.open && event.target instanceof Node &&
        !menu.current.contains(event.target))close();
    };
    document.addEventListener('pointerdown',outside,true);
    return ()=>{
      document.removeEventListener('pointerdown',outside,true);
      cancel();
    };
  },[]);
  return <details ref={menu} className="account-menu"
    onPointerEnter={cancel}
    onPointerLeave={event=>{
      if(event.pointerType!=='mouse' ||
        !window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
        !event.currentTarget.open)return;
      cancel();
      pending.current=window.setTimeout(()=>{
        pending.current=null;
        const current=menu.current;
        if(current?.open && !current.matches(':hover'))current.open=false;
      },350);
    }}
    onToggle={()=>{if(!menu.current?.open)cancel();}}
    onBlur={event=>{
      if(event.relatedTarget instanceof Node &&
        !event.currentTarget.contains(event.relatedTarget))close();
    }}
    onKeyDown={event=>{
      if(event.key==='Escape' && event.currentTarget.open){
        close();
        event.currentTarget.querySelector('summary')?.focus();
        event.preventDefault();
      }
    }}
    onClick={event=>{
      // A same-route link or a button may not remount the shell.
      if(event.target instanceof Element &&
        event.target.closest('nav a,nav button'))close();
    }}>
    {children}
  </details>;
}
