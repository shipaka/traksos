// «Пригласить»: личная ссылка и QR, баллы и за что они, кого пригласили. 1 балл = 1 ₽ скидки на сбор или комиссию ТракSOS.
import { get, fmtTime } from '../api.ts';
import { useLoad, useToast, Loading } from '../ui.tsx';
import { qrSvg } from '../qr.ts';

const pts = (k: number) => Math.round(k / 100).toLocaleString('ru-RU');
const KIND: Record<string, string> = {
  welcome: 'Подарок за вход по приглашению', ref_client: 'За приглашённого клиента', ref_performer: 'За приглашённого исполнителя',
  ref_service: 'За приглашённую рембазу', spend: 'Погашено баллами', expire: 'Сгорело', admin: 'От ТракSOS',
};
const WHO: Record<string, string> = { client: 'клиент', performer: 'исполнитель', service: 'рембаза' };

export function Invite() {
  const d = useLoad(() => get('/api/me/referral'), [], (e) => e.type === 'points' || e.type === 'order');
  const toast = useToast();
  if (!d.data) return <main><Loading error={d.error} /></main>;
  const r = d.data.rules;
  const link = `${location.origin}${location.pathname}#/r/${d.data.code}`;
  async function share() {
    const text = `ТракSOS — помощь грузовикам в СПб и ЛО: мастер или эвакуатор на место. По ссылке — ${pts(r.welcome)} баллов на первую заявку: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ТракSOS', text, url: link });
      else { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
    } catch { /* закрыли окно «Поделиться» */ }
  }
  return (
    <main>
      <div>
        <h1>Пригласить в ТракSOS</h1>
        <div className="sub">Баллы за приглашения уменьшают только сбор или комиссию ТракSOS, но не стоимость работы мастера. 1 балл = 1 ₽ скидки, в деньги не выводятся. Общий бюджет поощрений по заказу — до 30% комиссии площадки.</div>
      </div>

      <div className="card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="label">Ваши баллы</span>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 32 }}>{pts(d.data.balance)}</div>
        {d.data.expiringSoon > 0 && <span className="pill warn">{pts(d.data.expiringSoon)} сгорят в ближайший месяц</span>}
        <span className="note">Гасят до {r.spendCapPct}% сбора или комиссии с каждой заявки — сами, при подтверждении суммы. Живут {Math.round(r.ttlDays / 30)} месяцев.</span>
      </div>

      <div className="card">
        <b>Ваша ссылка</b>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <input className="field" readOnly value={link} onFocus={(e) => e.target.select()} style={{ fontSize: 13 }} />
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
          <div className="sum"><span>Пригласили клиента</span><b>{String(r.clientSharePct).replace('.', ',')}% от комиссии по его заявкам · {Math.round(r.days / 30)} мес.</b></div>
          <div className="sum"><span>Приглашённому клиенту</span><b>{pts(r.welcome)} на первую заявку</b></div>
          <div className="sum"><span>Пригласили мастера или эвакуаторщика</span><b>{pts(r.performerReward)} после {r.performerJobs} его заявок</b></div>
          <div className="sum"><span>Пригласили рембазу</span><b>{pts(r.serviceReward)} после её первого счёта</b></div>
          <span className="note">Приветственные баллы выдаются при регистрации, но расходуются только в пределах разрешённой скидки. Реферальные награды — за оплаченные действия. Ссылка работает для новых номеров. Себя пригласить нельзя.</span>
        </div>
      </details>

      <details className="card">
        <summary><b>Кого пригласили · {d.data.invited.length}</b></summary>
        <div className="stack" style={{ marginTop: 8, gap: 6 }}>
          {!d.data.invited.length ? <span className="note">Пока никого. Поделитесь ссылкой — с водителями на стоянке, в чате дальнобойщиков, с коллегами.</span>
            : d.data.invited.map((x: any, i: number) => (
              <div key={i} className="sum"><span>{x.name}<small className="note" style={{ display: 'block' }}>{WHO[x.who]} · с {fmtTime(x.at)}</small></span><b>+{pts(x.earned)}</b></div>
            ))}
        </div>
      </details>

      <span className="label">История</span>
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
      <span className="note">Баллы — скидка на услуги площадки по правилам <a href="#/offer/client">оферты</a>.</span>
    </main>
  );
}
