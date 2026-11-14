// Настройки площадки по разделам: открыта только выбранная группа.
import { useState } from 'react';
import { get, put, rub } from '../api.ts';
import { useLoad, useAction, Loading, RubInput } from '../ui.tsx';
import { InsuranceAccessAdmin } from './insuranceAccessAdmin.tsx';

type Kind = 'rub' | 'pct' | 'num' | 'text' | 'bool' | 'share';
type Row = [section: string, key: string, label: string, kind: Kind, hint?: string];

const GROUPS: [string, Row[]][] = [
  ['Деньги', [
    ['fees', 'clientFeePct', 'Сервисный сбор с клиента', 'pct'],
    ['fees', 'performerCommissionPct', 'Комиссия с исполнителей', 'pct'],
    ['fees', 'serviceCommissionPct', 'Комиссия с рембаз', 'pct'],
    ['fees', 'serviceCommissionMax', 'Комиссия с рембазы — не больше за счёт', 'rub'],
    ['fees', 'serviceReferralDiscountPct', 'Скидка в сервисе по совету мастера', 'pct', 'из комиссии TrakSOS'],
    ['fees', 'cashDebtLimit', 'Лимит долга по наличным', 'rub', 'выше — заявки не приходят'],
    ['pricing', 'billingStepMinutes', 'Шаг оплаты работы, минут', 'num', '60 — начатый час целиком, 30 — по получасам'],
    ['pricing.consult', 'price', 'Консультация по телефону', 'rub'],
    ['pricing.consult', 'backDiscount', 'Скидка на выезд после консультации', 'rub'],
    ['pricing.consult', 'backHours', 'Скидка действует, часов', 'num'],
    ['payments', 'cash', 'Наличные мастеру', 'bool'],
    ['payments', 'online', 'Онлайн-оплата', 'bool', 'нужна ЮKassa'],
    ['payments', 'invoice', 'По счёту для компаний', 'bool'],
  ]],
  ['Баллы за приглашения', [
    ['referral', 'clientSharePct', 'Пригласил клиента: доля с его заявок', 'pct', 'баллами'],
    ['referral', 'days', 'Сколько дней идёт доля', 'num'],
    ['referral', 'welcome', 'Подарок приглашённому клиенту', 'rub', 'баллами'],
    ['referral', 'performerReward', 'Пригласил исполнителя', 'rub', 'баллами'],
    ['referral', 'performerJobs', '…после скольких его заявок', 'num'],
    ['referral', 'serviceReward', 'Пригласил рембазу', 'rub', 'баллами, после первого счёта'],
    ['referral', 'spendCapPct', 'Баллами — не больше от сбора/комиссии', 'pct', 'с одной заявки'],
    ['referral', 'ttlDays', 'Баллы живут, дней', 'num', 'начисленные в бесплатный месяц — от его конца'],
  ]],
  ['Правила', [
    ['cancel.scale', 'accepted', 'Отмена: исполнитель принял', 'share', 'доля выезда исполнителю'],
    ['cancel.scale', 'en_route_first_half', 'Отмена: в пути, первая половина', 'share'],
    ['cancel.scale', 'en_route_second_half', 'Отмена: почти на месте', 'share'],
    ['cancel.scale', 'arrived', 'Отмена: на месте', 'share'],
    ['dispatch', 'priorityFirst', 'Сначала звонить приоритетным', 'bool'],
    ['dispatch', 'ringSeconds', 'Сколько секунд звонит заявка', 'num'],
    ['dispatch', 'auctionMinutes', 'Торги, минут', 'num'],
    ['dispatch', 'missedToOffline', 'Пропущенных вызовов до «не на линии»', 'num'],
  ]],
  ['Реквизиты — в подвале каждой страницы', [
    ['legal', 'entity', 'Юрлицо или ИП', 'text', 'например, ИП Иванов Иван Иванович'],
    ['legal', 'inn', 'ИНН', 'text'],
    ['legal', 'ogrn', 'ОГРН / ОГРНИП', 'text'],
    ['legal', 'address', 'Адрес', 'text'],
    ['legal', 'phone', 'Телефон поддержки', 'text'],
    ['legal', 'email', 'E-mail поддержки', 'text'],
    ['legal', 'tagline', 'Строка о площадке', 'text'],
  ]],
];

const path = (all: any, section: string) => section.split('.').reduce((o, k) => o?.[k], all);
function show(v: any, kind: Kind) {
  if (v == null || v === '') return '—';
  if (kind === 'rub') return rub(v);
  if (kind === 'pct') return `${v}%`;
  if (kind === 'share') return `${Math.round(v * 100)}%`;
  if (kind === 'bool') return v ? 'Да' : 'Нет';
  const t = String(v);
  return t.length > 22 ? t.slice(0, 21) + '…' : t;
}

export function AdminSettings() {
  const s = useLoad(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [val, setVal] = useState<any>(null);
  if (!s.data) return <Loading error={s.error} />;
  async function save(section: string, key: string, kind: Kind) {
    const [top, sub] = section.split('.');
    let v = val;
    if (kind === 'pct' || kind === 'num') v = Number(String(val).replace(',', '.'));
    if (kind === 'share') v = Math.max(0, Math.min(100, Number(String(val).replace(',', '.')))) / 100;
    if ((kind === 'pct' || kind === 'num' || kind === 'share') && !Number.isFinite(v)) return;
    const body = sub ? { [sub]: { ...s.data[top][sub], [key]: v } } : { [key]: v };
    if (await run(() => put(`/api/admin/settings/${top}`, body), 'Сохранено — действует для новых заявок')) { setEdit(null); s.reload(); }
  }
  return (
    <div className="stack">
      <span className="note">Выберите раздел. Остальные настройки останутся скрытыми. Новые условия применяются к новым заявкам.</span>
      <button type="button" className="linkrow" aria-expanded={activeGroup === 'insurance'} onClick={() => { setActiveGroup(activeGroup === 'insurance' ? null : 'insurance'); setEdit(null); }}>
        <span><b>Страховые агенты</b><small>Доступы и подключение страховых партнёров</small></span><span aria-hidden="true">{activeGroup === 'insurance' ? '−' : '›'}</span>
      </button>
      {activeGroup === 'insurance' && <InsuranceAccessAdmin />}
      {GROUPS.map(([g, rows]) => (
        <div key={g} className="stack">
          <button type="button" className="linkrow" aria-expanded={activeGroup === g} onClick={() => { setActiveGroup(activeGroup === g ? null : g); setEdit(null); }}>
            <span><b>{g}</b><small>{rows.length} параметров</small></span><span aria-hidden="true">{activeGroup === g ? '−' : '›'}</span>
          </button>
          {activeGroup === g &&           <div className="rows">
            {rows.map(([section, key, label, kind, hint]) => {
              const id = section + '.' + key;
              const cur = path(s.data, section)?.[key];
              return (
                <div key={id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <button className="between" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, font: 'inherit', textAlign: 'left' }}
                    onClick={() => { if (kind === 'bool') { setVal(!cur); void put(`/api/admin/settings/${section.split('.')[0]}`, section.includes('.') ? { [section.split('.')[1]]: { ...path(s.data, section), [key]: !cur } } : { [key]: !cur }).then(() => s.reload()); return; } setEdit(edit === id ? null : id); setVal(kind === 'share' ? Math.round((cur ?? 0) * 100) : cur ?? ''); }}>
                    <span className="stack" style={{ gap: 0 }}><span>{label}</span>{hint && <small className="note">{hint}</small>}</span>
                    <b style={{ whiteSpace: 'nowrap' }}>{show(cur, kind)}</b>
                  </button>
                  {edit === id && (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      {kind === 'rub' ? <RubInput value={val} onChange={setVal} /> : <input className="field" value={val ?? ''} inputMode={kind === 'text' ? 'text' : 'decimal'} onChange={(e) => setVal(e.target.value)} placeholder={kind === 'share' || kind === 'pct' ? '%' : ''} />}
                      <button className="btn small" disabled={busy} onClick={() => save(section, key, kind)}>OK</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>}
        </div>
      ))}
    </div>
  );
}
