// Unified real-data dispatch overview. Never infer GPS/arrival from missing events.
import { useEffect, useMemo, useState } from 'react';
import { get, fmtTime } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad, Loading } from '../ui.tsx';
import '../dispatchConsole.css';

type LiveOrder = {
  id: string; number: number; service: string; status: string; is_sos: boolean;
  created_at: string; client_name?: string; performer_name?: string;
  address?: string; zone?: string; case_root_id?: string;
  events?: { at: string; type: string }[];
};
type Risk = 'high' | 'watch' | 'normal';
const openStatuses = new Set(['awaiting_owner','searching','accepted','en_route','arrived','working','awaiting_confirmation']);
const ageMinutes = (time: string | undefined, now: number) => time ? Math.max(0, Math.floor((now - new Date(time).getTime()) / 60000)) : 0;
function assess(o: LiveOrder, now: number): {level: Risk; note: string} {
  const age = ageMinutes(o.created_at, now);
  const last = o.events?.length ? o.events[0]?.at : undefined;
  const silence = ageMinutes(last || o.created_at, now);
  if (o.status === 'searching' && age >= (o.is_sos ? 3 : 10)) {
    return { level: 'high', note: 'Долгий поиск исполнителя' };
  }
  if (o.status === 'awaiting_owner' && age >= 15) {
    return { level: 'watch', note: 'Ожидает решения владельца автопарка' };
  }
  if (o.status === 'accepted' && silence >= 10) {
    return { level: 'watch', note: 'После принятия нет новых событий' };
  }
  if (o.status === 'en_route' && silence >= 30) {
    return { level: 'watch', note: 'Нет новых событий в пути — проверить' };
  }
  if (o.status === 'awaiting_confirmation' && silence >= 20) {
    return { level: 'watch', note: 'Долго ждёт подтверждения' };
  }
  return { level: 'normal', note: 'По журналу без сигнала задержки' };
}
function Indicator({ label, number, note, variant }: { label: string; number: number; note: string; variant?: string }) {
  return <div className={'dispatch-kpi ' + (variant || '')}><span>{label}</span><strong>{number}</strong><small>{note}</small></div>;
}
export function DispatchConsole() {
  const live = useLoad(() => get<LiveOrder[]>('/api/admin/live'), [], e => e.type === 'order');
  const demand = useLoad(() => get<any>('/api/admin/demand?days=1&wait=10'), [], e => e.type === 'order');
  const [filter, setFilter] = useState<'all' | 'high' | 'watch' | 'sos'>('all');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()); setRefresh(n => n + 1); }, 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (refresh === 0) return;
    live.reload();
    demand.reload();
    // Auto-refresh uses existing authenticated API endpoints, not a fake socket.
  }, [refresh]);
  const rows = useMemo(() => (Array.isArray(live.data) ? live.data : [])
    .filter(o => openStatuses.has(o.status))
    .map(order => ({ order, risk: assess(order, now) }))
    .sort((a,b) => (a.risk.level === 'high' ? 0 : a.risk.level === 'watch' ? 1 : 2)
      - (b.risk.level === 'high' ? 0 : b.risk.level === 'watch' ? 1 : 2)
      || Number(b.order.is_sos) - Number(a.order.is_sos)
      || new Date(a.order.created_at).getTime() - new Date(b.order.created_at).getTime()
    ), [live.data, now]);
  const high = rows.filter(x => x.risk.level === 'high').length;
  const watch = rows.filter(x => x.risk.level === 'watch').length;
  const selected = rows.filter(x => (filter === 'all' || (filter === 'sos' ? x.order.is_sos : x.risk.level === filter))
    && (!search.trim() || [x.order.number, x.order.client_name, x.order.performer_name, x.order.address, x.order.service]
      .join(' ').toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'))));
  const incidents = (demand.data?.incidents ?? []).filter((x:any) => x.review_state !== 'resolved').slice(0,5);
  const updatedAt = new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  return <div className="dispatch-console">
    <section className="dispatch-top" aria-label="Текущее состояние диспетчерской">
      <div className="dispatch-heading"><div><span className="dispatch-eyebrow">ОПЕРАТИВНЫЙ МОНИТОРИНГ · СПБ И ЛО</span>
        <h3>Контроль активных вызовов</h3><p>Только реальные заявки сервера (до 100 в ленте). Приоритет — SOS, задержки и обращения без ответственного.</p></div>
        <div className="dispatch-refresh"><span>Время просмотра: {updatedAt} МСК</span>
          <button className="btn ghost small" type="button" onClick={() => { setNow(Date.now()); live.reload(); demand.reload(); }}>Обновить сейчас</button>
          <small>Автообновление каждые 30 секунд</small></div>
      </div>
      <div className="dispatch-kpis">
        <Indicator label="В оперативной ленте" number={rows.length} note="До 100 активных" />
        <Indicator label="Требуют внимания" number={high} note="Длительный поиск" variant={high ? 'critical' : ''}/>
        <Indicator label="Проверить вручную" number={watch} note="Нет новых этапов" variant={watch ? 'attention' : ''}/>
        <Indicator label="SOS в работе" number={rows.filter(x=>x.order.is_sos).length} note="Все открытые SOS"/>
      </div>
      <p className="dispatch-explain">Сигналы — подсказки диспетчеру, не подтверждённые нарушения. Отсутствие событий не означает отсутствие GPS или потерю связи. Для решения откройте саму заявку.</p>
    </section>
    <div className="dispatch-columns">
      <section className="dispatch-main" aria-label="Очередь активных заявок">
        <div className="dispatch-section-head"><div><h3>Лента заявок</h3><small>В первую очередь показываем требующие внимания</small></div><a href="#/admin/section/orders">Все заявки</a></div>
        <div className="dispatch-filters" aria-label="Фильтр заявок">
          {([['all','Все'],['high','Срочные'],['watch','Проверить'],['sos','SOS']] as const).map(([key,label]) =>
            <button key={key} type="button" className={'dispatch-filter'+(filter===key?' selected':'')}
              aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}
        </div>
        <input type="search" className="field dispatch-search" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Номер заявки, клиент, исполнитель, адрес" aria-label="Поиск активной заявки"/>
        {!live.data && <Loading error={live.error}/>}
        {live.data && !selected.length && <div className="dispatch-empty">По выбранному фильтру активных заявок нет.</div>}
        {selected.map(({order:o,risk})=><a className={'dispatch-order '+risk.level} href={'#/order/'+o.id} key={o.id}>
          <div className="dispatch-order-title"><strong>№{o.number} · {SERVICES[o.service]?.name ?? o.service}</strong>
            <div className="dispatch-order-labels">{o.is_sos && <span className="dispatch-sos">SOS</span>}
              <span className={'dispatch-severity '+risk.level}>{risk.level === 'high' ? 'Срочно' : risk.level === 'watch' ? 'Проверить' : 'В работе'}</span></div></div>
          <span className="dispatch-order-state">{STATUS[o.status]?.name ?? o.status} · с {fmtTime(o.created_at)} · {ageMinutes(o.created_at,now)} мин от создания</span>
          <span className="dispatch-order-people">{o.client_name ?? 'Клиент не указан'} → {o.performer_name ?? 'Исполнитель ещё не назначен'}</span>
          <span className="dispatch-order-location">{o.address || o.zone || 'Адрес не указан'}</span>
          {risk.level !== 'normal' && <span className="dispatch-order-risk">{risk.note}</span>}
          <span className="dispatch-open">Открыть карточку и историю →</span>
        </a>)}
      </section>
      <aside className="dispatch-side" aria-label="Быстрые инструменты диспетчера">
        <section className="dispatch-panel">
          <h3>Быстрые действия</h3><p>Переходы к реальным рабочим инструментам.</p>
          <a href="#/admin/section/demand">Разобрать зависшие заявки <span>→</span></a>
          <a href="#/admin/section/dispatch">Настроить распределение <span>→</span></a>
          <a href="#/admin/section/people">Исполнители и статусы <span>→</span></a>
          <a href="#/admin/section/support">Обращения в поддержку <span>→</span></a>
          <a href="#/admin/test-center">Песочница кабинетов <span>→</span></a>
        </section>
        <section className="dispatch-panel">
          <div className="dispatch-section-head"><h3>Неразобранные случаи</h3><a href="#/admin/section/demand">Раздел</a></div>
          <p>Исторические сигналы за 24 часа. Один случай может уже иметь закрытую заявку.</p>
          {!demand.data && <Loading error={demand.error}/>}
          {demand.data && incidents.length === 0 && <span className="dispatch-muted">Новых неразобранных случаев в отчёте нет.</span>}
          {incidents.map((o:any)=><a className="dispatch-incident" key={o.id} href={'#/order/'+o.id}>
            <strong>№{o.number} · {SERVICES[o.service]?.name ?? o.service}</strong><small>{STATUS[o.status]?.name ?? o.status}</small>
          </a>)}
        </section>
        <section className="dispatch-panel">
          <h3>Проверка качества</h3>
          <p>Задержки, отказы и жалобы разбираются по журналу событий. Санкции не назначаются автоматически по одному тревожному сигналу.</p>
          <a href="#/admin/section/stats">Открыть аналитику <span>→</span></a>
        </section>
      </aside>
    </div>
  </div>;
}
