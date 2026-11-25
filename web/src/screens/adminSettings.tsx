// Настройки площадки по разделам: открыта только выбранная группа.
import { useEffect, useRef, useState } from 'react';
import { put, rub } from '../api.ts';
import { useAction, useMe, RubInput } from '../ui.tsx';
import {useAdminScopedResource} from '../adminScopedResource20261124.ts';
import {parseAdminSetting} from '../adminSettingsValidation20261124.ts';
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
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const scope=(me?.id??'signed-out')+':platform-settings';
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const s=useAdminScopedResource<any>('/api/admin/settings',scope,admin);
  const {busy,run}=useAction();
  const [edit,setEdit]=useState<string|null>(null);
  const [activeGroup,setActiveGroup]=useState<string|null>(null);
  const [val,setVal]=useState<any>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    setEdit(null);setActiveGroup(null);setVal(null);setError('');
  },[scope]);
  async function save(section:string,key:string,kind:Kind,input:any=val) {
    if(!admin||busy||!s.data)return;
    const startedAs=scope;
    const result=parseAdminSetting(kind,input);
    if(!result.ok){setError(result.error);return;}
    const [top,sub]=section.split('.');
    if(sub&&(!s.data[top]||!s.data[top][sub]||
      typeof s.data[top][sub]!=='object')){
      setError('Нет подтверждённого вложенного раздела настройки. Обновите параметры и попробуйте снова.');
      return;
    }
    // Nested sub-objects (consult, cancel scale) are merged with a fresh copy
    // of the displayed snapshot, so no unrelated fields are overwritten by
    // an accidental undefined key in the editor.
    const body=sub ? {[sub]:{...s.data[top]?.[sub],[key]:result.value}} :
      {[key]:result.value};
    if(['fees','payments','referral','cancel'].includes(top)&&
      !window.confirm('Изменить действующий параметр площадки «'+key+'»? Изменение влияет на будущие действия.'))
      return;
    setError('');
    const updated=await run(()=>put(`/api/admin/settings/${top}`,body),
      'Сохранено — действует для новых заявок');
    if(scopeRef.current!==startedAs)return;
    if(updated){setEdit(null);setVal(null);s.reload();}
    else setError('Настройка не подтверждена сервером. Обновите параметры и проверьте значение перед повтором.');
  }
  if(!admin)return <div className="card stack">
    <h3>Настройки площадки</h3><p role="alert">Изменять параметры может только администратор.</p>
  </div>;
  if(!s.data)return <div className="card stack" role={s.error?'alert':'status'}>
    <h3>Настройки площадки</h3>
    <p>{s.error?'Не удалось загрузить параметры: '+s.error:'Загружаем актуальные настройки…'}</p>
    <button type="button" className="btn ghost small" onClick={s.reload}>Повторить загрузку настроек</button>
  </div>;
  return (
    <div className="stack">
      <span className="note">Выберите раздел. Остальные настройки останутся скрытыми. Новые условия применяются к новым заявкам.</span>
      {error&&<div className="banner warn" role="alert">{error}</div>}
      <button type="button" className="btn ghost small" disabled={busy}
        onClick={()=>{setEdit(null);setVal(null);setError('');s.reload();}}>Сверить параметры с сервером</button>
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
                    onClick={() => {
                       if(busy)return;
                       setError('');
                       if(kind==='bool'){
                         if(typeof cur!=='boolean'){setError('Переключатель недоступен: нет подтверждённого значения от сервера.');return;}
                         void save(section,key,kind,!cur);
                         return;
                       }
                       setEdit(edit===id?null:id);
                       setVal(kind==='share'?(typeof cur==='number'?String(Number((cur*100).toFixed(2))): ''):cur??'');
                     }}>
                    <span className="stack" style={{ gap: 0 }}><span>{label}</span>{hint && <small className="note">{hint}</small>}</span>
                    <b style={{ whiteSpace: 'nowrap' }}>{show(cur, kind)}</b>
                  </button>
                  {edit === id && (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      {kind === 'rub' ? <RubInput value={val} onChange={setVal} /> : <input className="field" value={val ?? ''} inputMode={kind === 'text' ? 'text' : 'decimal'} onChange={(e) => setVal(e.target.value)} placeholder={kind === 'share' || kind === 'pct' ? '%' : ''} />}
                      <button className="btn small" disabled={busy} onClick={() => void save(section,key,kind)}>Сохранить</button>
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
