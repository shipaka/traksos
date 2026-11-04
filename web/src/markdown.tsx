// Небольшой разбор Markdown для текста оферты: заголовки, жирный, списки, абзацы. Без HTML — безопасно.
import type { ReactNode } from 'react';

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part));
}

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    out.push(<Tag key={out.length} style={{ margin: '0 0 10px', paddingLeft: 22 }}>{list.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(<h2 key={out.length} style={{ fontSize: h[1].length === 1 ? 19 : 16, margin: '6px 0 8px' }}>{inline(h[2])}</h2>); }
    else if (ol || ul) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ol ?? ul)![1]);
    } else if (!line.trim()) flush();
    else { flush(); out.push(<p key={out.length} style={{ margin: '0 0 10px' }}>{inline(line)}</p>); }
  }
  flush();
  return <div>{out}</div>;
}
