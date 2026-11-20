/**
 * DEBUG APK ONLY: review the actual React Android workspaces without SMS,
 * backend, customer records or payment actions. This is not an auth bypass.
 * A production APK never exposes this route (native.isPreviewBuild=false).
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { AndroidClientWorkspace, AndroidPerformerWorkspace } from './androidWorkspaces.tsx';
import { APPROVED_VISUALS } from '../approvedVisuals.ts';
import { NavGlyph } from '../navGlyph.tsx';

const sampleOrder = {
  id: 'SYNTHETIC-REVIEW',
  number: '78452 · ДЕМО',
  service: 'repair',
  status: 'en_route',
  description: 'Не набирает давление в тормозной системе',
  address: 'Пример адреса: Санкт-Петербург, КАД, 68 км',
  performer_name: 'Мастер Иван · пример',
  client_name: 'ООО «ТрансЛогистика» · пример',
  vehicle: { brand: 'Scania', model: 'R520', year: 2019 },
  money: { total: 10500 },
};
const roles = [
  { key: 'client', title: 'Клиент' },
  { key: 'driver', title: 'Водитель' },
  { key: 'master', title: 'Мастер' },
  { key: 'tow', title: 'Эвакуатор' },
] as const;
type ReviewRole = typeof roles[number]['key'];

export function AndroidDesignReview({ role }: { role?: string }) {
  const selected: ReviewRole = roles.find(item => item.key === role)?.key ?? 'client';
  const [message, setMessage] = useState('');
  const performer = selected === 'master' || selected === 'tow';
  useEffect(() => {
    setMessage('');
    // Mark an actual React render inside the installed APK for emulator evidence.
    (window as any).TrakSOSNative?.designReviewReady?.(selected);
  }, [selected]);
  const blockLiveAction = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a,button')) {
      event.preventDefault();
      event.stopPropagation();
      setMessage('Это просмотр оформления. Для реального действия откройте свой кабинет после входа.');
    }
  };
  // Copy the actual role's Shell tab configuration and vector component.
  // In review they cannot open authenticated screens or send a request.
  const tabs: [string, string][] = performer
    ? [['⌂','Главная'],['☷','Заявки'],['▤','Чат'],['◉','Меню']]
    : [['⌂','Главная'],['☷','Заявки'],['◌','Эфир'],
       ['▣','Техника'],['🛍','Магазин'],['◉','Меню']];
  return <div className={'app role-' + (performer ? 'performer' : 'client') + ' and19-review-page'}
    aria-label="Проверка Android APK по утверждённому дизайну">
    <header className="and19-review-header">
      <img src={APPROVED_VISUALS.logo} alt="TrakSOS" width="218" height="37" />
      <div className="and19-review-header-actions">
        <span className="and19-review-bell" aria-label="Уведомления в демо недоступны" role="img">♧</span>
        <a href="#/" aria-label="Выйти из режима просмотра"><NavGlyph glyph="◉" /></a>
      </div>
    </header>
    <div className="and19-review-indicator" role="note">
      <strong>ДЕМО APK</strong>
      <span>Вымышленные данные · без оплаты и отправки заявок</span>
    </div>
    <div className="and19-review-live" onClickCapture={blockLiveAction}>
      {performer
        ? <AndroidPerformerWorkspace
            performer={{ kind: selected === 'tow' ? 'tow' : 'master', line_status: 'online',
              rating: 4.9, verification: 'approved' }}
            active={[sampleOrder]} auctions={[]} online={true} busy={true}
            setLine={() => {}} balance={{ to_pay: 9500 }} reloadAuctions={() => {}} />
        : <AndroidClientWorkspace
            orders={[sampleOrder]} loading={false} error={null}
            me={{ roles: selected === 'driver' ? ['driver'] : ['client'],
              owner_id: selected === 'driver' ? 'DEMO-OWNER' : null }}
            retry={() => {}} insuranceInProgress={[]} />}
    </div>
    {message && <p className="and19-review-message" role="status">{message}</p>}
    <details className="and19-review-switcher">
      <summary>Посмотреть другой кабинет · {roles.find(item => item.key === selected)?.title}</summary>
      <nav className="and19-review-roles" aria-label="Просмотр рабочих столов">
        {roles.map(item => <a href={'#/android-review/' + item.key} key={item.key}
          aria-current={selected === item.key ? 'page' : undefined}>{item.title}</a>)}
      </nav>
    </details>
    <footer className="and19-review-footer">
      <span>Настоящие компоненты Android. Данные — только пример для согласования.</span>
      <a href="#/">Перейти ко входу в TrakSOS</a>
    </footer>
    <nav className="tabbar and19-review-tabbar" aria-label="Нижнее меню Android, режим просмотра">
      {tabs.map(([glyph,title], index) =>
        <a key={title} href="#/android-review" className={index === 0 ? 'on' : ''}
          aria-current={index === 0 ? 'page' : undefined}
          onClick={event => {event.preventDefault();setMessage('В режиме просмотра меню не меняет реальные данные.');}}>
          <span className="ic"><NavGlyph glyph={glyph} /></span>{title}
        </a>)}
    </nav>
  </div>;
}
