// «Пригласить»: личная ссылка и QR, баллы и за что они, кого пригласили. 1 балл = 1 ₽ скидки на сбор или комиссию TrakSOS.
import { useLayoutEffect, useRef, useState } from 'react';
import { get, getToken, fmtTime } from '../api.ts';
import { useToast, Loading, useMe } from '../ui.tsx';
import { usePrivateRead } from './privateRead20261124.ts';
import { qrSvg } from '../qr.ts';

const pts = (k: number) => Math.round(k / 100).toLocaleString('ru-RU');
const KIND: Record<string, string> = {
  welcome: 'Подарок за вход по приглашению', ref_client: 'За приглашённого клиента', ref_performer: 'За приглашённого исполнителя',
  ref_service: 'За приглашённую рембазу', spend: 'Погашено баллами', expire: 'Сгорело', admin: 'От TrakSOS',
};
const WHO: Record<string, string> = { client: 'клиент', driver: 'водитель автопарка', performer: 'исполнитель', service: 'рембаза', master_service: 'мастер и СТО', insurer: 'страховой партнёр', inspection: 'оператор техосмотра', courier: 'курьер', admin: 'администратор', moderator: 'модератор', other: 'другая роль' };

export function Invite() {
  const {me,mode}=useMe();
  const token=getToken();
  if(!me||!token)return null;
  const scope=JSON.stringify([me.id,token]);
  return <InviteAccount key={scope} scope={scope} mode={mode} token={token} />;
}

function InviteAccount({scope,mode,token}:{scope:string;mode:string;token:string}) {
  const [invitedPage,setInvitedPage]=useState(0);
  const [invitedOpen,setInvitedOpen]=useState(false);
  const d = usePrivateRead<any>(() => get('/api/me/referral'+(invitedPage?'?invitedPage='+invitedPage:'')), JSON.stringify([scope,invitedPage]), (e) => e.type === 'points' || e.type === 'order');
  const active=useRef(true);
  useLayoutEffect(()=>{active.current=true;return ()=>{active.current=false;};},[]);
  const current=()=>active.current && getToken()===token;
  const toast = useToast();
  const linkInput = useRef<HTMLInputElement>(null);
  if (d.error) return <main><div className="card stack" role="alert"><span>Не удалось загрузить актуальные баллы и приглашения.</span><button type="button" className="btn small" onClick={()=>void d.reload()}>Повторить загрузку</button>{invitedPage>0&&<button type="button" className="btn ghost small" onClick={()=>setInvitedPage(n=>Math.max(0,n-1))}>К предыдущей странице</button>}</div></main>;
  if (!d.data) return <main><Loading /></main>;
  const r = d.data.rules;
  const total = Number.isSafeInteger(d.data.invitedTotal) && d.data.invitedTotal >= 0 ? d.data.invitedTotal : null;
  const pageSize = d.data.invitedPageSize === 100 ? 100 : null;
  const canNext = total !== null && pageSize !== null && (invitedPage+1)*pageSize < total;
  const link = `${location.origin}${location.pathname}#/r/${d.data.code}`;
  async function share() {
    if(!current())return;
    // The Web Share API adds "url" itself. Do not repeat it inside "text".
    const text = `TrakSOS — помощь грузовикам в СПб и ЛО: мастер или эвакуатор на место. По ссылке — ${pts(r.welcome)} баллов на первую заявку.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'TrakSOS', text, url: link });
        return;
      } catch (error) {
        // Closing the native share sheet is not a failure that needs a toast.
        if (error instanceof Error && error.name === 'AbortError') return;
        // Other failures may be recovered by copying the visible referral URL.
      }
    }
    if(!current())return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        if(current())toast('Ссылка скопирована');
        return;
      }
    } catch { /* Clipboard may be unavailable on HTTP or denied by the browser. */ }
    // Never leave «Поделиться» as a dead button in restricted WebViews.
    if(!current())return;
    linkInput.current?.focus();
    linkInput.current?.select();
    toast('Не удалось скопировать автоматически. Ссылка выделена — скопируйте вручную.');
  }
  return (
    <main>
      <div>
        <h1>Пригласить в TrakSOS</h1>
        <div className="sub">Баллы за приглашения гасят сбор и комиссию TrakSOS. 1 балл = 1 ₽ скидки, в деньги не выводятся.</div>
      </div>

      <div className="card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="label">Ваши баллы</span>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 32 }}>{pts(d.data.balance)}</div>
        {d.data.expiringSoon > 0 && <span className="pill warn">{pts(d.data.expiringSoon)} сгорят в ближайший месяц</span>}
        <span className="note">{mode==='client'
          ? `В клиентском заказе баллами можно покрыть не более ${r.clientSpendCapPct}% стоимости услуги и не больше самого сервисного сбора; фактическое списание ограничено остатком баллов.`
          : mode==='performer'||mode==='service'
            ? `Для исполнителя и СТО баллами можно покрыть не более ${r.spendCapPct}% фактически начисленной комиссии TrakSOS по одной заявке или счёту, если хватает баллов. Для выездной заявки с сохранённой акцией 0% списание баллов исполнителя равно нулю.`
            : 'Баллы и их применение зависят от вашей роли и действующего договора. Откройте финансовые условия кабинета.'}
          {' '}Срок действия — {r.ttlDays} дней, с учётом правила бесплатного периода.</span>
      </div>

      <div className="card">
        <b>Ваша ссылка</b>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <input ref={linkInput} className="field" readOnly aria-label="Ваша реферальная ссылка" value={link} onFocus={(e) => e.target.select()} style={{ fontSize: 13 }} />
          <button type="button" className="btn small" onClick={share}>Поделиться</button>
        </div>
        <details>
          <summary className="note" style={{ cursor: 'pointer' }}>Показать QR-код — дать отсканировать на месте</summary>
          <div style={{ width: 220, margin: '10px auto 0', borderRadius: 12, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
        </details>
      </div>

      <details className="card">
        <summary><b>За что баллы</b></summary>
        <div className="stack" style={{ marginTop: 8, gap: 6 }}>
          <div className="sum"><span>Пригласили клиента</span><b>{String(r.clientSharePct).replace('.', ',')}% от фактического клиентского сервисного сбора после применения баллов · {r.days} дней</b></div>
          <div className="sum"><span>Приглашённому клиенту</span><b>{pts(r.welcome)} на первую заявку</b></div>
          <div className="sum"><span>Пригласили мастера или эвакуаторщика</span><b>{pts(r.performerReward)} после {r.performerJobs} его заявок</b></div>
          <div className="sum"><span>Пригласили рембазу</span><b>{pts(r.serviceReward)} после её первого счёта</b></div>
          <span className="note">Приветственные баллы новому клиенту начисляются при регистрации по действительной реферальной ссылке. Награды пригласившему за заказы — после предусмотренного расчёта по оплаченным заказам, мастерам и СТО — по условиям соответствующей программы. Ссылка только для новых аккаунтов, самого себя приглашать нельзя.</span>
        </div>
      </details>

      <details className="card" open={invitedOpen} onToggle={e=>setInvitedOpen(e.currentTarget.open)}>
        <summary><b>Кого пригласили · {total===null?'показано '+d.data.invited.length:total}</b></summary>
        <div className="stack" style={{ marginTop: 8, gap: 6 }}>
          {!d.data.invited.length ? <span className="note">{invitedPage?'На этой странице нет записей. Вернитесь к предыдущей странице.':'Пока никого. Поделитесь ссылкой — с водителями на стоянке, в чате дальнобойщиков, с коллегами.'}</span>
            : d.data.invited.map((x: any, i: number) => (
              <div key={i} className="sum"><span>{x.name}<small className="note" style={{ display: 'block' }}>{WHO[x.who]??WHO.other} · с {fmtTime(x.at)}</small></span><b>+{pts(x.earned)}</b></div>
            ))}
          {pageSize!==null&&total!==null&&<div className="stack">
            <span className="note">Страница {invitedPage+1} · показано {d.data.invited.length} из {total}. Список обновляется при загрузке.</span>
            <div className="row" role="group" aria-label="Страницы приглашённых">
              <button type="button" className="btn ghost small" disabled={invitedPage===0} onClick={()=>setInvitedPage(n=>Math.max(0,n-1))}>Предыдущая</button>
              <button type="button" className="btn ghost small" disabled={!canNext} onClick={()=>setInvitedPage(n=>n+1)}>Следующая</button>
            </div>
          </div>}
        </div>
      </details>

      <span className="label">История · последние 50 операций</span>
      {!d.data.entries.length ? <div className="empty">Начислений пока нет</div> : (
        <div className="stack">
          {d.data.entries.map((e: any) => (
            <div key={e.id} className="card" style={{ gap: 4 }}>
              <div className="between"><b>{KIND[e.kind] ?? e.kind}</b><b style={{ color: e.amount > 0 ? 'var(--good-fg)' : 'var(--fg)' }}>{e.amount > 0 ? '+' : '−'}{pts(Math.abs(e.amount))}</b></div>
              <span className="note">{e.note} · {fmtTime(e.created_at)}{e.amount > 0 && e.expires_at ? ` · до ${new Date(e.expires_at).toLocaleDateString('ru-RU')}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      <span className="note">Баллы — скидка на услуги площадки; ставки и примеры смотрите в разделе <a href="#/economics">«Комиссии, баллы и рефералы»</a>. Правовые условия — в оферте или договоре, относящемся к вашему кабинету.</span>
    </main>
  );
}
