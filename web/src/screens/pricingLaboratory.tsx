// Admin-only, read-only scenario builder. Never updates tariff settings, offers or ledger.
import { useState } from 'react';
import { useMe } from '../ui.tsx';
import { proposedEconomics, type PaymentRail } from '../proposedEconomics.ts';
import { rub } from '../api.ts';
const rails: {value:PaymentRail;label:string}[] = [
  {value:'cash',label:'Наличные у исполнителя'}, {value:'invoice',label:'Счёт / прямой перевод'},
  {value:'sbp',label:'СБП (пример 0,7%)'}, {value:'card',label:'Карта (пример 2,8%)'},
];
export function PricingLaboratory() {
  const { me } = useMe();
  const [amount,setAmount] = useState(10_000);
  const [rail,setRail] = useState<PaymentRail>('card');
  const [processingRate,setProcessingRate] = useState(2.8);
  const [support,setSupport] = useState(30);
  const [risk,setRisk] = useState(40);
  const [bonus,setBonus] = useState(0);
  const [referral,setReferral] = useState(true);
  if (!me?.roles.includes('admin')) return <main><h1>Нет доступа</h1><a href="#/">На главную</a></main>;
  const calc = proposedEconomics({
    base:Math.round(amount*100),partnerFeePct:5,customerFeePct:0,paymentRail:rail,
    acquiringPct:processingRate,supportCost:Math.round(support*100),riskReserve:Math.round(risk*100),
    referralPctOfPlatformRevenue:referral?10:0,bonuses:Math.round(bonus*100),
    taxPctOfPlatformRevenue:6,marketingCapPctOfPlatformRevenue:30,
  });
  const row=(name:string,value:number)=> <div className="between" key={name}><span>{name}</span><b>{rub(value)}</b></div>;
  return <main className="tr-training-page tr-finance-lab">
    <a href="#/admin" className="note">← Администратор</a>
    <section className="tr-training-hero"><span className="label">TRAKSOS · СЦЕНАРНЫЙ РАСЧЁТ</span><h1>Проверка прибыльности комиссии</h1>
      <p>Предлагаемая модель: клиенту 0% доплаты, исполнителю 5%. Это калькулятор решений, не утверждённый тариф и не финансовая операция.</p></section>
    <div className="banner" role="note"><strong>РЕАЛЬНЫЕ НАСТРОЙКИ НЕ ИЗМЕНЯЮТСЯ</strong>
      <span>В действующих настройках по умолчанию: клиент 5%, исполнитель 5%. База может содержать переопределения. Здесь тестируем альтернативу до согласования и миграции.</span></div>
    <section className="tr-training-workspace">
      <div className="grid2">
        <label className="stack">Цена работ, ₽
          <input className="field" type="number" min={100} max={10_000_000} step={100} value={amount}
            onChange={e=>setAmount(Math.max(0,Math.min(10_000_000,Number(e.target.value)||0)))}/></label>
        <label className="stack">Способ оплаты
          <select className="field" value={rail} onChange={e=>{const v=e.target.value as PaymentRail;setRail(v);setProcessingRate(v==='card'?2.8:v==='sbp'?0.7:0);}}>
            {rails.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
        <label className="stack">Эквайринг, % от полной оплаты (пример)
          <input className="field" type="number" min={0} max={30} step={0.1} value={processingRate}
            onChange={e=>setProcessingRate(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
        <label className="stack">Поддержка/SMS на заказ, ₽ (оценка)
          <input className="field" type="number" min={0} max={50000} value={support}
            onChange={e=>setSupport(Math.max(0,Number(e.target.value)||0))}/></label>
        <label className="stack">Резерв на споры и возвраты, ₽ (оценка)
          <input className="field" type="number" min={0} max={50000} value={risk}
            onChange={e=>setRisk(Math.max(0,Number(e.target.value)||0))}/></label>
        <label className="stack">Дополнительные бонусы по заказу, ₽
          <input className="field" type="number" min={0} max={50000} value={bonus}
            onChange={e=>setBonus(Math.max(0,Number(e.target.value)||0))}/></label>
      </div>
      <label className="row"><input type="checkbox" checked={referral} onChange={e=>setReferral(e.target.checked)} /> Рефералу 10% от комиссии TrakSOS</label>
      <div className="tr-training-instruction">
        <h2>Расчёт</h2>
        {row('Цена услуги',Math.round(amount*100))}
        {row('Доплата клиента',calc.clientFee)}
        {row('Всего платит клиент',calc.totalClient)}
        {row('Комиссия исполнителя',calc.partnerFee)}
        {row('Исполнитель получает',calc.partnerGets)}
        <hr/>
        {row('Выручка TrakSOS',calc.platformRevenue)}
        {row('Эквайринг',-calc.processing)}
        {row('УСН 6% с агентского вознаграждения (модель)',-calc.tax)}
        {row('Реферальные выплаты',-calc.referral)}
        {row('Другие бонусы',-Math.round(bonus*100))}
        {row('Поддержка и SMS',-Math.round(support*100))}
        {row('Резерв на споры',-Math.round(risk*100))}
        <hr/>
        <div className="between"><strong>Остаток до постоянных расходов</strong><strong>{rub(calc.contribution)}</strong></div>
        <p className="note">Порог маркетингового бюджета: {rub(calc.cap)} (30% выручки). Фактические выплаты по сценарию: {rub(calc.totalMarketing)}.</p>
        <p className={calc.isEconomicallySafe?'banner good':'banner warn'}>{calc.exceedsMarketingCap?'Бонусы и реферал превышают маркетинговый лимит. ':''}{calc.contribution <= 0?'Сценарий убыточен до постоянных расходов. ':''}
          {calc.isEconomicallySafe?'Маржинальный доход положителен, но фиксированные расходы не учтены.':'Такую комбинацию расходов нельзя считать безопасной для запуска.'}</p>
      </div>
    </section>
    <section className="tr-training-reference">
      <h2>Что это не учитывает</h2>
      <p>Аренду серверов, рекламу, разработку, зарплаты, комиссию выплат исполнителям, бухгалтерию, чековое решение и возможные другие налоги. Налог 6% здесь — только сценарное допущение для агентской модели, не юридическое заключение.</p>
      <p>Для карт и СБП ставки зависят от договора и схемы движения денег. Нельзя использовать примерные ставки для выставления клиентского счёта. Не подключено к production.</p>
    </section>
  </main>;
}
