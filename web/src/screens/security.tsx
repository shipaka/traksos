import { useEffect, useState } from 'react';
import { native } from '../native.ts';
import { useMe } from '../ui.tsx';

/**
 * One shared account-security screen for client, driver, performer, STO,
 * insurance, inspection, moderator and administrator roles.
 * Sensitive PIN entry and biometric verification stay inside native Android.
 */
export function Security() {
  const { me } = useMe();
  const [pin, setPin] = useState(() => native.appPinEnabled());
  const [biometrics, setBiometrics] = useState(() => native.appLockEnabled());
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const sync = (event: Event) => {
      const e = event as CustomEvent<{ name?: string }>;
      if (e.detail?.name !== 'appPinChanged') return;
      setPin(native.appPinEnabled());
      setBiometrics(native.appLockEnabled());
      setFeedback('Настройки быстрого входа обновлены.');
    };
    window.addEventListener('traksos-native', sync);
    return () => window.removeEventListener('traksos-native', sync);
  }, []);

  if (!me) return null;
  const workRole = me.roles.some(role => ['master','tow','service','insurer','inspection_operator'].includes(role));
  const restrictedStaff = me.roles.some(role => ['admin', 'moderator'].includes(role));
  const changeBiometrics = (enabled: boolean) => {
    if (!native.setAppLockEnabled(enabled)) {
      setFeedback('Для отпечатка сначала добавьте его в настройках телефона. На старых устройствах доступен системный код блокировки.');
      return;
    }
    setBiometrics(enabled);
    setFeedback(enabled ? 'Биометрическая разблокировка включена.' : 'Биометрическая разблокировка отключена.');
  };

  return <main className="ts-security-page">
    <a className="ts-security-back" href="#/profile">← Профиль и настройки</a>
    <section className="ts-security-hero" aria-labelledby="security-title">
      <div className="ts-security-glow" aria-hidden="true" />
      <div className="ts-security-hero-copy">
        <span className="ts-security-eyebrow">TrakSOS · PRIVATE ACCESS</span>
        <span className="ts-security-shield" aria-hidden="true">◈</span>
        <h1 id="security-title">Безопасность и вход</h1>
        <p>Ваш кабинет под защитой. Один вход в аккаунт — затем быстрый доступ с этого устройства.</p>
        <div className="ts-security-status"><span aria-hidden="true" className="ts-security-pulse" />Сеанс активен</div>
      </div>
      <div className="ts-security-route" aria-hidden="true"><span /><span /><span /></div>
    </section>

    <div className="ts-security-grid">
      <section className="ts-security-panel" aria-labelledby="quick-access">
        <div className="ts-security-panel-head"><span className="ts-security-panel-icon" aria-hidden="true">⌘</span><div>
          <h2 id="quick-access">Быстрый вход в APK</h2>
          <p>Отпечаток или четыре цифры вместо постоянного ввода пароля.</p>
        </div></div>
        {native.isApp ? <>
          <div className="ts-security-state">
            <span>PIN TrakSOS</span><b>{pin ? 'Настроен' : 'Не настроен'}</b>
          </div>
          <div className="ts-security-actions">
            <button type="button" className="btn" onClick={() => { native.setupAppPin(); setFeedback('PIN создаётся в защищённом окне Android.'); }}>
              {pin ? 'Изменить PIN' : 'Создать PIN из 4 цифр'}
            </button>
            {pin && <button type="button" className="btn ghost" onClick={() => native.removeAppPin()}>Удалить PIN</button>}
          </div>
          <label className="ts-security-switch">
            <input type="checkbox" checked={biometrics} onChange={e => changeBiometrics(e.target.checked)}/>
            <span><b>Отпечаток или защита устройства</b><small>Быстрая разблокировка при возвращении в приложение</small></span>
          </label>
          <p className="ts-security-fine">PIN хранится только на этом телефоне и не передаётся на сервер. При смене пользователя требуется новый вход.</p>
        </> : <p className="ts-security-fine">На сайте PIN приложения не требуется. После установки APK здесь можно будет включить четырёхзначный код и отпечаток.</p>}
      </section>

      <section className="ts-security-panel" aria-labelledby="password-title">
        <div className="ts-security-panel-head"><span className="ts-security-panel-icon" aria-hidden="true">✦</span><div>
          <h2 id="password-title">Пароль и восстановление</h2>
          <p>Управление основной учётной записью TrakSOS.</p>
        </div></div>
        <div className="ts-security-state"><span>Телефон для подтверждения</span><b>Привязан к аккаунту</b></div>
        {restrictedStaff
          ? <p className="ts-security-fine">Для администратора и модератора самостоятельное SMS-восстановление ограничено ради безопасности платформы. Запросите проверенную процедуру восстановления у ответственного администратора сервера; PIN телефона не заменяет пароль учётной записи.</p>
          : <>
            <a className="btn" href="#/reset">Сменить пароль через SMS</a>
            <p className="ts-security-fine">Забыли пароль? На экране входа выберите «Забыли пароль?». Код придёт на зарегистрированный номер. После смены пароля прежние сеансы прекращаются. Для особо защищённых партнёрских аккаунтов может потребоваться ручная проверка.</p>
          </>}
      </section>

      <section className="ts-security-panel" aria-labelledby="sessions-title">
        <div className="ts-security-panel-head"><span className="ts-security-panel-icon" aria-hidden="true">◇</span><div>
          <h2 id="sessions-title">Этот браузер и устройство</h2>
          <p>Без повторной авторизации после каждого открытия.</p>
        </div></div>
        <div className="ts-security-state"><span>Автоматический выход после отсутствия</span><b>90 дней без активности</b></div>
        <p className="ts-security-fine">Закрытие вкладки, звонок или сворачивание приложения не означает выход. При регулярном использовании сеанс продлевается, а после 90 дней отсутствия истекает. Смена пароля, отзыв доступа или явный выход тоже завершают сеанс.</p>
        <p className="ts-security-fine">По желанию разрешите Chrome, Android Autofill или вашему менеджеру паролей сохранять пароль. Сам TrakSOS пароль в открытом виде не сохраняет. IP-адрес не используется как признак доверенного устройства.</p>
      </section>

      <section className="ts-security-panel" aria-labelledby="notifications-title">
        <div className="ts-security-panel-head"><span className="ts-security-panel-icon" aria-hidden="true">◌</span><div>
          <h2 id="notifications-title">Работа и уведомления</h2>
          <p>Ваша доступность — под вашим управлением.</p>
        </div></div>
        {workRole ? <p className="ts-security-fine">Если вы на линии, сворачивание приложения, блокировка экрана и обычный телефонный звонок не переключают вас в «Не на линии». Статус меняется вручную. Для получения уведомлений разрешите их в настройках телефона и отключите жёсткое ограничение фоновой работы для TrakSOS, если устройство его применяет.</p>
          : <p className="ts-security-fine">Новые сообщения, предложения и обновления заявок можно получать через уведомления. Для надёжной доставки в APK разрешите системные уведомления.</p>}
        <p className="ts-security-fine">Уведомления зависят от сети, настроек энергосбережения и разрешений ОС. Мы не считаем закрытие экрана отказом от работы.</p>
      </section>
    </div>
    {feedback && <p className="ts-security-feedback" role="status">{feedback}</p>}
    <p className="ts-security-footer">TrakSOS защищает доступ, не мешая работе. Ваши заявки, контакты и состояние линии остаются в вашем кабинете.</p>
  </main>;
}
