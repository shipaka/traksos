import { useEffect, useState } from 'react';
import { get, ApiError } from '../api.ts';
import { Markdown } from '../markdown.tsx';

export type GuestInfoKind = 'company' | 'offers' | 'help' | 'guide' | 'pricing' | 'rules' | `offer:${string}`;
type LegalDocument = { version: string; effective_at: string; body: string };

const DOCUMENTS = [
  { id: 'client', name: 'Оферта для клиентов', hint: 'Условия обращения за услугами' },
  { id: 'performer', name: 'Договор с исполнителями и СТО', hint: 'Условия работы партнёров' },
  { id: 'insurer', name: 'Страховой партнёр', hint: 'Условия страхового направления' },
  { id: 'inspection', name: 'Партнёр по техосмотру', hint: 'Правила взаимодействия' },
  { id: 'privacy', name: 'Персональные данные', hint: 'Обработка и защита информации' }
];

function LegalDocument({ audience }: { audience: string }) {
  const [doc, setDoc] = useState<LegalDocument | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false); setDoc(undefined);
    void get<LegalDocument>(`/api/offers/current/${encodeURIComponent(audience)}`)
      .then(value => { if (active) setDoc(value); })
      .catch(e => {
        if (!active) return;
        if (e instanceof ApiError && e.status === 404) setDoc(null);
        else setError(true);
      });
    return () => { active = false; };
  }, [audience, retry]);
  return <div className="tr-guest-legal">
    {error ? <div role="alert" className="tr-guest-info-card">
      Не получилось загрузить документ. Это не означает, что он не опубликован.
      <button type="button" className="tr-guest-info-link" onClick={() => setRetry(n => n + 1)}>Попробовать снова</button>
    </div> : doc === undefined ? <p role="status">Загружаем действующий документ…</p>
    : doc === null ? <p role="status">Для этого раздела действующая редакция пока не опубликована. Черновые условия не показываем.</p>
    : <><p className="tr-guest-info-note">Редакция {doc.version} · действует с {new Date(doc.effective_at).toLocaleDateString('ru-RU')}</p>
      <div className="tr-guest-legal-body"><Markdown text={doc.body ?? ''}/></div></>}
  </div>;
}

/** Public information appears on the same approved landing, never in an unrelated
 * white/blue guest cabinet. Legal text always comes from the active API. */
export function GuestUnifiedInfo({ kind, onBack }: { kind: GuestInfoKind; onBack?: () => void }) {
  const legal = kind.startsWith('offer:') ? kind.slice('offer:'.length) : null;
  const heading = legal ? (DOCUMENTS.find(d => d.id === legal)?.name ?? 'Документ TrakSOS')
    : ({ company: 'О платформе TrakSOS', offers: 'Оферты и документы',
         help: 'Поддержка TrakSOS', guide: 'Как работает TrakSOS',
         pricing: 'Комиссии TrakSOS', rules: 'Правила площадки' } as Record<string, string>)[kind];
  return <div className="tr-guest-info" aria-label={heading}>
    {onBack && <button type="button" className="tr-guest-info-back" onClick={onBack}>← Вернуться к регистрации</button>}
    <span className="tr-guest-info-kicker">TRAKSOS · ИНФОРМАЦИЯ</span>
    <h1 id="tr-auth-title">{heading}</h1>
    {legal ? <LegalDocument audience={legal} /> : kind === 'offers' ? <>
      <p>Здесь можно ознакомиться с документами до входа и регистрации. Открывается действующая редакция с сервера, без вымышленных условий.</p>
      <div className="tr-guest-info-items">
        {DOCUMENTS.map(d => <a key={d.id} className="tr-guest-info-item" href={'#/offer/' + d.id}>
          <b>{d.name}</b><small>{d.hint}</small><span aria-hidden="true">›</span>
        </a>)}
        <a className="tr-guest-info-item" href="#/rules"><b>Правила площадки</b><small>Основные принципы для всех участников</small><span aria-hidden="true">›</span></a>
      </div>
      <a className="tr-guest-info-cta" href="#/join">Зарегистрироваться как партнёр</a>
    </> : kind === 'help' ? <>
      <p>Нужна помощь с аккаунтом, заявкой или подключением к TrakSOS? Войдите в личный кабинет — там обращение будет связано с вашей учётной записью.</p>
      <div className="tr-guest-info-items">
        <a className="tr-guest-info-item" href="#/login"><b>Я уже пользуюсь TrakSOS</b><small>Войти по номеру и паролю</small><span aria-hidden="true">›</span></a>
        <a className="tr-guest-info-item" href="#/register"><b>Я здесь впервые</b><small>Регистрация владельца или водителя</small><span aria-hidden="true">›</span></a>
        <a className="tr-guest-info-item" href="#/join"><b>Я мастер, СТО или другой партнёр</b><small>Подключиться к платформе</small><span aria-hidden="true">›</span></a>
      </div>
      <p className="tr-guest-info-note">При опасной неисправности тормозов или рулевого управления прекратите движение и обращайтесь за экстренной помощью по обстановке.</p>
    </> : kind === 'company' ? <>
      <p>TrakSOS объединяет помощь на дороге, выездных мастеров, эвакуацию, грузовые СТО, технические материалы, запчасти и страховые обращения в одной системе.</p>
      <div className="tr-guest-info-items">
        <div className="tr-guest-info-card"><b>Стартовая зона</b><small>Санкт-Петербург и Ленинградская область. Доступность проверяется при обращении.</small></div>
        <div className="tr-guest-info-card"><b>Одна история работы</b><small>Заявки, статусы, переписка и документы связаны с вашим кабинетом.</small></div>
      </div>
      <div className="tr-guest-info-actions"><a className="tr-guest-info-cta" href="#/register">Зарегистрироваться</a><a className="tr-guest-info-secondary" href="#/join">Стать партнёром</a></div>
    </> : kind === 'guide' ? <>
      <p>Выберите нужный сервис, войдите или зарегистрируйтесь, затем работайте с заявкой в своём кабинете — без дополнительных страниц и повторного выбора.</p>
      <div className="tr-guest-info-items">
        <div className="tr-guest-info-card"><b>1. Выберите услугу</b><small>Мастер, эвакуация, СТО, ЭБУ и другие направления</small></div>
        <div className="tr-guest-info-card"><b>2. Войдите или зарегистрируйтесь</b><small>Вход по паролю, SMS — только при регистрации или восстановлении</small></div>
        <div className="tr-guest-info-card"><b>3. Работайте в кабинете</b><small>Там находятся обращения, исполнители, статусы и история</small></div>
      </div>
      <div className="tr-guest-info-actions"><a className="tr-guest-info-cta" href="#/login">Войти</a><a className="tr-guest-info-secondary" href="#/register">Зарегистрироваться</a></div>
    </> : kind === 'pricing' ? <>
      <p>Основные условия комиссии при заказе услуг TrakSOS отображаются до подтверждения заявки.</p>
      <div className="tr-guest-info-items">
        <div className="tr-guest-info-card"><b>Для клиента — 5%</b><small>Сверх согласованной стоимости услуги, не более 5 000 ₽ за заказ</small></div>
        <div className="tr-guest-info-card"><b>Для исполнителя — 5%</b><small>Из стоимости услуги, не более 5 000 ₽ за заказ</small></div>
      </div>
      <p className="tr-guest-info-note">Конкретные суммы и действующие правовые условия уточняйте в заявке и опубликованных офертах.</p>
      <a className="tr-guest-info-secondary" href="#/offers">Открыть оферты и документы</a>
    </> : <>
      <p>Для всех пользователей действуют правила проверки исполнителей, согласования работ, безопасности, уважительного общения и разрешения споров.</p>
      <div className="tr-guest-info-items">
        <div className="tr-guest-info-card"><b>Проверенные исполнители</b><small>Доступ к заявкам предоставляется после проверки партнёра</small></div>
        <div className="tr-guest-info-card"><b>Согласование суммы</b><small>Работы и цена подтверждаются в рамках заказа</small></div>
        <div className="tr-guest-info-card"><b>Разбор споров</b><small>Обращения и оспаривание ограничений рассматриваются по материалам заявки</small></div>
      </div>
      <a className="tr-guest-info-cta" href="#/offers">Действующие оферты</a>
    </>}
  </div>;
}
