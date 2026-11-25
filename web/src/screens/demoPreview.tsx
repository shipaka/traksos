/**
 * The former public PIN-based training demo displayed obsolete React mock
 * cabinets, with fabricated requests/totals unlike the approved 617/618
 * real role workspaces. It must not remain reachable after release.
 *
 * Only the authenticated administrator's isolated full-fidelity sandbox can
 * select among 12 real cabinets. No guest PIN exchange, fake employee account,
 * or duplicated mini-dashboard is available here.
 */
export function DemoPreviewGate({roleId: _roleId}:{roleId?:string}) {
  return <main className="tr-approved-route-unavailable"
      aria-label="Устаревший демонстрационный просмотр закрыт">
    <span className="tr-approved-route-eyebrow">TRAKSOS · БЕЗОПАСНОЕ ТЕСТИРОВАНИЕ</span>
    <h1>Старый демонстрационный просмотр закрыт</h1>
    <p>Этот режим показывал учебные копии кабинетов и больше не используется.
      Для проверки дизайна 617/618 открывайте настоящие тестовые кабинеты
      через защищённый раздел администратора. Данные тестовой площадки
      полностью отделены от пользователей, платежей и SMS.</p>
    <a href="#/login" className="btn">Войти в TrakSOS</a>
  </main>;
}
