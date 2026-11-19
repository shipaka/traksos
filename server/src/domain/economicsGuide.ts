/**
 * Single current-economics description for Help, training, and legal annexes.
 * Monetary amounts are kopecks. Examples are illustrative and NEVER transact.
 * Do not expose the performer commission to a client or the client's platform
 * surcharge to a performer; return only the chosen actor's economics.
 */
import type { Settings } from './defaults.ts';
import { cappedPct, PER_SIDE_FEE_CAP, commissionPct, pct, split } from './money.ts';
export type FinanceRole = 'owner'|'driver'|'master'|'tow'|'service'|'insurer'|'inspection'|'moderator'|'admin';
export interface FeeExample {
  amount:number; fee:number; total:number; partnerReceives?:number;
  title:string; formula:string;
}
export interface FinanceGuide {
  role:FinanceRole; title:string; cap:number; paragraphs: {title:string;text:string}[];
  examples:FeeExample[];
  rules:{clientSharePct:number;referralDays:number;welcome:number;clientSpendCapPct:number;spendCapPct:number;performerReward:number;performerJobs:number;serviceReward:number;ttlDays:number};
}
const show=(k:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(k/100);
const examples=[1_000_000,20_000_000]; // 10 000 and 200 000 rubles
export const FINANCE_EDITION='traksos-economics-v1';
export function financeGuide(s:Settings,role:FinanceRole):FinanceGuide {
  const f=s.fees, r=s.referral;
  const base={role,title:'Как считаются деньги',cap:PER_SIDE_FEE_CAP,
    rules:{clientSharePct:r.clientSharePct,referralDays:r.days,welcome:r.welcome,
      clientSpendCapPct:r.clientSpendCapPct,spendCapPct:r.spendCapPct,
      performerReward:r.performerReward,performerJobs:r.performerJobs,
      serviceReward:r.serviceReward,ttlDays:r.ttlDays}};
  if(role==='owner'||role==='driver'){
    const items=examples.map(amount=>{
      const fee=cappedPct(amount,f.clientFeePct);
      return {amount,fee,total:amount+fee,
        title:'Пример заказа на '+show(amount),
        formula:show(amount)+' за услугу + '+show(fee)+' сервисный сбор ('+f.clientFeePct+'%, не более '+show(PER_SIDE_FEE_CAP)+') = '+show(amount+fee)};
    });
    return {...base,title:role==='driver'?'Водителю · стоимость заказа':'Владельцу · расходы автопарка',examples:items,
      paragraphs:[
        {title:'Что вы оплачиваете',text:'Сервисный сбор TrakSOS — '+f.clientFeePct+'% сверх согласованной стоимости услуги, максимум '+show(PER_SIDE_FEE_CAP)+' с одной заявки. Цена и сбор показываются до подтверждения. Комиссии исполнителя здесь не раскрываются.'},
        {title:'Баллы и скидки',text:'1 балл уменьшает оплату на 1 ₽ и не выводится деньгами. В заказе можно погасить не более '+r.clientSpendCapPct+'% стоимости заказа и не более начисленного клиентского сервисного сбора; размер доступного остатка и точная скидка показываются перед подтверждением.'},
        {title:'Приглашения',text:'Если пригласивший привёл клиента, ему начисляется '+r.clientSharePct+'% от фактически полученного клиентского сервисного сбора TrakSOS (после применённых баллов) по подтверждённым заказам этого клиента в течение '+r.days+' дней. Это НЕ '+r.clientSharePct+'% стоимости ремонта. При регистрации по приглашению предусмотрено '+show(r.welcome)+' приветственных баллов; действуют сроки и ограничения бонусной программы.'},
        {title:'Отмена и возврат',text:'Результат зависит от стадии заявки и оснований отмены. Расчёт показывается по конкретному заказу, спор о сумме решается по материалам заявки. Обещание полного возврата без проверки недопустимо.'},
        {title:'Для водителей компании',text:'Если заказ превышает лимит владельца автопарка, для платного оформления может понадобиться его подтверждение. SOS доступен в предусмотренном интерфейсе.'},
      ]};
  }
  if(role==='master'||role==='tow'){
    const rate=commissionPct(f,{isPriority:false});
    return {...base,title:role==='tow'?'Эвакуаторщику · комиссионные и выплаты':'Мастеру · комиссионные и выплаты',
      examples:examples.map(amount=>{
        const fee=cappedPct(amount,rate);
        return {amount,fee,total:amount,partnerReceives:amount-fee,title:'Пример работы на '+show(amount),
          formula:show(amount)+' стоимость работы − '+show(fee)+' комиссия TrakSOS ('+rate+'%, не более '+show(PER_SIDE_FEE_CAP)+') = '+show(amount-fee)+' исполнителю'};
      }),paragraphs:[
        {title:'Комиссия с исполнителя',text:'Обычная комиссия TrakSOS — '+rate+'% согласованной стоимости заказа, максимум '+show(PER_SIDE_FEE_CAP)+' за заказ. Комиссия удерживается внутри цены исполнителя, не прибавляется к вашему вознаграждению. Приоритетные, промо- и персональные условия могут менять процент: конкретная заявка фиксирует свою ставку.'},
        {title:'Баллы и вознаграждения',text:'Баллами можно покрыть не более '+r.spendCapPct+'% подлежащей уплате комиссии по одной заявке, при наличии баллов. Приглашение нового исполнителя даёт '+show(r.performerReward)+' баллов после '+r.performerJobs+' завершённых заявок приглашённого участника при выполнении правил.'},
        {title:'Клиенты по реферальным ссылкам',text:'За приглашённого клиента — '+r.clientSharePct+'% от фактического сервисного сбора TrakSOS с его подтверждённых заказов на протяжении '+r.days+' дней. Вознаграждение начисляется баллами, не деньгами.'},
        {title:'Наличные и выплаты',text:'При расчёте наличными задолженность по агентской комиссии учитывается на счёте исполнителя. Банковские выплаты, долги, возвраты и погашение баллами проверяются в «Профиль → Финансы». Суммы клиентского сервисного сбора в этом кабинете не раскрываются.'},
      ]};
  }
  if(role==='service'){
    return {...base,title:'СТО · комиссии и счета',examples:examples.map(amount=>{
      const fee=cappedPct(amount,f.serviceCommissionPct,Math.min(PER_SIDE_FEE_CAP,f.serviceCommissionMax));
      return {amount,fee,total:amount,partnerReceives:amount-fee,title:'Пример счёта за работы '+show(amount),
        formula:show(amount)+' согласованные работы − '+show(fee)+' комиссия TrakSOS ('+f.serviceCommissionPct+'%, максимум '+show(Math.min(PER_SIDE_FEE_CAP,f.serviceCommissionMax))+') = '+show(amount-fee)+' СТО'};
    }),paragraphs:[
      {title:'Комиссия СТО',text:'Комиссия TrakSOS с согласованных работ по привлечённым клиентам — '+f.serviceCommissionPct+'%, максимум '+show(Math.min(PER_SIDE_FEE_CAP,f.serviceCommissionMax))+' за счёт. Точные исключения, состав счёта и доставка деталей зависят от подтверждённого заказа и действующего договора.'},
      {title:'Баллы и приглашения',text:'Баллами можно уменьшить не более '+r.spendCapPct+'% подлежащей уплате комиссии. За приглашённую СТО предусмотрено '+show(r.serviceReward)+' баллов после её первого закрытого счёта, если соблюдены условия программы.'},
      {title:'Рекомендация СТО мастером',text:'В предусмотренном сценарии направления в партнёрскую СТО клиент может получить скидку '+f.serviceReferralDiscountPct+'% по счёту; она финансируется из комиссии TrakSOS и не должна автоматически уменьшать согласованную выручку СТО.'},
      {title:'Выплаты',text:'Сверяйте услуги, согласованные цены, счета и начисления в «Финансы» вашего кабинета. Спор по счёту рассматривается по документам и истории заявки.'},
    ]};
  }
  if(role==='insurer'||role==='inspection'){
    return {...base,title:role==='insurer'?'Страховому партнёру · финансовые условия':'Оператору ТО · финансовые условия',
      examples:[],paragraphs:[
        {title:'Как формируется доход',text:'Универсальная комиссия по всем заявкам этого кабинета не установлена. Вознаграждение и порядок расчётов определяются отдельным согласованным договором, видом услуги и подтверждёнными документами. Примерные проценты из чужих кабинетов неприменимы.'},
        {title:'Стоимость для клиента',text:'До выбора услуги показываются согласованные предложения и фактические условия. Страховые премии и вознаграждение страховщика нельзя считать доходом площадки автоматически; самостоятельные документы и платежи вне согласованного процесса не создаются.'},
        {title:'Где увидеть начисления',text:'В рабочем кабинете и доступных финансовых разделах — фактические операции по своим обращениям. Для разногласий используйте личную поддержку.'},
      ]};
  }
  return {...base,title:role==='admin'?'Администратору · контроль экономики':'Модератору · контроль финансовых споров',
    examples:[],paragraphs:[
      {title:'Полномочия сотрудника',text:'Само участие в модерации или администрировании не образует комиссионных начислений как у мастера или клиента. Финансовые права сотрудников определяются отдельно.'},
      {title:'Проверка суммы',text:'Проверяйте цену, сервисный сбор, вознаграждение исполнителя, баллы, возвраты и историю фактических операций без предположений. Сотрудник не меняет платёжные документы простым учебным действием.'},
      {title:'Изменение условий',text:'Любая смена действующих тарифов, бонусов и реферальных правил требует синхронного обновления справки, учебных сценариев и НОВОЙ версии применимой оферты. Уже принятые редакции не редактируются задним числом.'},
    ]};
}
export function contractEconomyAnnex(s:Settings,audience:'client'|'performer'):string {
  const roles:FinanceRole[]=audience==='client'?['owner','driver']:['master','tow','service'];
  const parts=roles.map(role=>{
    const g=financeGuide(s,role);
    return '### '+g.title+'\n\n'+g.paragraphs.map(p=>'**'+p.title+'.** '+p.text).join('\n\n')+
      '\n\n'+g.examples.map(e=>'- '+e.formula).join('\n');
  });
  return '\n\n## Финансовые условия TrakSOS · зафиксированное приложение\n\n'+
    'Суммы примеров не являются офертой конкретного исполнителя. Индивидуальная цена и согласование каждой заявки фиксируются отдельно. '+
    'Этот раздел формируется из настроек на момент публикации и сохраняется вместе с номером редакции. Последующие изменения требуют новой опубликованной редакции.\n\n'+
    parts.join('\n\n');
}
