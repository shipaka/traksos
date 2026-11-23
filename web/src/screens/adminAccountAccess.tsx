import { useEffect, useRef, useState } from 'react';
import { post, fmtPhone } from '../api.ts';
import { useAction, useMe, useToast } from '../ui.tsx';
import {useAdminScopedResource} from '../adminScopedResource20261124.ts';

// Only non-staff accounts are manually provisioned here. Staff privileges
// remain controlled by the dedicated server-side phone allowlists.
const ROLE_OPTIONS = [
  { id: 'client', label: 'Клиент / владелец' },
  { id: 'driver', label: 'Водитель' },
  { id: 'master', label: 'Выездной мастер' },
  { id: 'tow', label: 'Эвакуаторщик' },
  { id: 'service', label: 'СТО и сервис' },
  { id: 'insurer', label: 'Страховой партнёр' },
  { id: 'inspection_operator', label: 'Оператор техосмотра' },
] as const;

const REPORT_TOPICS = [
  { value: 'registration', label: 'Ошибка регистрации' },
  { value: 'roles', label: 'Неправильные роли' },
  { value: 'login', label: 'Проблемы со входом' },
  { value: 'cabinet', label: 'Ошибка кабинета' },
  { value: 'other', label: 'Другая техническая проблема' },
] as const;
type ReportTopic = typeof REPORT_TOPICS[number]['value'];
type AccountResult = { user: { id: string; phone: string; name: string | null; roles: string[] }; activation: 'sms_reset' };
type DevReport = { id: string; user_id: string | null; phone: string | null; category: string;
  details: string; status: string; created_at: string; user_name: string | null;
  delivery_configured: boolean; delivery_sent_at: string | null; delivery_attempts: number;
  delivery_next_at: string; delivery_last_error: string | null };

export function AdminAccountAccess() {
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const scope=(me?.id??'signed-out')+':admin-account-access';
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const {busy,run}=useAction();
  const toast=useToast();
  const reports=useAdminScopedResource<DevReport[]>('/api/admin/developer-reports',scope,admin);
  const reloadRef=useRef(reports.reload);
  reloadRef.current=reports.reload;
  // An interval with a stable lifetime avoids polling storms on rerender.
  useEffect(()=>{
    if(!admin)return;
    const timer=window.setInterval(()=>reloadRef.current(),15_000);
    return ()=>window.clearInterval(timer);
  },[scope,admin]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>(['client']);
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<AccountResult | null>(null);
  const [reportPhone, setReportPhone] = useState('');
  const [category, setCategory] = useState<ReportTopic>('registration');
  const [details, setDetails] = useState('');
  const [lastReport, setLastReport] = useState<string | null>(null);
  const [draftScope,setDraftScope]=useState('');
  const [error,setError]=useState('');
  const currentDraft=draftScope===scope;
  useEffect(()=>{
    setPhone('');setName('');setRoles(['client']);setReason('');setCreated(null);
    setReportPhone('');setCategory('registration');setDetails('');setLastReport(null);
    setError('');setDraftScope(scope);
  },[scope]);

  async function createAccount() {
    if(!admin||busy||!currentDraft)return;
    if(roles.length<1||roles.length>3||reason.trim().length<10){
      setError('Для регистрации нужно от одной до трёх ролей и причина не короче 10 символов.');return;
    }
    if(!window.confirm('Создать новую учётную запись с указанными ролями? Пароль устанавливает сам владелец номера.'))return;
    const startedAs=scope;
    setError('');
    const result=await run(()=>post<AccountResult>('/api/admin/users/manual',{
      phone:phone.trim(),name:name.trim(),roles,reason:reason.trim(),
    }),null);
    if(scopeRef.current!==startedAs)return;
    if(result?.user?.id){
      setCreated(result);setReportPhone(result.user.phone);
      toast('Учётная запись создана. Передайте инструкцию для активации.');
    }else setError('Создание не подтверждено. Проверьте существующие аккаунты перед повтором, чтобы не создать дубль.');
  }

  async function fileReport() {
    if(!admin||busy||!currentDraft||details.trim().length<10)return;
    const startedAs=scope;
    setError('');
    const result=await run(()=>post<{id:string}>('/api/admin/developer-reports',{
      phone:reportPhone.trim()||undefined,category,details:details.trim(),
    }),null);
    if(scopeRef.current!==startedAs)return;
    if(result?.id){
      setLastReport(result.id);setDetails('');reports.reload();
      toast('Обращение сохранено. Если канал подключён, уведомление отправится автоматически.');
    }else setError('Сохранение обращения не подтверждено. Проверьте очередь перед повторной отправкой.');
  }

  async function copyReport(report: DevReport) {
    const message = [
      'TrakSOS — техническое обращение', 'Номер: ' + report.id,
      'Категория: ' + report.category,
      report.phone ? 'Телефон: ' + report.phone : '',
      'Описание: ' + report.details,
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(message); toast('Скопировано. Передавайте только через закрытый канал.'); }
    catch { toast('Не удалось скопировать. Откройте обращение на этом экране.'); }
  }

  if(!admin)return <div className="card stack">
    <h3>Администрирование аккаунтов</h3>
    <p role="alert">Регистрация пользователей и технические обращения доступны только администратору.</p>
  </div>;
  return <div className="stack">
    {error&&<div className="banner warn" role="alert">{error}</div>}
    <div className="card stack">
      <div>
        <h3>Зарегистрировать человека вручную</h3>
        <span className="note">Для семьи, партнёров и обращений в поддержку. Аккаунт создаётся без пароля; человек подтвердит свой номер через SMS и сам установит пароль.</span>
      </div>
      <label className="stack"><span className="label">Номер телефона</span>
        <input className="field" type="tel" autoComplete="off" placeholder="+7 999 123-45-67" value={phone}
          onChange={e => { setPhone(e.target.value); setCreated(null); }} />
      </label>
      <label className="stack"><span className="label">Имя (необязательно)</span>
        <input className="field" maxLength={120} placeholder="Имя пользователя" value={name}
          onChange={e => setName(e.target.value)} />
      </label>
      <div className="stack" role="group" aria-label="Назначаемые роли">
        <span className="label">Какие кабинеты получит пользователь?</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {ROLE_OPTIONS.map(option => <button type="button" key={option.id} className="chip"
            aria-pressed={roles.includes(option.id)}
            onClick={() => { setRoles(current => current.includes(option.id) ? current.filter(x => x !== option.id) : [...current, option.id]); setCreated(null); }}>
            {option.label}
          </button>)}
        </div>
        <span className="note">Допустимо совмещать мастер + СТО. Несовместимые роли будут отклонены сервером. Администратора и модератора здесь создать нельзя.</span>
      </div>
      <label className="stack"><span className="label">Почему регистрируем вручную?</span>
        <textarea className="field" rows={2} maxLength={500}
          placeholder="Например: регистрация по обращению, помощь родственнику, сбой SMS"
          value={reason} onChange={e => setReason(e.target.value)} />
      </label>
      <button className="btn" type="button" disabled={busy || !roles.length || reason.trim().length < 10 || phone.replace(/\D/g, '').length < 10}
        onClick={createAccount}>Создать учётную запись</button>
      {created && <div className="card stack" role="status">
        <b>Создан аккаунт: {created.user.name ?? fmtPhone(created.user.phone)}</b>
        <span className="note">Роли: {created.user.roles.join(', ')}. Пользователь ещё не получил пароль и не вошёл.</span>
        <a className="btn ghost small" href={'#/admin/user/' + created.user.id}>Открыть карточку и управлять ролями</a>
        <span className="note">Для первого входа отправьте человеку адрес вашего сайта с разделом <strong>#/activate</strong>. Он вводит свой номер, получает SMS-код и создаёт собственный пароль.</span>
      </div>}
    </div>

    <div className="card stack">
      <h3>Передать проблему разработчику</h3>
      <span className="note">Можно оформить обращение по одному телефону, даже если пользователь ещё не зарегистрирован или вы не открывали его кабинет.</span>
      <label className="stack"><span className="label">Телефон (необязательно)</span>
        <input className="field" type="tel" value={reportPhone} placeholder="+7 ..."
          onChange={e => setReportPhone(e.target.value)} />
      </label>
      <label className="stack"><span className="label">Тип проблемы</span>
        <select className="field" value={category} onChange={e => setCategory(e.target.value as ReportTopic)}>
          {REPORT_TOPICS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="stack"><span className="label">Что не работает?</span>
        <textarea className="field" rows={4} maxLength={3000}
          placeholder="Опишите ошибку, когда появилась и чего ожидали. Пароли и SMS-коды сюда не писать."
          value={details} onChange={e => setDetails(e.target.value)} />
      </label>
      <button className="btn" type="button" disabled={busy || details.trim().length < 10} onClick={fileReport}>
        Создать обращение разработчику
      </button>
      {lastReport && <span className="note" role="status">Внутреннее обращение № {lastReport} сохранено в очереди.</span>}
      <span className="note">Обращения надёжно сохраняются в админке. При наличии настроенного закрытого HTTPS-канала сервер сам передаёт разработчику только номер обращения и категорию — без телефона, паролей и описания проблемы. Без подключения канала пользуйтесь копированием в закрытый чат.</span>
    </div>

    <div className="card stack">
      <h3>Внутренние технические обращения</h3>
      {!reports.data ? <div className="empty">{reports.error ?? 'Загрузка обращений…'}</div>
      : reports.data.length === 0 ? <span className="note">Очередь пуста</span>
      : reports.data.map(report => <div key={report.id} className="card stack">
        <div className="between">
          <b>{REPORT_TOPICS.find(x => x.value === report.category)?.label ?? report.category}</b>
          <span className={'pill ' + (report.status === 'resolved' ? 'good' : '')}>{report.status === 'resolved' ? 'Решено' : report.delivery_sent_at ? 'В работе' : 'Открыто'}</span>
        </div>
        <span className="note">{new Date(report.created_at).toLocaleString('ru-RU')}{report.phone ? ' · ' + fmtPhone(report.phone) : ''}</span>
        <span className="note" role="status">
          {report.delivery_sent_at ? 'Уведомление принято закрытым каналом'
            : !report.delivery_configured ? 'Канал не подключён — обращение хранится внутри TrakSOS'
            : report.status === 'resolved' ? 'Закрыто без внешнего уведомления'
            : report.delivery_attempts > 0 ? 'Повторная отправка запланирована'
            : 'Ожидает автоматической отправки'}
          {report.delivery_configured && !report.delivery_sent_at && report.delivery_attempts > 0
            ? ' · попыток: ' + report.delivery_attempts : ''}
        </span>
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.details}</span>
        <div className="row">
          <button type="button" className="btn ghost small" onClick={() => copyReport(report)}>Скопировать для разработчика</button>
          {report.status !== 'resolved' && <button type="button" className="btn small" disabled={busy}
            onClick={async () => { if (!window.confirm('Проблема действительно устранена?')) return;
              if (await run(() => post('/api/admin/developer-reports/' + report.id + '/resolve'), 'Обращение отмечено решённым')) reports.reload();
            }}>Отметить решённым</button>}
        </div>
      </div>)}
    </div>
  </div>;
}
