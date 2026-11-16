import { useState } from 'react';
import { get, post, fmtPhone } from '../api.ts';
import { useAction, useLoad, useToast } from '../ui.tsx';

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
  details: string; status: string; created_at: string; user_name: string | null };

export function AdminAccountAccess() {
  const { busy, run } = useAction();
  const toast = useToast();
  const reports = useLoad<DevReport[]>(() => get('/api/admin/developer-reports'), []);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>(['client']);
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<AccountResult | null>(null);
  const [reportPhone, setReportPhone] = useState('');
  const [category, setCategory] = useState<ReportTopic>('registration');
  const [details, setDetails] = useState('');
  const [lastReport, setLastReport] = useState<string | null>(null);

  async function createAccount() {
    if (!window.confirm('Создать новую учётную запись с указанными ролями? Пароль устанавливает сам владелец номера.')) return;
    const result = await run(() => post<AccountResult>('/api/admin/users/manual', { phone, name, roles, reason }), null);
    if (result) {
      setCreated(result);
      setReportPhone(result.user.phone);
      toast('Учётная запись создана. Передайте инструкцию для активации.');
    }
  }

  async function fileReport() {
    const result = await run(() => post<{ id: string }>('/api/admin/developer-reports', {
      phone: reportPhone.trim() || undefined, category, details,
    }), null);
    if (result) {
      setLastReport(result.id);
      setDetails('');
      reports.reload();
      toast('Сохранено во внутренней очереди для разработчика');
    }
  }

  async function copyReport(report: DevReport) {
    const message = [
      'TrackSOS — техническое обращение', 'Номер: ' + report.id,
      'Категория: ' + report.category,
      report.phone ? 'Телефон: ' + report.phone : '',
      'Описание: ' + report.details,
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(message); toast('Скопировано. Передавайте только через закрытый канал.'); }
    catch { toast('Не удалось скопировать. Откройте обращение на этом экране.'); }
  }

  return <div className="stack">
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
      <span className="note">Сейчас обращения сохраняются во внутренней очереди. Автоматическая отправка в почту или GitHub пока не настроена. Для передачи используйте кнопку «Скопировать» и закрытый канал — не размещайте телефоны в публичных задачах.</span>
    </div>

    <div className="card stack">
      <h3>Внутренние технические обращения</h3>
      {!reports.data ? <div className="empty">{reports.error ?? 'Загрузка обращений…'}</div>
      : reports.data.length === 0 ? <span className="note">Очередь пуста</span>
      : reports.data.map(report => <div key={report.id} className="card stack">
        <div className="between">
          <b>{REPORT_TOPICS.find(x => x.value === report.category)?.label ?? report.category}</b>
          <span className={'pill ' + (report.status === 'resolved' ? 'good' : '')}>{report.status === 'resolved' ? 'Решено' : 'Ждёт передачи'}</span>
        </div>
        <span className="note">{new Date(report.created_at).toLocaleString('ru-RU')}{report.phone ? ' · ' + fmtPhone(report.phone) : ''}</span>
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
