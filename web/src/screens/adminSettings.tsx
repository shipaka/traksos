// Настройки площадки одним списком: нажмите строку — измените значение. Новые условия — для новых заявок.
import { useState } from 'react';
import { get, put, rub } from '../api.ts';
import { useLoad, useAction, Loading, RubInput } from '../ui.tsx';

type Kind = 'rub' | 'pct' | 'num' | 'text' | 'bool' | 'share';
type Row = [section: string, key: string, label: string, kind: Kind, hint?: string];

const GROUPS: [string, Row[]][] = [
  ['Деньги', [
    ['fees', 'clientFeePct', 'Сервисный сбор с клиента', 'pct'],
    ['fees', 'performerCommissionPct', 'Комиссия с исполнителей', 'pct'],
    ['fees', 'serviceCommissionPct', 'Комиссия с рембаз', 'pct'],
    ['fees', 'serviceReferralDiscountPct', 'Скидка в сервисе по совету мастера', 'pct', 'из комиссии ТракSOS'],
    ['fees', 'cashDebtLimit', 'Лимит долга по наличным', 'rub', 'выше — заявки не приходят'],
    ['pricing.consult', 'price', 'Консультация по телефону', 'rub'],
    ['pricing.consult', 'backDiscount', 'Скидка на выезд после консультации', 'rub'],
    ['pricing.consult', 'backHours', 'Скидка действует, часов', 'num'],
    ['payments', 'cash', 'Наличные мастеру', 'bool'],
    ['payments', 'online', 'Онлайн-оплата', 'bool', 'нужна ЮKassa'],
    ['payments', 'invoice', 'По счёту для компаний', 'bool'],
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
      <span className="note">Нажмите строку, чтобы изменить. Новые условия применяются к новым заявкам.</span>
      {GROUPS.map(([g, rows]) => (
        <div key={g} className="stack">
          <span className="label">{g}</span>
          <div className="rows">
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
          </div>
        </div>
      ))}
    </div>
  );
}
