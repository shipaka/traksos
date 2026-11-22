/**
 * Five independent, text-free service illustrations for the approved 617.png PC homepage.
 * No bitmap atlases, embedded captions, CSS crop offsets, masks or content-specific text.
 * Illustration only: labels and destinations remain in accessible HTML.
 */
type FeatureArtKind = 'tech' | 'ecu' | 'parts' | 'insurance' | 'inspection';

export function OwnerFeatureArt({ kind }: { kind: FeatureArtKind }) {
  const ref = 'owner-feature-20261122-' + kind;
  const steel = `url(#${ref}-steel)`;
  const deep = `url(#${ref}-deep)`;
  const orange = `url(#${ref}-orange)`;
  const cyan = `url(#${ref}-cyan)`;

  return <svg viewBox="0 0 180 142" xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id={ref+'-steel'} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#e7f4f9"/><stop offset=".42" stopColor="#8daab9"/>
        <stop offset="1" stopColor="#344e60"/>
      </linearGradient>
      <linearGradient id={ref+'-deep'} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#294657"/><stop offset=".53" stopColor="#122934"/>
        <stop offset="1" stopColor="#06141e"/>
      </linearGradient>
      <linearGradient id={ref+'-orange'} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#ffc178"/><stop offset=".44" stopColor="#ff853c"/>
        <stop offset="1" stopColor="#ba4b1f"/>
      </linearGradient>
      <linearGradient id={ref+'-cyan'} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#b9ffff"/><stop offset=".5" stopColor="#42bacb"/>
        <stop offset="1" stopColor="#176273"/>
      </linearGradient>
      <radialGradient id={ref+'-glow'}>
        <stop stopColor="#49bcce" stopOpacity=".27"/>
        <stop offset="1" stopColor="#49bcce" stopOpacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="105" cy="112" rx="72" ry="28" fill={`url(#${ref}-glow)`}/>
    {kind === 'tech' && <>
      <path d="M48 26 113 11 147 32 141 115 74 132 40 111Z" fill="#07151e" opacity=".52"/>
      <path d="m49 27 68-13 30 17-70 16Z" fill={steel} stroke="#7c9cae" strokeWidth="1.3"/>
      <path d="m49 27 28 20-2 83-29-21Z" fill="#567c90" stroke="#aac7d2" strokeWidth="1.3"/>
      <path d="m77 47 70-16-5 81-67 18Z" fill={deep} stroke="#b2c5c9" strokeWidth="2"/>
      <path d="m85 57 50-11-3 49-49 13Z" fill="#0b2733" stroke="#3a9cae" strokeWidth="1.4"/>
      <path d="m95 78 12-10 10 4 8-10m-29 28 17-5 11-6" fill="none" stroke="#69c5d5" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="107" cy="68" r="3" fill="#ffa75d"/><circle cx="125" cy="62" r="3" fill="#92e6f1"/>
      <path d="m92 116 34-8" stroke="#94aeb5" strokeWidth="2" strokeLinecap="round"/>
      <path d="m49 32 26 19" stroke="#fba16b" strokeWidth="3"/>
      <path d="m56 24 8-2 0 19-8-4Z" fill={orange}/>
    </>}
    {kind === 'ecu' && <>
      <path d="M37 80 80 51l75 21-41 36Z" fill="#06131b" opacity=".4"/>
      <path d="m48 44 53-21 47 20-52 24Z" fill={steel} stroke="#effbff" strokeWidth="1.5"/>
      <path d="m48 44 48 23-2 56-47-25Z" fill="#54758a" stroke="#a3c3cb" strokeWidth="1.7"/>
      <path d="m96 67 52-24-1 57-53 23Z" fill={deep} stroke="#c3d9df" strokeWidth="1.7"/>
      <path d="m111 77 24-11-1 25-24 10Z" fill="#153645" stroke="#61b7c5" strokeWidth="1.5"/>
      <path d="m118 78 10-5m-10 11 10-5m-10 11 10-5" stroke="#7ce2e9" strokeWidth="1.4"/>
      <path d="m53 63 26 13m-26-2 26 13m-26-2 26 13" stroke="#b9d5df" strokeWidth="3.2" strokeLinecap="round"/>
      <path d="m57 103 0 14m10-9 0 15m10-11 0 13m10-7 0 13" stroke="#d0e2e7" strokeWidth="5" strokeLinecap="round"/>
      <circle cx="103" cy="54" r="3" fill="#fba467"/><circle cx="140" cy="47" r="2.6" fill="#d7eef0"/>
      <path d="M149 77q21-11 20-26" stroke="#f39b4d" strokeWidth="5" strokeLinecap="round" fill="none"/>
      <path d="M150 77q17-10 18-25" stroke="#ffc684" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
    </>}
    {kind === 'parts' && <>
      <g transform="translate(87 78) rotate(-13)">
        <path d="M-13-56H13L18-43 31-37 44-42 55-20 45-8 46 8 56 20 43 43 30 37 18 43 13 56H-13L-18 43-30 37-43 43-55 20-45 8-45-8-55-20-43-42-30-37-18-43Z" fill={steel} stroke="#d9e9ee" strokeWidth="2"/>
        <circle r="37" fill={deep} stroke="#7097a7" strokeWidth="2.4"/>
        <circle r="27" fill="#254958" stroke="#bdccd5" strokeWidth="2"/>
        <circle r="16" fill="#0c2530" stroke="#62adbb" strokeWidth="2"/>
        <circle r="7" fill={orange} stroke="#ffce89" strokeWidth="2"/>
        <g fill="#7fd2dd">
          <circle cx="0" cy="-24" r="3"/><circle cx="24" cy="0" r="3"/><circle cx="0" cy="24" r="3"/><circle cx="-24" cy="0" r="3"/>
        </g>
      </g>
      <path d="m128 86 20-12 17 10-2 26-20 12-16-12Z" fill={deep} stroke="#d6e8ec" strokeWidth="2"/>
      <path d="m129 85 17 10 18-11" fill="none" stroke="#79a5b8" strokeWidth="2"/>
      <path d="m146 96-1 25" stroke="#ff914d" strokeWidth="3"/>
    </>}
    {kind === 'insurance' && <>
      <path d="M92 8 149 29v43c0 29-22 49-57 63-35-14-57-34-57-63V29Z" fill="#071a26" stroke="#4c6a79" strokeWidth="2"/>
      <path d="M92 15 141 34v38c0 25-18 42-49 55-31-13-49-30-49-55V34Z" fill={deep} stroke="#abc8d4" strokeWidth="2.4"/>
      <path d="M92 20 135 37v33c0 23-15 36-43 49" fill="none" stroke="#fda560" strokeWidth="5" strokeLinecap="round"/>
      <path d="m56 43 36-13 36 13" fill="none" stroke="#456e7c" strokeWidth="1.5"/>
      <path d="M56 78h47v-20H66l-10 10Z" fill={steel} stroke="#d2edf2" strokeWidth="1.6"/>
      <path d="M103 64h18l10 14h-28Z" fill="#537b8f" stroke="#d2edf2" strokeWidth="1.6"/>
      <path d="m111 67 7 0 6 8h-13Z" fill="#62c5d4"/>
      <path d="M58 80h72v11H58Z" fill="#102734" stroke="#88b1bf" strokeWidth="1.5"/>
      <circle cx="75" cy="90" r="9" fill="#081923" stroke="#e6f3f6" strokeWidth="3"/><circle cx="116" cy="90" r="9" fill="#081923" stroke="#e6f3f6" strokeWidth="3"/>
      <path d="m82 56 9-7 9 7" stroke="#ff9c54" strokeWidth="2.2" fill="none"/>
    </>}
    {kind === 'inspection' && <>
      <path d="m60 15 67 9 7 100-78-7Z" fill="#06141d" opacity=".45"/>
      <path d="m53 17 74 8 2 101-79-9Z" fill={steel} stroke="#e3f0f3" strokeWidth="2"/>
      <path d="m60 31 60 7 1 78-65-7Z" fill={deep} stroke="#789da9" strokeWidth="1.3"/>
      <path d="m77 13 28 3 1 14-31-3Z" fill="#b2cad2" stroke="#e7f7f9" strokeWidth="2"/>
      <circle cx="91" cy="18" r="3" fill="#244c5d"/>
      <path d="m67 56 5 6 10-13m-15 31 5 6 10-13m-15 31 5 6 10-13" stroke="#87e1dd" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="m90 57 23 2m-24 22 24 3m-25 22 26 3" stroke="#8caeb9" strokeWidth="3.3" strokeLinecap="round"/>
      <circle cx="138" cy="84" r="23" fill="#102c39" stroke="#e3eaf0" strokeWidth="7"/>
      <circle cx="138" cy="84" r="17" fill="#173a48" stroke="#56b8c7" strokeWidth="1.5"/>
      <path d="m154 101 15 20" stroke={orange} strokeWidth="11" strokeLinecap="round"/>
      <path d="m134 91 6-8 6 3" fill="none" stroke="#ffb476" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </>}
  </svg>;
}
