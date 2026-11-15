import { useState } from 'react';
import { get } from '../api.ts';
import { useAction } from '../ui.tsx';

type Entry = { request_id: string; occurred_at: string; category: string; method: string; path: string; status: number; code: string };
const csvCell = (value: unknown) => '"' + String(value ?? '').replace(/^[=+@-]/, "'").replace(/"/g, '""') + '"';

export function AdminDiagnostics() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [requestId, setRequestId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { busy, run } = useAction();
  const load = async () => {
    const q = new URLSearchParams({ limit: '1000' });
    if (category) q.set('category', category);
    if (status) q.set('status', status);
    if (since) q.set('since', new Date(since).toISOString());
    if (until) q.set('until', new Date(until).toISOString());
    if (requestId) q.set('requestId', requestId.trim());
    const data = await run(() => get('/api/admin/diagnostics?' + q.toString()), null);
    if (data) { setRows(data.rows); setLoaded(true); }
  };
  const download = () => {
    const columns: (keyof Entry)[] = ['occurred_at','category','status','code','method','path','request_id'];
    const csv = [columns.join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'traksos-diagnostics.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="stack">
    <p className="note">Ошибки входа и сервера. Без паролей, SMS-кодов и номеров телефонов. Хранение — 30 дней, затем автоматическая очистка при обращении к журналу или записи нового события.</p>
    <div className="grid2">
      <label>Категория<select className="field" value={category} onChange={e => setCategory(e.target.value)}><option value="">Все</option><option value="http_server_error">Ошибка сервера</option><option value="auth_login_rejected">Отказ во входе</option></select></label>
      <label>HTTP-код<input className="field" type="number" min="400" max="599" value={status} onChange={e => setStatus(e.target.value)} /></label>
      <label>С<input className="field" type="datetime-local" value={since} onChange={e => setSince(e.target.value)} /></label>
      <label>По<input className="field" type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} /></label>
    </div>
    <label>Код обращения<input className="field" value={requestId} onChange={e => setRequestId(e.target.value)} placeholder="UUID из сообщения об ошибке" /></label>
    <div className="row"><button className="btn" disabled={busy} onClick={load}>Показать ошибки</button><button className="btn ghost" disabled={!loaded || !rows.length} onClick={download}>Скачать CSV</button></div>
    {loaded && <p className="note">Записей: {rows.length}. Показаны максимум 1000 последних подходящих записей.</p>}
    {rows.map(row => <div className="card" key={row.request_id}>
      <b>{row.status} · {row.code}</b>
      <span className="note">{new Date(row.occurred_at).toLocaleString('ru-RU')} · {row.category} · {row.method} {row.path}</span>
      <small>Код обращения: {row.request_id}</small>
    </div>)}
  </section>;
}
