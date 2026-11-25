/** One scalable TrakSOS service icon system. Existing approved photography and TrakBot are untouched. */
import type {ReactNode} from 'react';

export type TrakServiceIconKind = 'van'|'master'|'tow'|'sto'|'service'|'insurance'|'insurer'|
  'consult'|'parts'|'tech'|'ecu'|'inspection'|'courier'|'orders';

/** Chrome/amber glyphs for small navigation and full-size service tiles; no bitmap backplate. */
export function TrakServiceIcon({kind,size=48}:{kind:TrakServiceIconKind;size?:number}) {
  // Keep the markup literally identical for each public/partner role alias.
  // Shared SVG definitions intentionally have the same IDs and colour stops;
  // it is safe for duplicate instances because their definitions are identical.
  const canonical=kind==='master'?'van':kind==='service'?'sto':kind==='insurer'?'insurance':kind;
  const prefix=canonical;
  const metal='trMetal'+prefix, gold='trGold'+prefix, glass='trGlass'+prefix;
  const m='url(#'+metal+')', g='url(#'+gold+')', v='url(#'+glass+')';
  const edge='#d3e2ef';
  let shape:ReactNode;
  switch(kind){
    case 'tow':
      shape=<>
        <path d="M2.5 31h28l4-9h6l5 6v11H2.5z" fill={m} stroke={edge} strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M3.5 30h28v4H3.5z" fill={g}/>
        <path d="M34.5 23h6l4 6h-10z" fill={v} stroke={edge} strokeWidth=".7"/>
        <path d="M7 23l4.2-6.3h11.5L28 23v3H7z" fill={m} stroke={edge} strokeWidth="1.6" strokeLinejoin="round"/>
        <path d="M13 18.5h8.2l2.9 4.5H10.7z" fill={v}/>
        <circle cx="11" cy="27" r="2.5" fill="#0c1725" stroke={edge} strokeWidth="1.6"/>
        <circle cx="25" cy="27" r="2.5" fill="#0c1725" stroke={edge} strokeWidth="1.6"/>
        <circle cx="12" cy="40" r="4.3" fill="#101b2b" stroke={g} strokeWidth="2.5"/>
        <circle cx="37" cy="40" r="4.3" fill="#101b2b" stroke={g} strokeWidth="2.5"/>
        <path d="M35 18h7v3h-7z" fill={g}/>
        <path d="M38.5 16v2m-3 1.5h-2m8 0h2" stroke="#ffd56c" strokeWidth="1.7" strokeLinecap="round"/>
      </>;break;
    case 'sto':
    case 'service':
      shape=<>
        <path d="M5 21 24 8l19 13v22H5z" fill={m} stroke={edge} strokeWidth="1.1" strokeLinejoin="round"/>
        <path d="M3 21 24 6l21 15" fill="none" stroke={g} strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M11 25h26v18H11z" fill="#08121e" stroke={edge} strokeWidth="1.2"/>
        <path d="M15 35l3.5-5.5h11L34 35v5H15z" fill={v} stroke={edge} strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M19 31h10l3 4H16.6z" fill={m}/>
        <circle cx="20" cy="40" r="2" fill={g}/><circle cx="29.5" cy="40" r="2" fill={g}/>
        <path d="M28 12a5 5 0 0 0-6.2 5.7l-4.9 5a2 2 0 0 0 2.8 2.8l5-4.9A5 5 0 0 0 30 15l-3.2 3.2-2.8-.8-.7-2.7z" fill={g}/>
      </>;break;
    case 'van':
    case 'master':
      shape=<>
        <path d="M4 19h25l9 9h5v13H4z" fill={m} stroke={edge} strokeWidth="1.6" strokeLinejoin="round"/>
        <path d="M29 20v11h11l-9-11z" fill={v} stroke={edge} strokeWidth="1.2"/>
        <path d="M6 33h35" stroke={g} strokeWidth="3.5" strokeLinecap="round"/>
        <circle cx="13" cy="41" r="4.5" fill="#111928" stroke={g} strokeWidth="2.5"/>
        <circle cx="34" cy="41" r="4.5" fill="#111928" stroke={g} strokeWidth="2.5"/>
        <path d="M21 23a5.1 5.1 0 0 0-6 6.5l-6 6a2 2 0 0 0 3 3l6-6a5.1 5.1 0 0 0 6-6l-3 3-2.8-1.1L18 26z" fill={g} stroke="#ffdb72" strokeWidth=".4"/>
        <path d="M34 17h5v2h-5z" fill={g}/>
      </>;break;
    case 'insurance':
    case 'insurer':
      shape=<>
        <path d="M24 3 42 10v13c0 11-6.8 18-18 22C12.8 41 6 34 6 23V10z" fill={m} stroke={g} strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="m15 25 6 6 13-13" fill="none" stroke={g} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M14 13h15" stroke={edge} strokeWidth="1.6" strokeLinecap="round"/>
      </>;break;
    case 'consult':
      shape=<>
        <path d="M8 25v-5a16 16 0 0 1 32 0v6" fill="none" stroke={g} strokeWidth="4.2" strokeLinecap="round"/>
        <rect x="4" y="23" width="10" height="17" rx="4" fill={m} stroke={edge} strokeWidth="1.5"/>
        <rect x="34" y="23" width="10" height="17" rx="4" fill={m} stroke={edge} strokeWidth="1.5"/>
        <path d="M39 39c0 5-7 6-13 6" fill="none" stroke={g} strokeWidth="2.6" strokeLinecap="round"/>
        <rect x="22" y="41" width="7" height="5" rx="2.5" fill={g}/>
        <path d="M18 21h12a3 3 0 0 1 3 3v7H24l-5 4v-4h-4v-7a3 3 0 0 1 3-3z" fill={v} stroke={edge} strokeWidth="1.1"/>
      </>;break;
    case 'parts':
      shape=<>
        <path d="M6 17 23 8l18 9v20L23 46 6 37z" fill={m} stroke={edge} strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M6 17 23 27l18-10M23 27v19" fill="none" stroke={g} strokeWidth="2.8" strokeLinejoin="round"/>
        <path d="M15 12.3 33 22M29 11l-17 10" fill="none" stroke="#f6be5f" strokeWidth="1.4"/>
        <circle cx="32" cy="34" r="7" fill="#0b1421" stroke={g} strokeWidth="2.8"/>
        <circle cx="32" cy="34" r="2.8" fill={v}/>
      </>;break;
    case 'tech':
      shape=<>
        <rect x="6" y="6" width="36" height="28" rx="3" fill={m} stroke={edge} strokeWidth="1.7"/>
        <path d="M9 29V10h30v19z" fill="#091625"/>
        <path d="M4 35h40l-4 6H8z" fill={m} stroke={g} strokeWidth="2" strokeLinejoin="round"/>
        <path d="M14 24h17l-3-7H16zM17 17h11M12 28h26" fill="none" stroke={g} strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="18" cy="26" r="2" fill={g}/><circle cx="29" cy="26" r="2" fill={g}/>
      </>;break;
    case 'ecu':
      shape=<>
        <rect x="10" y="10" width="28" height="28" rx="4" fill={m} stroke={g} strokeWidth="2.6"/>
        <rect x="18" y="18" width="12" height="12" rx="2" fill={v} stroke={edge} strokeWidth="1"/>
        <path d="M17 4v6m7-6v6m7-6v6m-14 28v6m7-6v6m7-6v6M4 17h6m-6 7h6m-6 7h6m28-14h6m-6 7h6m-6 7h6" fill="none" stroke={g} strokeWidth="2.4" strokeLinecap="round"/>
      </>;break;
    case 'inspection':
      shape=<>
        <rect x="9" y="6" width="30" height="39" rx="4" fill={m} stroke={edge} strokeWidth="1.7"/>
        <path d="M18 5h12v7H18z" fill={g} stroke="#ffe5a1" strokeWidth="1"/>
        <path d="m16 22 3 3 5-6m-8 16 3 3 5-6" fill="none" stroke={g} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M28 23h6M28 35h6" stroke={edge} strokeWidth="1.6" strokeLinecap="round"/>
      </>;break;
    case 'courier':
      shape=<>
        <path d="M3 18h25l10 10h6v13H3z" fill={m} stroke={edge} strokeWidth="1.6"/>
        <path d="M28 20v12h13l-10-12z" fill={v} stroke={edge} strokeWidth="1"/>
        <rect x="9" y="22" width="14" height="12" rx="1.5" fill={g}/>
        <path d="M16 22v12m-7-6h14" stroke="#ae5615" strokeWidth="1.4"/>
        <circle cx="12" cy="42" r="4" fill="#111a27" stroke={g} strokeWidth="2.4"/>
        <circle cx="36" cy="42" r="4" fill="#111a27" stroke={g} strokeWidth="2.4"/>
      </>;break;
    case 'orders':
      shape=<>
        <rect x="9" y="5" width="31" height="40" rx="4" fill={m} stroke={edge} strokeWidth="1.5"/>
        <path d="M18 4h13v7H18z" fill={g}/>
        <path d="m15 21 3 3 4-5m-7 13 3 3 4-5" fill="none" stroke={g} strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M27 22h8m-8 12h8" stroke={edge} strokeWidth="2" strokeLinecap="round"/>
      </>;break;
  }
  return <svg className="traksos-service-icon" data-traksos-service={canonical}
    viewBox="0 0 48 48" width={size} height={size}
    fill="none" stroke="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#edf5fa"/><stop offset=".27" stopColor="#839baa"/>
        <stop offset=".56" stopColor="#314457"/><stop offset="1" stopColor="#111b29"/>
      </linearGradient>
      <linearGradient id={gold} x1="0" y1="0" x2=".9" y2="1">
        <stop stopColor="#fff1a0"/><stop offset=".32" stopColor="#ffd235"/>
        <stop offset=".7" stopColor="#ff9d18"/><stop offset="1" stopColor="#e96b0c"/>
      </linearGradient>
      <linearGradient id={glass} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#d9e8ef"/><stop offset=".65" stopColor="#61849c"/><stop offset="1" stopColor="#1b394f"/>
      </linearGradient>
    </defs>
    {shape}
  </svg>;
}
