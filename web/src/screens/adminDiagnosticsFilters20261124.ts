// Pure, reproducible filter/CSV helpers. Admin journal never silently drops
// an invalid filter and returns a much broader set of sensitive audit rows.
export type DiagnosticFilters = {
  category: string; status: string; since: string; until: string; requestId: string;
};
const categories = new Set(['', 'http_server_error', 'auth_login_rejected']);
const canonicalId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function diagnosticsQuery(filters: DiagnosticFilters): string {
  const {category,status,since,until,requestId} = filters;
  if (!categories.has(category)) throw new Error('Неизвестная категория диагностики');
  if (status && (!/^\d{3}$/.test(status) || Number(status) < 400 || Number(status) > 599))
    throw new Error('HTTP-код должен быть от 400 до 599');
  const start = since ? new Date(since) : null;
  const end = until ? new Date(until) : null;
  if ((start && !Number.isFinite(start.getTime())) ||
      (end && !Number.isFinite(end.getTime())))
    throw new Error('Неверная дата или время в фильтре');
  if (start && end && start.getTime() > end.getTime())
    throw new Error('Дата начала не может быть позже даты окончания');
  const id = requestId.trim();
  if (id && !canonicalId.test(id))
    throw new Error('Код обращения должен быть полным UUID');
  const q = new URLSearchParams({limit:'1000'});
  if (category) q.set('category',category);
  if (status) q.set('status',status);
  if (start) q.set('since',start.toISOString());
  if (end) q.set('until',end.toISOString());
  if (id) q.set('requestId',id);
  return q.toString();
}

// Explicitly protect spreadsheet readers from formula injection; quote line
// breaks and double quotes rather than allowing arbitrary extra CSV rows.
export function diagnosticCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g,'""') + '"';
}
