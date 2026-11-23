import { useEffect, useRef, useState } from 'react';
import { get } from '../api.ts';
import { useMe } from '../ui.tsx';
import { diagnosticsQuery, diagnosticCsvCell, type DiagnosticFilters }
  from './adminDiagnosticsFilters20261124.ts';

type Entry = { request_id: string; occurred_at: string; category: string; method: string; path: string; status: number; code: string };
type Result = { ownerId: string; filterKey: string; rows: Entry[]; fetchedAt: string };

export function AdminDiagnostics() {
  const { me } = useMe();
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [requestId, setRequestId] = useState('');
  const [result, setResult] = useState<Result|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const filters: DiagnosticFilters = {category,status,since,until,requestId};
  const filterKey = JSON.stringify(filters);
  const loaded = !!result && result.filterKey === filterKey && result.ownerId === me?.id;
  const rows = loaded && result ? result.rows : [];

  useEffect(() => {
    // Admin journal entries must never linger on a different authenticated
    // account or accept a response from an old in-flight admin session.
    generation.current++;
    setResult(null);
    setLoading(false);
    setError('');
    return () => { generation.current++; };
  }, [me?.id]);

  const load = async () => {
    const ticket = ++generation.current;
    const ownerId = me?.id;
    setError('');
    let query: string;
    try {
      query = diagnosticsQuery(filters);
    } catch (reason) {
      setResult(null);
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Проверьте фильтры');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const payload = await get<{rows:Entry[]}>('/api/admin/diagnostics?' + query);
      if (ticket !== generation.current || ownerId !== me?.id) return;
      if (!Array.isArray(payload.rows)) throw new Error('Сервер вернул некорректный формат журнала');
      setResult({ownerId:ownerId??'',filterKey,rows:payload.rows,fetchedAt:new Date().toISOString()});
    } catch (reason) {
      if (ticket === generation.current && ownerId === me?.id)
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить журнал');
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  };
  const download = () => {
    if (!loaded || loading || !rows.length) return;
    const columns: (keyof Entry)[] = ['occurred_at','category','status','code','method','path','request_id'];
    const csv = [columns.join(','), ...rows.map(row =>
      columns.map(key => diagnosticCsvCell(row[key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url; link.download='traksos-diagnostics.csv';
    document.body.appendChild(link);
    link.click(); link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
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
    <div className="row">
      <button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading?'Загружаем…':'Показать ошибки'}</button>
      <button type="button" className="btn ghost" disabled={!loaded || loading || !rows.length} onClick={download}>Скачать CSV</button>
    </div>
    {error && <div className="banner warn" role="alert">{error}</div>}
    {!loaded && !loading && !error && <p className="note">Выберите фильтры и нажмите «Показать ошибки».</p>}
    {!loaded && !loading && !!result && result.filterKey !== filterKey &&
      <p className="note">Фильтры изменены. Обновите выдачу перед просмотром и выгрузкой.</p>}
    {loaded && <p className="note" role="status">
      Записей: {rows.length}. Показаны максимум 1000 последних подходящих записей.
      Сверено с сервером: {new Date(result!.fetchedAt).toLocaleString('ru-RU')}.
    </p>}
    {loaded && !rows.length && <p className="empty">Для выбранных фильтров событий нет.</p>}
    {rows.map((row,i) => <div className="card" key={row.request_id+'-'+row.occurred_at+'-'+i}>
      <b>{row.status} · {row.code}</b>
      <span className="note">{new Date(row.occurred_at).toLocaleString('ru-RU')} · {row.category} · {row.method} {row.path}</span>
      <small>Код обращения: {row.request_id}</small>
    </div>)}
  </section>;
}
