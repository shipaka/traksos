// Live admin command center. It ONLY reads server data; elapsed-time flags are
// operational prompts, never proof of a worker's misconduct or road ETA.
import { useEffect, useState } from 'react';
import { get, fmtTime } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad, Loading } from '../ui.tsx';
import './dispatcherDesk.css';

type OrderEvent = { type: string; at: string };
type LiveOrder = {
  id: string; number: number; service: string; status: string; is_sos: boolean;
  created_at: string; accepted_at?: string | null; arrived_at?: string | null;
  case_root_id?: string | null; address?: string | null; zone?: string | null;
  client_name?: string | null; performer_name?: string | null; events: OrderEvent[];
};
type Incident = { id: string; number: number; service: string; status: string; is_sos: boolean;
  elapsed_minutes: number; address?: string | null; review_state?: string | null };
type Demand = { incidents: Incident[] };
type View = 'all' | 'alerts' | 'sos' | 'searching';

function ageMinutes(date: string | undefined | null, now: number) {
  if (!date) return 0;
  const value = new Date(date).getTime();
  return Number.isFinite(value) ? Math.max(0, Math.floor((now - value) / 60000)) : 0;
}
function ageLabel(minutes: number) {
  return minutes < 60 ? minutes + ' мин' : Math.floor(minutes / 60) + ' ч ' + minutes % 60 + ' мин';
}
// Thresholds indicate a need to review the order, not verified lateness.
function attention(o: LiveOrder, now: number): string | null {
  const total = ageMinutes(o.created_at, now);
  const last = ageMinutes(o.events[0]?.at ?? o.created_at, now);
  if (o.status === 'searching' && total >= (o.is_sos ? 3 : 10)) return 'Долго ищем исполнителя';
  if (o.status === 'awaiting_owner' && total >= 10) return 'Ожидается решение владельца';
  if (o.status === 'accepted' && ageMinutes(o.accepted_at ?? o.created_at, now) >= 10) return 'Нет отметки выезда';
  if (o.status === 'en_route' && last >= 40) return 'Давно нет событий в пути — проверьте ETA';
  if (o.status === 'arrived' && ageMinutes(o.arrived_at ?? o.created_at, now) >= 30) return 'Давно на месте — уточнить ход работ';
  if (o.status === 'working' && last >= 90) return 'Давно нет обновлений о работе';
  if (o.status === 'awaiting_confirmation' && last >= 25) return 'Ожидается подтверждение';
  return null;
}
const stage = (status: string) => STATUS[status]?.name ?? status;
const service = (id: string) => SERVICES[id]?.name ?? id;

export function DispatcherDesk() {
  const live = useLoad<LiveOrder[]>(() => get('/api/admin/live'), [], e => e.type === 'order');
  const demand = useLoad<Demand>(() => get('/api/admin/demand?days=7&waitMinutes=10'), [], e => e.type === 'order');
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const refresh = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    setNow(Date.now());
    setLastSync(Date.now());
    void live.reload();
    void demand.reload();
  };
  useEffect(() => {
    // A failed request remains visible as an error: never invent live counts.
    const t = window.setInterval(refresh, 30000);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', refresh);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', refresh); };
  }, [live.reload, demand.reload]);
  const rows = live.data ?? [];
  const alerts = rows.filter(o => Boolean(attention(o, now)));
  const sos = rows.filter(o => o.is_sos);
  const searching = rows.filter(o => o.status === 'searching' || o.status === 'awaiting_owner');
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const shown = rows
    .filter(o => (view === 'all' || (view === 'alerts' && !!attention(o, now))
      || (view === 'sos' && o.is_sos)
      || (view === 'searching' && (o.status === 'searching' || o.status === 'awaiting_owner')))
      && (!needle || [String(o.number), o.client_name, o.performer_name, o.address, o.zone, o.service]
        .some(value => String(value ?? '').toLocaleLowerCase('ru-RU').includes(needle))))
    .sort((a,b) => Number(Boolean(attention(b,now))) - Number(Boolean(attention(a,now)))
      || Number(b.is_sos) - Number(a.is_sos) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const unresolved = (demand.data?.incidents ?? []).filter(x =>
    x.status === 'no_performer' && x.review_state !== 'resolved');
  return <div className="dispatcher-desk">
    <div className="dispatcher-title">
      <div><span className="label">Оперативное управление · СПб и Ленинградская область</span>
        <h2>Диспетчерская</h2>
        <p className="note">Всё важное на одном экране: ожидание, SOS, исполнители и проблемные обращения. Все действия выполняются в существующей карточке заявки с историей.</p></div>
      <button className="btn ghost" type="button" onClick={refresh}>Обновить данные</button>
    </div>
    {(!live.data || !demand.data) && (live.error || demand.error) && <p className="banner warn" role="alert">
      Данные получены не полностью: {live.error ?? demand.error}. Текущие цифры могут быть неполными.
    </p>}
    <div className="dispatcher-metrics" aria-label="Состояние заявок">
      {([
        ['all','Открытые',rows.length],
        ['alerts','Проверить',alerts.length],
        ['sos','SOS',sos.length],
        ['searching','Ищут исполнителя',searching.length],
      ] as [View,string,number][]).map(([key,label,count]) =>
        <button type="button" key={key} className={'dispatcher-metric' + (key === view ? ' selected' : '')}
          aria-pressed={view === key} onClick={() => setView(key)}>
          <small>{label}</small><strong>{live.data ? count : '—'}</strong>
        </button>)}
    </div>
    <div className="dispatcher-tools">
      <label className="dispatcher-search">
        <span className="sr-only">Найти заявку по номеру, имени или месту</span>
        <input className="field" type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Номер заявки, клиент, исполнитель, место"/>
      </label>
      <span className="note">Последняя синхронизация: {lastSync ? fmtTime(new Date(lastSync).toISOString()) : 'при открытии'} · обновление каждые 30 сек.</span>
    </div>
    {!live.data ? <Loading error={live.error} /> : shown.length === 0 ?
      <div className="empty">{rows.length ? 'По выбранному фильтру заявок нет.' : 'Сейчас активных заявок нет.'}</div> :
      <div className="dispatcher-table-scroll">
        <table className="dispatcher-table">
          <thead><tr><th>Приоритет</th><th>Заявка / обращение</th><th>Клиент → исполнитель</th><th>Состояние</th><th>В работе</th><th>Действия</th></tr></thead>
          <tbody>{shown.map(o => {
            const risk = attention(o, now);
            return <tr key={o.id} className={risk ? 'needs-attention' : ''}>
              <td>{risk ? <span className="dispatcher-warning">Проверить</span>
                : o.is_sos ? <span className="pill">SOS</span> : <span className="note">Обычно</span>}</td>
              <td><strong>№{o.number}</strong>{o.case_root_id && <small>Мультизаявка</small>}
                <small>{service(o.service)}{o.is_sos ? ' · SOS' : ''}</small>
                <small>{o.address ?? o.zone ?? 'Адрес уточняется'}</small></td>
              <td><strong>{o.client_name ?? 'Клиент'}</strong><small>{o.performer_name ?? 'Исполнитель не назначен'}</small></td>
              <td><span className="pill">{stage(o.status)}</span>
                {risk && <small className="dispatcher-warning-detail">{risk}</small>}
                {o.events[0] && <small>Событие: {fmtTime(o.events[0].at)}</small>}</td>
              <td><strong>{ageLabel(ageMinutes(o.created_at, now))}</strong><small>с создания</small></td>
              <td><a className="btn small" href={'#/order/' + o.id}>Открыть</a></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    <div className="dispatcher-bottom">
      <section className="card stack">
        <div className="between"><b>Ненайденные исполнители · за 7 дней</b>
          <a className="btn ghost small" href="#/admin/section/demand">Разобрать все</a></div>
        <p className="note">Сюда попадают заявки «Никто не взял», которые ещё не отмечены решёнными. Это история за период, а не число активных вызовов.</p>
        {!demand.data ? <Loading error={demand.error}/> : unresolved.length === 0 ?
          <span className="note">Необработанных обращений нет.</span> :
          unresolved.slice(0,5).map(o => <a key={o.id} href={'#/order/' + o.id} className="list-item">
            <b>№{o.number} · {service(o.service)}</b>
            <span className="note">{o.address ?? 'Адрес уточняется'} · Открыть ›</span>
          </a>)}
      </section>
      <section className="card stack">
        <b>Быстрые действия диспетчера</b>
        <a className="btn ghost" href="#/admin/section/search">Найти клиента или заявку</a>
        <a className="btn ghost" href="#/admin/section/dispatch">Распределение вызовов</a>
        <a className="btn ghost" href="#/admin/section/support">Обращения клиентов</a>
        <a className="btn ghost" href="#/admin/section/diagnostics">Журнал технических ошибок</a>
        <p className="note">Принудительное закрытие и отмена доступны из карточки заявки. Причина обязательна, действие сохраняется в журнале.</p>
      </section>
    </div>
    <section className="card stack" aria-label="Будущие средства связи диспетчерской">
      <div className="between"><b>Голосовой Эфир</b><span className="pill">В разработке</span></div>
      <p className="note">Голосовые комнаты водителей будут развиваться отдельно от экстренных заявок. Сейчас диспетчер работает с заявками и текстовыми обращениями; микрофон и вызовы здесь не активируются.</p>
    </section>
    <p className="note">Временные пороги здесь — подсказки для диспетчера. Они не подтверждают опоздание и не создают штрафов. Связь и реальный дорожный маршрут проверяются отдельно.</p>
  </div>;
}
