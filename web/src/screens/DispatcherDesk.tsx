// Live admin command center. It ONLY reads server data; elapsed-time flags are
// operational prompts, never proof of a worker's misconduct or road ETA.
import { useEffect, useState } from 'react';
import { get, fmtTime } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad, useMe, Loading } from '../ui.tsx';
import './dispatcherDesk.css';

import { attention, ageMinutes, type LiveOrder } from './dispatcherAttention20261124.ts';
function ageLabel(minutes: number) {
  return minutes < 60 ? minutes + ' мин' : Math.floor(minutes / 60) + ' ч ' + minutes % 60 + ' мин';
}
type Incident = { id: string; number: number; service: string; status: string; is_sos: boolean;
  elapsed_minutes: number; address?: string | null; review_state?: string | null };
type Demand = { incidents: Incident[] };
type View = 'all' | 'alerts' | 'sos' | 'searching';

const stage = (status: string) => STATUS[status]?.name ?? status;
const service = (id: string) => SERVICES[id]?.name ?? id;

export function DispatcherDesk() {
  const { me } = useMe();
  const live = useLoad<LiveOrder[]>(() => get('/api/admin/live'), [me?.id], e => e.type === 'order');
  const demand = useLoad<Demand>(() => get('/api/admin/demand?days=7&waitMinutes=10'), [me?.id], e => e.type === 'order');
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  // Last *attempt*, not a fake successful sync if one of two requests fails.
  const [lastAttempt, setLastAttempt] = useState<number | null>(null);
  const refresh = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    setNow(Date.now());
    setLastAttempt(Date.now());
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
  // useLoad intentionally retains its last payload after a transport failure.
  // Do not publish that old snapshot as "live" counts or actionable dispatch.
  const liveCurrent = !!live.data && !live.error;
  const demandCurrent = !!demand.data && !demand.error;
  const rows = liveCurrent ? live.data! : [];
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
  const unresolved = (demandCurrent ? demand.data!.incidents : []).filter(x =>
    x.status === 'no_performer' && x.review_state !== 'resolved');
  return <div className="dispatcher-desk">
    <div className="dispatcher-title">
      <div><span className="label">Оперативное управление · СПб и Ленинградская область</span>
        <h2>Диспетчерская</h2>
        <p className="note">Всё важное на одном экране: ожидание, SOS, исполнители и проблемные обращения. Все действия выполняются в существующей карточке заявки с историей.</p></div>
      <button className="btn ghost" type="button" onClick={refresh}>Обновить данные</button>
    </div>
    {(live.error || demand.error) && <div className="banner warn stack" role="alert">
      <span>Не удалось подтвердить свежие данные: {live.error ?? demand.error}. Затронутые показатели скрыты до успешной загрузки.</span>
      <button type="button" className="btn ghost small" onClick={refresh}>Повторить запросы к серверу</button>
    </div>}
    <div className="dispatcher-metrics" aria-label="Состояние заявок">
      {([
        ['all','Показано открытых',rows.length],
        ['alerts','Проверить',alerts.length],
        ['sos','SOS',sos.length],
        ['searching','Ищут исполнителя',searching.length],
      ] as [View,string,number][]).map(([key,label,count]) =>
        <button type="button" key={key} className={'dispatcher-metric' + (key === view ? ' selected' : '')}
          aria-pressed={view === key} onClick={() => setView(key)}>
          <small>{label}</small><strong>{liveCurrent ? count : '—'}</strong>
        </button>)}
    </div>
    <div className="dispatcher-tools">
      <label className="dispatcher-search">
        <span className="sr-only">Найти заявку по номеру, имени или месту</span>
        <input className="field" type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Номер заявки, клиент, исполнитель, место"/>
      </label>
      <span className="note">Последняя попытка обновления: {lastAttempt ? fmtTime(new Date(lastAttempt).toISOString()) : 'при открытии'} · повтор каждые 30 сек.</span>
    </div>
    {!liveCurrent ? <Loading error={live.error} /> : shown.length === 0 ?
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
        {!demandCurrent ? <Loading error={demand.error}/> : unresolved.length === 0 ?
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
