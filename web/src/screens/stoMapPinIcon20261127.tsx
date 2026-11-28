import { useId } from 'react';
import type { MapServiceCategory } from './stoDirectoryPilot20261127.ts';

// Scalable draft interpretation of owner-approved five subjects.
// Only map pins use this illustration; existing 617/618 and service tiles are untouched.
export const mapCategoryLabel: Record<MapServiceCategory,string> = {
  sto:'Грузовое СТО', tyre:'Грузовой шиномонтаж', wash:'Грузовая мойка',
  refrigeration:'Ремонт рефрижераторов', trailer:'Ремонт прицепов'
};
export function StoMapPinIcon({category}:{category:MapServiceCategory}){
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const metal='url(#'+id+'m)', glass='url(#'+id+'g)';
  const wheel=(x:number,y:number)=><g><circle cx={x} cy={y} r="6" fill="#14202b" stroke="#667580" strokeWidth="1.5"/><circle cx={x} cy={y} r="2.6" fill={metal}/></g>;
  const cab=<g><path d="M12 23 19 16h12l5 8v13H12z" fill={metal} stroke="#455a68" strokeWidth="1.5"/><path d="M19 19h11l3 7H16z" fill={glass}/><path d="M15 31h18v4H15z" fill="#304653"/><path d="M15 36h5m8 0h5" stroke="#fff6cb" strokeWidth="2.5"/>{wheel(16,39)}{wheel(32,39)}</g>;
  return <svg className="tr-sto-map-icon" aria-hidden="true" width="36" height="36" viewBox="0 0 48 48">
    <defs>
      <linearGradient id={id+'m'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f7fbff"/><stop offset=".47" stopColor="#aabac5"/><stop offset="1" stopColor="#536674"/></linearGradient>
      <linearGradient id={id+'g'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b4e8f2"/><stop offset="1" stopColor="#223f50"/></linearGradient>
    </defs>
    {category==='sto'&&<g><path d="M4 16 24 4l20 12v28H4z" fill={metal} stroke="#263b48" strokeWidth="1.5"/><path d="M2 17 24 3l22 14" fill="none" stroke="#d9ece5" strokeWidth="3.5" strokeLinejoin="round"/><path d="M9 19h30v25H9z" fill="#23343f"/>{cab}<path d="M18 11h12" stroke="#526a73" strokeWidth="3" strokeLinecap="round"/></g>}
    {category==='wash'&&<g><path d="M5 41V8h38v33h-6V15H11v26z" fill={metal} stroke="#263b48" strokeWidth="1.5"/><path d="M12 13h24" stroke="#83d9ed" strokeWidth="3"/>{cab}<path d="m13 17-4 8m26-8 4 8m-23-9-2 5m18-5 2 5" stroke="#b0edff" strokeWidth="2.5" strokeLinecap="round"/><path d="M4 44h40" stroke="#a6dbe7" strokeWidth="2.5" strokeLinecap="round"/></g>}
    {category==='tyre'&&<g><circle cx="19" cy="24" r="15" fill="#17242c" stroke="#73838d" strokeWidth="3"/><circle cx="19" cy="24" r="9" fill={metal} stroke="#354650" strokeWidth="2"/><circle cx="19" cy="24" r="3.5" fill="#314650"/><path d="M11 12l-3 5m15-7 5 3m4 12-2 5m-7 8-6 1m-9-8-2-5" fill="none" stroke="#adb8be" strokeWidth="1.5"/><path d="m32 10 11 3-1 8-5 1-3 14-6-1 3-15-4-2 1-7z" fill={metal} stroke="#263b48" strokeWidth="1.6"/><path d="m27 15-5-1" stroke="#d4e3e9" strokeWidth="3" strokeLinecap="round"/></g>}
    {category==='refrigeration'&&<g><path d="M4 11h28l8 6v24H4z" fill={metal} stroke="#344955" strokeWidth="1.5"/><path d="M8 15h12v18H8z" fill="#273c4a"/><path d="M10 19h8m-8 4h8m-8 4h8" stroke="#a7c6d4" strokeWidth="1.8"/><path d="M23 14v24M5 40h35" stroke="#d4e1e8" strokeWidth="1.5"/>{wheel(12,42)}{wheel(32,42)}<circle cx="33" cy="21" r="11" fill="#304c60" stroke="#b3e6f4" strokeWidth="1.5"/><path d="M33 12v18m-8-13 16 8m-16 0 16-8m-11-3 3 3 3-3m-6 14 3-3 3 3" stroke="#e5f8ff" strokeWidth="1.7" strokeLinecap="round" fill="none"/></g>}
    {category==='trailer'&&<g><path d="M3 10h42v24H3z" fill={metal} stroke="#3b4f5a" strokeWidth="1.4"/><path d="M6 14h36M6 19h36M6 31h36" stroke="#7e929c" strokeWidth="1.3"/><path d="M4 35h40M10 35v7h-5" stroke="#344953" strokeWidth="3" fill="none"/>{wheel(30,40)}{wheel(40,40)}<path d="M18 15a7 7 0 0 0 8 8L13 36a3 3 0 0 1-4-4l13-13-4-4z" fill="#405969" stroke="#e6f4f9" strokeWidth="1.6"/></g>}
  </svg>;
}
