/**
 * DEBUG APK ONLY: review the actual React Android workspaces without SMS,
 * backend, customer records or payment actions. This is not an auth bypass.
 * A production APK never exposes this route (native.isPreviewBuild=false).
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { AndroidClientWorkspace, AndroidPerformerWorkspace } from './androidWorkspaces.tsx';
import { APPROVED_VISUALS } from '../approvedVisuals.ts';

const sampleOrder = {
  id: 'SYNTHETIC-REVIEW',
  number: '78452 · ДЕМО',
  service: 'repair',
  status: 'en_route',
  description: 'Не набирает давление в тормозной системе',
  address: 'Пример адреса: Санкт-Петербург, КАД, 68 км',
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
  return <div className={'app role-' + (performer ? 'performer' : 'client') + ' and19-review-page'}
    aria-label="Проверка Android APK по утверждённому дизайну">
    <header className="and19-review-header">
      <img src={APPROVED_VISUALS.logo} alt="TrakSOS" width="218" height="37" />
      <a href="#/" aria-label="К обычному приложению">В приложение</a>
    </header>
    <aside className="and19-review-warning" role="note">
      <strong>ПРОСМОТР ДИЗАЙНА · ТЕСТОВЫЙ APK</strong>
      <span>Все данные на этом экране вымышленные. Ни заявки, ни платежи, ни звонки не отправляются.</span>
    </aside>
    <nav className="and19-review-roles" aria-label="Просмотр рабочих столов">
      {roles.map(item => <a href={'#/android-review/' + item.key} key={item.key}
        aria-current={selected === item.key ? 'page' : undefined}>{item.title}</a>)}
    </nav>
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
    <footer className="and19-review-footer">
      <span>Это реальные компоненты кабинетов Android, заполненные примерами только для сверки внешнего вида.</span>
      <a href="#/">Перейти ко входу в TrakSOS</a>
    </footer>
  </div>;
}
