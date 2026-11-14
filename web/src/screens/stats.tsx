// Статистика площадки: цели первых трёх месяцев из плана запуска — плитками, заявки по дням — графиком.

import { useState } from 'react';
import { get, rub } from '../api.ts';
import { SERVICES } from '../dict.ts';
import { useLoad, Loading } from '../ui.tsx';

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const STAGE: Record<string, string> = {
  searching: 'В поиске', accepted: 'После принятия', en_route_first_half: 'В пути, первая половина', en_route_second_half: 'В пути, вторая половина',
  arrived: 'На месте', performer_fault: 'По вине исполнителя',
};

export function Stats() {
  const [days, setDays] = useState(30);
  const s = useLoad(() => get(`/api/admin/stats?days=${days}`), [days]);
  if (!s.data) return <Loading error={s.error} />;
  const d = s.data;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="scroll-x">{[7, 30, 90].map((n) => <button key={n} className="chip" aria-pressed={days === n} onClick={() => setDays(n)}>{n} дней</button>)}</div>

      <div className="tiles">
        <Tile label="Обращений" value={String(d.incidents?.total ?? d.totals.created)} hint="Каждое обращение считается один раз" />
        <Tile label="Многоэтапных" value={String(d.incidents?.multistage ?? 0)} hint={`Доля ${pct(d.incidents?.multistageShare ?? 0)} · помощь в несколько этапов`} />
        <Tile label="Этапов услуг" value={String(d.incidents?.stages ?? d.totals.created)} hint={`SOS-этапов ${d.totals.sos} · ночных ${d.totals.night}`} />
        <Tile label="Дошли до конца" value={pct(d.rates.completion)} hint={`${d.totals.completed} из закрытых`} />
        <Tile label="Никто не взял" value={pct(d.rates.noPerformer)} hint={`${d.totals.no_performer} заявок`} warn={(d.rates.noPerformer ?? 0) > 0.2} />
        <Tile label="Ответ за 5 минут" value={pct(d.rates.accepted5min)} hint={d.speed.acceptMedianMin != null ? `медиана ${d.speed.acceptMedianMin} мин` : 'нет данных'} />
        <Tile label="Вернулись повторно" value={pct(d.rates.repeat)} hint="цель: 15% → 35%" />
        <Tile label="Доход площадки" value={rub(d.money.platform_income)} hint={d.money.refunds ? `возвраты ${rub(d.money.refunds)}` : 'возвратов нет'} />
      </div>

      <div className="card">
        <b>Заявок в день</b>
        <DayBars rows={d.byDay} />
      </div>

      <div className="card">
        <b>Люди</b>
        <div className="sum"><span>Исполнителей проверено</span><span>{d.people.performers_approved}</span></div>
        <div className="sum"><span>Сейчас на линии</span><span>{d.people.performers_online}</span></div>
        <div className="sum"><span>Ждут проверки</span><span>{d.people.verification_queue}</span></div>
        <div className="sum"><span>Компаний с ИНН</span><span>{d.people.companies}</span></div>
        <div className="sum"><span>Новых пользователей</span><span>{d.people.new_users}</span></div>
        <div className="sum"><span>Открытых обращений</span><span>{d.people.support_open}</span></div>
      </div>

      <Table title="По этапам услуг · каждый мастер, эвакуатор и СТО отдельно" head={['Услуга', 'Этапов', 'Готово', 'Средний чек']}
        rows={d.byService.map((r: any) => [SERVICES[r.service]?.name ?? r.service, r.created, r.completed, r.avg_check ? rub(r.avg_check) : '—'])} />
      <Table title="Где не хватает исполнителей" head={['Зона', 'Заявок', 'Никто не взял']}
        rows={d.zones.map((r: any) => [r.zone_id, r.created, r.no_performer])} />
      <Table title="Спрос по маркам" head={['Машина', 'Заявок', 'Никто не взял', 'Средний год']}
        rows={(d.brands ?? []).map((r: any) => [`${r.brand}${r.model ? ' ' + r.model : ''}`, r.created, r.no_performer, r.avg_year ?? '—'])} />
      <Table title="Отмены по этапам" head={['Этап', 'Отмен']} rows={d.cancels.map((r: any) => [STAGE[r.stage] ?? r.stage, r.n])} />
      <Table title="Лучшие исполнители" head={['Кто', 'Выездов', 'Оборот']}
        rows={d.top.map((r: any) => [<a href={`#/admin/user/${r.id}`}>{r.name ?? '—'}{r.rating ? ` ★${r.rating.toFixed(1)}` : ''}</a>, r.completed, rub(r.turnover)])} />
    </div>
  );
}

function Tile({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="card tile">
      <span className="label">{label}</span>
      <b className="tile-value" style={warn ? { color: 'var(--warn)' } : undefined}>{value}</b>
      <span className="note">{hint}</span>
    </div>
  );
}

/** Столбики по дням: высота — все заявки; подсказка — сколько готово и сколько «никто не взял» */
function DayBars({ rows }: { rows: { day: string; created: number; completed: number; no_performer: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  if (!rows.length) return <div className="empty">За период заявок не было</div>;
  const max = Math.max(...rows.map((r) => r.created), 1);
  const H = 140, gap = 2, W = 100 / rows.length;
  const h = hover != null ? rows[hover] : null;
  const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="note" style={{ minHeight: 18 }}>{h ? `${fmt(h.day)}: ${h.created} заявок · готово ${h.completed} · никто не взял ${h.no_performer}` : `Максимум ${max} в день · наведите на столбик`}</div>
      {!asTable ? (
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label="Заявок в день" onMouseLeave={() => setHover(null)}>
          {[0.5, 1].map((k) => <line key={k} x1="0" x2="100" y1={H - (H - 4) * k} y2={H - (H - 4) * k} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {rows.map((r, i) => {
            const bh = Math.max(2, ((H - 4) * r.created) / max);
            return (
              <g key={r.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} style={{ cursor: 'pointer' }}>
                <rect x={i * W} y={0} width={W} height={H} fill="transparent" />
                <rect x={i * W + gap / 4} y={H - bh} width={Math.max(0.5, W - gap / 2)} height={bh} rx="0.6"
                  fill="var(--accent)" opacity={hover == null || hover === i ? 1 : 0.45} />
              </g>
            );
          })}
        </svg>
      ) : (
        <Table title="" head={['День', 'Заявок', 'Готово', 'Никто не взял']} rows={rows.map((r) => [fmt(r.day), r.created, r.completed, r.no_performer])} />
      )}
      <div className="between note"><span>{fmt(rows[0].day)}</span><button className="chip" style={{ minHeight: 30 }} onClick={() => setAsTable(!asTable)}>{asTable ? 'Графиком' : 'Таблицей'}</button><span>{fmt(rows[rows.length - 1].day)}</span></div>
    </div>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: any[][] }) {
  if (!rows.length) return title ? <div className="card"><b>{title}</b><span className="note">Нет данных за период</span></div> : null;
  return (
    <div className={title ? 'card' : ''}>
      {title && <b>{title}</b>}
      <table className="tbl">
        <thead><tr>{head.map((h, i) => <th key={h} style={{ textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: j ? 'right' : 'left' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
