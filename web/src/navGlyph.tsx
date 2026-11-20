/** Consistent vector icons for the same mobile navigation on web and Android WebView. */
export function NavGlyph({ glyph }: { glyph: string }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {glyph === 'wrench' ? <><path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3.7 17.3a2 2 0 0 0 2.9 2.9l5.8-5.8a4 4 0 0 0 5.2-5.2l-2.9 2.9-2.8-2.8z"/><path d="M4 4l4 4M3 5l2-2M17 17l4 4M16 20l4-4"/></>
    : glyph === 'tow' ? <><path d="M2 17h19M5 17V9l5-4h5M10 5v8M10 9l4 3M14 12h4l3 3"/><circle cx="6" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M15 5h4v4"/></>
    : glyph === 'garage' ? <><path d="M3 21V8l9-5 9 5v13H3zM7 21v-9h10v9M7 15h10"/><path d="M8.5 19h7"/></>
    : glyph === 'headset' ? <><path d="M4 15v-4a8 8 0 0 1 16 0v4M4 15v3a2 2 0 0 0 2 2h2v-8H6a2 2 0 0 0-2 2zM20 15v3a2 2 0 0 1-2 2h-2v-8h2a2 2 0 0 1 2 2z"/></>
    : glyph === 'pin' ? <><path d="M12 22s8-7 8-13A8 8 0 0 0 4 9c0 6 8 13 8 13z"/><circle cx="12" cy="9" r="2.6"/></>
    : glyph === 'phone' ? <path d="M22 16.7v3a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19.2 19.2 0 0 1-5.9-5.9 19.5 19.5 0 0 1-3-8.5A2 2 0 0 1 4.5 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7L7.6 10a15.4 15.4 0 0 0 6.4 6.4l1.7-1.8a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.6 2.1z"/>
    : glyph === 'clock' ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.6 2"/></>
    : glyph === 'star' ? <path d="m12 2.5 3 6.1 6.7 1-4.9 4.8 1.2 6.7-6-3.2-6 3.2 1.2-6.7-4.9-4.8 6.7-1z"/>
    : glyph === 'wallet' ? <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 8V6a2 2 0 0 1 2-2h13M15 12h6v5h-6a2.5 2.5 0 0 1 0-5z"/></>
    : glyph === 'coins' ? <><ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 2 3 3 6 3s6-1 6-3V7M3 12v5c0 2 3 3 6 3s6-1 6-3v-5"/><path d="M17 8c2.2.2 4 1.2 4 3s-2 3-5 3M16 19c3 0 5-1.5 5-3v-5"/></>
    : glyph === 'navigation' ? <path d="m3 11 18-8-8 18-2.5-7.5z"/>
    : glyph === 'alert' ? <><path d="M10 3a2.3 2.3 0 0 1 4 0l8 14a2.3 2.3 0 0 1-2 3H4a2.3 2.3 0 0 1-2-3z"/><path d="M12 9v4m0 3h.01"/></>
    : glyph === 'camera' ? <><path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="3"/></>
    : glyph === 'filetext' ? <><path d="M6 2h9l5 5v15H6zM15 2v6h5M9 12h8M9 16h8M9 20h6"/></>
    : glyph === 'check' ? <path d="M4 12l5 5L20 6"/>
    : glyph === 'menu' ? <path d="M4 6h16M4 12h16M4 18h16" />
    : glyph === 'chat' ? <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M8 10h8M8 14h6" /></>
    : glyph === 'truck' ? <><path d="M2 7h12v10H2zM14 10h4l4 4v3h-8z" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>
    : glyph === 'clipboard' ? <><rect x="5" y="4" width="14" height="18" rx="2" /><rect x="9" y="2" width="6" height="5" rx="1" /><path d="M9 11h6M9 15h6M9 19h4" /></>
    : glyph === '⌂' ? <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 20v-7h6v7" /></>
    : glyph === '☷' || glyph === '☰' ? <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h1M3 12h1M3 18h1" /></>
    : glyph === '✚' || glyph === '＋' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>
    : glyph === '⚙' ? <><circle cx="12" cy="12" r="3.1" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>
    : glyph === '◌' ? <><circle cx="12" cy="12" r="2.4"/><path d="M6.4 6.4a8 8 0 0 0 0 11.2m11.2-11.2a8 8 0 0 1 0 11.2M3.5 3.5a12 12 0 0 0 0 17m17-17a12 12 0 0 1 0 17"/></>
    : glyph === '◉' ? <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.8-3.6 3.4-5.4 7.5-5.4s6.7 1.8 7.5 5.4" /><circle cx="12" cy="12" r="10" opacity=".4" /></>
    : glyph === '▣' ? <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6M9 12h6m-6 4h4" /></>
    : glyph === '▦' ? <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></>
    : glyph === '▤' ? <><path d="M4 21V6l8-4 8 4v15M2 21h20" /><path d="M8 9h2m4 0h2M8 13h2m4 0h2M10 21v-4h4v4" /></>
    : glyph === '⚑' ? <><path d="M5 22V3m0 1c5-3 9 3 15 0v11c-6 3-10-3-15 0" /></>
    : glyph === 'bell' ? <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></>
    : glyph === '⚡' ? <path d="M13 2 4 13h7l-1 9 10-12h-7z" />
    : glyph === '🛍' ? <><path d="M4 8h16l-1.5 13h-13z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>
    : glyph === '?' ? <><circle cx="12" cy="12" r="10" /><path d="M9 9a3 3 0 0 1 6 1c0 2-3 2-3 4m0 3h.01" /></>
    : glyph === '◇' ? <><path d="m12 2 8 4v6c0 5-3.7 8-8 10-4.3-2-8-5-8-10V6z" /><path d="m8 12 2.5 2.5L16 9" /></>
    : glyph === '₽' ? <><path d="M7 21V3h6a5 5 0 0 1 0 10H7M4 17h12" /></>
    : <circle cx="12" cy="12" r="4" />}
  </svg>;
}

