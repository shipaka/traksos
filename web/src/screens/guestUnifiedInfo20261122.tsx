import { useEffect, useState } from 'react';
import { get, ApiError } from '../api.ts';
import { Markdown } from '../markdown.tsx';

/** Only legal documents may open independently of browser authentication. */
export type GuestInfoKind = 'offers' | 'rules' | `offer:${string}`;
type LegalDocument = { version: string; effective_at: string; body: string };
const DOCUMENTS = [
  { id: 'client', name: 'Оферта для клиентов', hint: 'Работа с заявками и сервисами' },
  { id: 'performer', name: 'Договор для мастеров, эвакуаторов и СТО', hint: 'Условия партнёрства и агентских отношений' },
  { id: 'insurer', name: 'Договор страхового партнёра', hint: 'Работа со страховыми обращениями' },
  { id: 'inspection', name: 'Договор партнёра по техосмотру', hint: 'Порядок сотрудничества' },
  { id: 'privacy', name: 'Обработка персональных данных', hint: 'Действующая политика конфиденциальности' },
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
      Не удалось загрузить документ. Это не означает, что он не опубликован.
      <button type="button" className="tr-guest-info-link" onClick={() => setRetry(n => n + 1)}>Попробовать снова</button>
    </div> : doc === undefined ? <p role="status">Загружаем действующий документ…</p>
    : doc === null ? <p role="status">Действующая редакция этого документа пока не опубликована. Черновые условия не показываем.</p>
    : <><p className="tr-guest-info-note">Редакция {doc.version} · действует с {new Date(doc.effective_at).toLocaleDateString('ru-RU')}</p>
       <div className="tr-guest-legal-body"><Markdown text={doc.body ?? ''}/></div></>}
  </div>;
}

/** Legal-only panel over the owner-approved 617/618 public homepage.
 * Official terms are loaded from the server; no made-up clauses are inserted. */
export function GuestUnifiedInfo({ kind, onBack }: { kind: GuestInfoKind; onBack?: () => void }) {
  const legal = kind.startsWith('offer:') ? kind.slice('offer:'.length) : null;
  const heading = legal ? (DOCUMENTS.find(d => d.id === legal)?.name ?? 'Документ TrakSOS')
    : kind === 'offers' ? 'Оферты и документы' : 'Правила площадки';
  return <div className="tr-guest-info" aria-label={heading}>
    {onBack
      ? <button type="button" className="tr-guest-info-back" onClick={onBack}>← Вернуться к регистрации</button>
      : kind !== 'offers' && <a className="tr-guest-info-back" href="#/offers">← К списку документов</a>}
    <span className="tr-guest-info-kicker">TRAKSOS · ДОКУМЕНТЫ</span>
    <h1 id="tr-auth-title">{heading}</h1>
    {legal ? <LegalDocument audience={legal} /> : kind === 'offers' ? <>
      <p>Выберите документ, чтобы прочитать действующую редакцию прямо здесь, не покидая главную страницу TrakSOS.</p>
      <div className="tr-guest-info-items">
        {DOCUMENTS.map(d => <a key={d.id} className="tr-guest-info-item" href={'#/offer/' + d.id}>
          <b>{d.name}</b><small>{d.hint}</small><span aria-hidden="true">›</span>
        </a>)}
        <a className="tr-guest-info-item" href="#/rules">
          <b>Правила площадки</b><small>Краткое описание принципов работы и разрешения споров</small><span aria-hidden="true">›</span>
        </a>
      </div>
      <p className="tr-guest-info-note">Комиссии и расчёты указываются в действующих условиях и подтверждаются в заявке до оплаты. Новые документы появятся здесь после публикации.</p>
      <a className="tr-guest-info-cta" href="#/join">Зарегистрироваться как партнёр</a>
    </> : <>
      <p>Основные принципы работы TrakSOS: проверка исполнителей, согласование работ и цены, безопасность, уважительное общение и возможность оспорить ограничение или спорную ситуацию.</p>
      <div className="tr-guest-info-items">
        <div className="tr-guest-info-card"><b>Проверка партнёров</b><small>Исполнитель получает доступ к рабочим заявкам после проверки профиля.</small></div>
        <div className="tr-guest-info-card"><b>Прозрачная стоимость</b><small>Работы и итоговые суммы согласуются до подтверждения заказа.</small></div>
        <div className="tr-guest-info-card"><b>История и споры</b><small>В рамках заявки сохраняются необходимые статусы, переписка и подтверждения.</small></div>
      </div>
      <p className="tr-guest-info-note">Это справочное резюме, а не замена действующей оферты. Юридические условия — в опубликованных документах.</p>
    </>}
  </div>;
}
