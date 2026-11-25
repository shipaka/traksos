// Isolated practice simulator: absolutely no API calls, messages, billing or persisted orders.
// Scenarios are illustrative examples, not legal terms or an operational promise.
import { useEffect, useState } from 'react';
import { useMe } from '../ui.tsx';
import { trainingRole } from './training.tsx';

type Step = { title: string; explanation: string; action: string; result: string; warning?: string };
type Scenario = { title: string; introduction: string; steps: Step[] };
const scenarios: Record<string, Scenario> = {
  owner: { title: 'Владелец — помощь грузовику', introduction: 'Тестовая Scania встала у КАД. Водитель просит помощь, владелец согласует расходы.', steps: [
    {title:'Машина',explanation:'Укажите транспорт, чтобы подобрать нужного мастера.',action:'Выбрать Scania (пример)',result:'Машина выбрана.'},
    {title:'Заявка',explanation:'Опишите неисправность и проверьте геолокацию.',action:'Подготовить тестовую заявку',result:'Заявка подготовлена, реальным исполнителям не отправлена.'},
    {title:'Цена',explanation:'Перед заказом показаны цена работы, комиссия и итог. Пример: работа 10 000 ₽, реальный итог берётся из согласованной сметы.',action:'Проверить стоимость (пример)',result:'Цена просмотрена. Никаких денег не списано.'},
    {title:'Согласование',explanation:'Водитель превышает лимит. Согласие даёт владелец.',action:'Одобрить в тренажёре',result:'Учебный лимит подтверждён.'},
    {title:'Продолжение',explanation:'Мастер советует СТО. Это новый заказ с отдельной ценой, а не доплата к прежнему.',action:'Согласовать новый этап в тренажёре',result:'Учебное продолжение согласовано отдельно.'},
    {title:'Результат',explanation:'Сверьте выполненное и документы.',action:'Завершить учебный кейс',result:'Практика завершена; настоящий заказ не создан.'},
  ]},
  driver: { title: 'Водитель — поломка на трассе', introduction: 'Тестовый водитель ищет помощь и передаёт владельцу расходы выше лимита.', steps: [
    {title:'Машина',explanation:'Работайте только с транспортом, который назначил владелец.',action:'Открыть назначенный автомобиль',result:'Вы видите только тестовую машину.'},
    {title:'SOS',explanation:'Выберите нужный вид помощи и укажите место.',action:'Заполнить SOS (тренажёр)',result:'Запрос подготовлен без отправки.'},
    {title:'Лимит',explanation:'Сумма выше лимита — подождите владельца. Не подтверждайте чужие расходы.',action:'Передать согласование владельцу',result:'Учебное уведомление владельцу показано только здесь.'},
    {title:'Прибытие',explanation:'Сообщите исполнителю о пропуске, подъезде и характере поломки.',action:'Уточнить детали',result:'Детали добавлены в учебный сценарий.'},
    {title:'Итог',explanation:'Просмотрите статус, не подписывайте за владельца лишние работы.',action:'Закончить практику',result:'Учебная заявка закрыта.'},
  ]},
  master: { title: 'Мастер — выезд, ремонт и передача', introduction: 'Тренировка полного рабочего цикла с безопасным продолжением заявки.', steps: [
    {title:'В работе',explanation:'Подключите только те специализации, которые действительно выполняете на выезде, включая гидравлику при наличии оборудования. Для стационарного ремонта настройте отдельно «Моя СТО» → «Кто у вас есть».',action:'Проверить профиль',result:'Профиль в тренажёре готов.'},
    {title:'Заявка',explanation:'Проверьте машину, место, расстояние и заявленную сумму.',action:'Принять учебную заявку',result:'Заявка принята в тренировке.'},
    {title:'Маршрут',explanation:'После выезда клиент должен видеть актуальный статус.',action:'Выехал',result:'Учебный статус: Выехал.'},
    {title:'На месте',explanation:'Отметьте фактическое прибытие.',action:'На месте',result:'Учебный статус: На месте.'},
    {title:'Новая услуга',explanation:'Нужна СТО, эвакуация или ЭБУ? Только предложение: отдельное согласие клиента, новый счёт.',action:'Отправить учебное предложение',result:'Предложение показано клиенту; автоматически оно не принято.',warning:'Это не разрешение на дополнительные списания.'},
    {title:'Итог',explanation:'Укажите реально выполненную работу и расходники отдельными строками.',action:'Закрыть учебный выезд',result:'Учебный выезд завершён.'},
  ]},
  tow: { title: 'Эвакуатор — забрать и передать', introduction: 'Тестовая эвакуация тяжёлого грузовика на СТО.', steps: [
    {title:'Техника',explanation:'Проверьте допустимую массу и вид эвакуатора.',action:'Проверить возможности',result:'Тестовая техника подходит.'},
    {title:'Маршрут',explanation:'Уточните точки, погрузку и полную цену.',action:'Согласовать перевозку (пример)',result:'Учебная цена согласована.'},
    {title:'Выехал',explanation:'Поменяйте статус только при реальном выезде.',action:'Выехал',result:'Статус учтён в тренажёре.'},
    {title:'На месте',explanation:'Проверьте автомобиль и безопасность погрузки.',action:'На месте',result:'Учебное прибытие отмечено.'},
    {title:'СТО',explanation:'Предложите СТО, но не оформляйте заказ без согласия клиента.',action:'Создать учебное предложение СТО',result:'Предложение создано без настоящих заявок.'},
    {title:'Завершение',explanation:'Отметьте фактическую доставку и результат.',action:'Завершить тренировку',result:'Тестовая перевозка выполнена.'},
  ]},
  consultant: { title: 'Консультант — мультизаявка', introduction: 'Покажем, как после консультации передать клиенту предложение следующей услуги.', steps: [
    {title:'Обращение',explanation:'Проверьте симптомы и модель ТС.',action:'Принять консультацию',result:'Учебная консультация открыта.'},
    {title:'Безопасность',explanation:'Не предлагайте опасных действий с тормозами, электрикой и под поднятым автомобилем.',action:'Отметить безопасные рекомендации',result:'Рекомендации зафиксированы.'},
    {title:'Решение',explanation:'По результатам требуется выезд диагноста.',action:'Предложить диагноста',result:'Клиент увидит предложение, но оно ещё не принято.'},
    {title:'Согласие',explanation:'У клиента отдельный выбор нового исполнителя и цены.',action:'Смоделировать согласие клиента',result:'Отдельное учебное согласие зафиксировано.'},
    {title:'История',explanation:'Оба этапа связаны одной поломкой, но имеют отдельные счета.',action:'Завершить консультацию',result:'Практика закончена.'},
  ]},
  service: { title: 'СТО — от записи до счёта', introduction: 'Один учебный автомобиль, приём, ремонт, новая смета и закрытие.', steps: [
    {title:'Запись',explanation:'Примите заявку только при наличии возможности ремонта.',action:'Принять тестовый автомобиль',result:'Тестовый автомобиль ожидается.'},
    {title:'Приём',explanation:'Отметьте реальное прибытие и диагностику.',action:'Машина прибыла',result:'Статус: диагностика.'},
    {title:'Смета',explanation:'Работы и материалы выделены отдельно; итог показывают клиенту до подтверждения.',action:'Предложить смету (пример)',result:'Учебная смета составлена.'},
    {title:'Согласование',explanation:'Не начинайте дополнительные работы без отдельного согласия.',action:'Смоделировать согласие клиента',result:'Согласие получено только в тренировке.'},
    {title:'Готовность',explanation:'Укажите перечень работ и статус «Готова».',action:'Машина готова',result:'Статус ремонта обновлён.'},
    {title:'Счёт',explanation:'До закрытия клиент видит детализацию и может обратиться по спору.',action:'Закрыть учебный счёт',result:'Ремонт завершён в тренажёре.'},
  ]},
  insurer: { title: 'Страхование — путь запроса', introduction: 'Учебные предложения без полисов и финансовых операций.', steps: [
    {title:'Запрос',explanation:'Проверьте назначенный страховой запрос и ТС.',action:'Принять тестовый запрос',result:'Запрос на рассмотрении.'},
    {title:'Расчёт',explanation:'Разделите премию страховщика и вознаграждение посредника.',action:'Создать учебное предложение',result:'Предложение подготовлено.'},
    {title:'Сравнение',explanation:'Клиент выбирает страховщика и условия.',action:'Отправить тестовые варианты',result:'Учебные предложения доступны клиенту.'},
    {title:'Выбор',explanation:'Никакой страховщик не выбран автоматически.',action:'Смоделировать выбор клиента',result:'Выбор подтверждён только в сценарии.'},
    {title:'Документ',explanation:'Полис оформляется только через реальную уполномоченную цепочку.',action:'Прикрепить макет документа',result:'Учебный образец приложен. Реальный полис не выпускался.'},
  ]},
  inspection: { title: 'Техосмотр — проверка запроса', introduction: 'Пример учёта обращения без выдачи диагностической карты.', steps: [
    {title:'Запись',explanation:'Назначенный запрос отображается в кабинете.',action:'Открыть пример запроса',result:'Запрос открыт.'},
    {title:'Проверка',explanation:'Сверьте документы и машину по установленной процедуре.',action:'Отметить проверку',result:'Учебные данные сверены.'},
    {title:'Результат',explanation:'Статус обращения не равен оформлению диагностической карты.',action:'Завершить учёт запроса',result:'Статус изменён лишь в учебной среде.'},
  ]},
  moderator: { title: 'Модератор — решение по спору', introduction: 'Нужно обосновать результат и сохранить право сторон оспорить его.', steps: [
    {title:'Кейс',explanation:'Посмотрите обращение клиента и исполнителя.',action:'Открыть учебный спор',result:'Открыт тестовый кейс.'},
    {title:'Доказательства',explanation:'Просмотрите согласованную сумму, статусы, чат и документы.',action:'Проверить факты',result:'Учебные данные проверены.'},
    {title:'Решение',explanation:'Вывод должен объяснять, чем подтверждается нарушение.',action:'Подготовить обоснование',result:'Основание заполнено в тренажёре.'},
    {title:'Уведомление',explanation:'Стороны должны получить решение и способ его обжаловать.',action:'Закрыть учебное обращение',result:'Пример обращения закрыт без реальных санкций.'},
  ]},
  admin: { title: 'Администратор — контроль запуска', introduction: 'Проверка исполнителей, комиссий и условий без изменений production.', steps: [
    {title:'Очередь',explanation:'Сначала незакрытые и просроченные заявки.',action:'Открыть учебную сводку',result:'Тестовая очередь просмотрена.'},
    {title:'Проверка',explanation:'Профиль без документов не выдаём за подтверждённый.',action:'Проверить карточку партнёра',result:'Сведения проверены в сценарии.'},
    {title:'Тарифы',explanation:'Не публикуйте ставки, пока они не совпадают с расчётом и офертой.',action:'Сверить комиссию (пример)',result:'Учебное сравнение выполнено.'},
    {title:'Юридическое',explanation:'Текст оферты и версия должны быть утверждены.',action:'Проверить редакцию оферты',result:'Условия проверены в тренажёре.'},
    {title:'Выпуск',explanation:'Нужны CI, бэкап, sandbox и отдельное разрешение на продакшен.',action:'Завершить контрольный список',result:'Практика завершена; сервер не обновлён.'},
  ]},
};

export function TrainingPractice({ chapter }: { chapter?: string }) {
  const { me, mode } = useMe();
  const ownRole = trainingRole(mode, me?.roles ?? [], me?.owner_id);
  const isAdmin = !!me?.roles.includes('admin');
  const role = (isAdmin || (ownRole === 'master' && chapter === 'consultant')) && chapter && scenarios[chapter] ? chapter : ownRole;
  const scene = scenarios[role];
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => { setCurrent(0); setDone(false); }, [role]);
  const step = scene.steps[Math.min(current, scene.steps.length - 1)];
  const progress = done ? scene.steps.length : current;
  const advance = () => { if (current === scene.steps.length - 1) setDone(true); else setCurrent(n => n + 1); };
  return <main className="tr-training-page tr-training-practice">
    <a className="note" href={'#/training/' + role}>← Назад к обучению</a>
    <section className="tr-training-hero"><span className="label">TRAKSOS · ТРЕНИРОВКА</span>
      <h1>{scene.title}</h1><p>{scene.introduction}</p></section>
    <div className="banner" role="status"><b>ТЕСТОВЫЙ РЕЖИМ</b><span>Никаких заявок, уведомлений клиентам, платежей и изменений аккаунта. Все действия существуют только на этой странице.</span></div>
    <section className="tr-training-workspace">
      <div className="tr-training-progress"><div className="tr-training-progress-label"><strong>Учебный сценарий</strong><span>{progress} из {scene.steps.length} выполнено</span></div>
        <div className="tr-training-track" role="progressbar" aria-label="Прогресс практики" aria-valuemin={0} aria-valuemax={scene.steps.length} aria-valuenow={progress}>
          <span style={{width:(progress / scene.steps.length) * 100 + '%'}} />
        </div></div>
      {done ? <div className="card stack" role="status"><h2>Практика завершена</h2>
          <p>Теперь можно вернуться в свой кабинет. Тестовые действия не затронули реальные данные.</p>
          <div className="row"><button type="button" className="btn ghost" onClick={() => {setCurrent(0);setDone(false);}}>Пройти ещё раз</button><a className="btn" href={'#/training/'+role}>К инструкциям</a></div></div>
        : <div className="tr-training-lesson"><span className="label">ШАГ {current+1}</span><h2>{step.title}</h2>
          <p className="tr-training-purpose">{step.explanation}</p>
          {step.warning && <p className="tr-training-caution">{step.warning}</p>}
          <div className="tr-training-instruction"><strong>Результат после действия</strong><p>{step.result}</p></div>
          <button className="btn" type="button" onClick={advance}>{step.action}</button>
        </div>}
      <nav className="tr-training-step-links" aria-label="Маршрут практики">
        {scene.steps.map((s,i)=><span key={s.title} className={i===current&&!done?'active':''}>{i+1}. {s.title}</span>)}
      </nav>
    </section>
  </main>;
}
