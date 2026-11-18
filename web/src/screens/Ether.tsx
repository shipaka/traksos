// Only driver and fleet-owner identities may reach this preview.
// There is no broadcast API yet: no fake chat messages, fake online users or microphone grants.
import '../dispatchConsole.css';

export function Ether() {
  return <main className="ether-page" aria-label="Эфир TrakSOS">
    <section className="ether-hero">
      <span className="dispatch-eyebrow">TRAKSOS · ОБЩЕНИЕ НА ДОРОГЕ</span>
      <h1>Эфир</h1>
      <p>Пространство общения водителей и владельцев автопарков. Исполнители, СТО, эвакуаторщики и страховые партнёры не получают доступ через свои партнёрские кабинеты.</p>
    </section>
    <section className="ether-section">
      <h2>Общение по трассам и регионам</h2>
      <p>Текстовые комнаты, выбор маршрутов и жалобы на сообщения появятся после подключения проверенной системы модерации. Сейчас отправка сообщений недоступна.</p>
      <p>Здесь не место объявлениям партнёров и навязчивой рекламе. Для вызова помощи используйте заявку SOS, а не сообщения в «Эфире».</p>
    </section>
    <section className="ether-section ether-voice-preview">
      <div><h2>Голосовое общение <span className="ether-develop">В разработке</span></h2>
        <p>Планируем голосовые комнаты для водителей и владельцев. Микрофон не включается, разговоры не передаются и не записываются.</p>
      </div>
      <button type="button" disabled aria-label="Голосовое общение в разработке">Начать разговор</button>
    </section>
    <section className="ether-section">
      <h2>Правила спокойного эфира</h2>
      <p>Запрещены коммерческие предложения от партнёров, спам, повторяющиеся рекламные сообщения и публикация чужих персональных данных. Проверку доступа, жалобы и ограничения частоты сообщений необходимо реализовать на сервере до запуска текстовых и голосовых комнат.</p>
    </section>
  </main>;
}
