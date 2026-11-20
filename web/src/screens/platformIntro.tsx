import { useState } from 'react';
import { Back, useMe } from '../ui.tsx';
import { TrainingPractice } from './trainingPractice.tsx';

type Role = 'owner'|'driver'|'master'|'tow'|'service'|'insurer'|'inspection'|'courier'|'moderator'|'admin';
type Lesson = { title:string; text:string; tip:string; path:string; link:string };
type Course = { label:string; lessons:Lesson[] };
const lesson=(title:string,text:string,tip:string,path:string,link:string):Lesson=>({title,text,tip,path,link});
export function learningRole(mode:string,roles:readonly string[]):Role {
  if(mode==='admin') return 'admin';
  if(mode==='moderator') return 'moderator';
  if(mode==='insurer') return 'insurer';
  if(mode==='inspection') return 'inspection';
  if(mode==='courier') return 'courier';
  if(mode==='service') return 'service';
  if(mode==='performer') return roles.includes('tow')?'tow':'master';
  return roles.includes('driver')?'driver':'owner';
}
export const courses:Record<Role,Course>={
  owner:{label:'Владелец автопарка',lessons:[
    lesson('Добро пожаловать','TrakSOS объединяет транспорт, заявки и помощь в дороге. Уроки ничего не оформляют и не оплачивают.','В Android остальные разделы открываются через нижнюю кнопку «Меню», на ПК — через меню в шапке.','/','Главная'),
    lesson('Транспорт и водители','В «Моём парке» управляйте грузовиками и назначением водителей.','Заполните карточки ТС и компанию до первого заказа.','/fleet','Мой автопарк'),
    lesson('Помощь в дороге','Для вызова выберите мастера, эвакуатор, СТО или консультацию.','Сначала проверяйте цену и условия. Переход к разделу ничего не заказывает.','/sos','SOS'),
    lesson('Заявки и контроль','В заявке видны статусы и история; запрос водителя может ждать согласования владельца.','Реальные действия выполняются только в самой заявке.','/orders','Заявки'),
    lesson('Эфир водителей','Здесь общаются только водители и владельцы автопарков, без рекламных предложений.','Мастера, СТО и эвакуаторщики не имеют доступа.','/air','Эфир'),
    lesson('Помощь и вопросы','Справка объясняет работу площадки, TrakBot помогает найти нужные разделы.','Этот обзор можно повторить из меню.','/help','Справка'),
  ]},
  driver:{label:'Водитель автопарка',lessons:[
    lesson('В дороге не один','TrakSOS помогает водителю получить помощь и следить за заявками.','Просмотр уроков не вызывает мастера.','/','Главная'),
    lesson('Закреплённая машина','Владелец автопарка назначает технику; водитель работает со своей машиной.','Если машины нет, обратитесь к владельцу.','/garage','Мой транспорт'),
    lesson('Запрос помощи','Через SOS можно выбрать мастера, эвакуатор, СТО или телефонную консультацию.','Стоимость и лимиты согласуйте до отправки заявки.','/sos','SOS'),
    lesson('Статусы заявки','Следите за принятием, выездом и завершением в разделе заявок.','Переписка по ремонту — в чате самой заявки.','/orders','Заявки'),
    lesson('Эфир водителей','Общайтесь с водителями и владельцами. Реклама запрещена.','Вызов @модератор или @админ направит к приватному обращению.','/air','Эфир'),
    lesson('Справка и TrakBot','Задавайте вопросы о работе площадки личному боту или читайте справку.','Обучение можно повторить через меню.','/help','Справка'),
  ]},
  master:{label:'Выездной мастер',lessons:[
    lesson('Рабочая смена','Получайте заявки и работайте со своими специализациями. В рабочей заявке «Фото» сохраняет доказательство ремонта, видимое только участникам заказа.','Урок не включает статус «На линии» и не загружает фотографии.','/work','Рабочий стол'),
    lesson('Профиль и график','Укажите специализации, часы работы и доступные на выезде услуги.','Не включайте статус доступности, если не готовы выехать.','/work/me','Профиль мастера'),
    lesson('Входящие заявки','До принятия проверьте задачу, адрес и предложенные условия.','Принятая заявка — реальная работа.','/work/jobs','Заявки'),
    lesson('Этапы выезда','Обновляйте статус по порядку: «Выехал → На месте → Завершить».','Не завершайте работы до выполнения.','/work','Рабочий стол'),
    lesson('Финансы и помощь','Проверяйте начисления и спорные операции в своём кабинете.','Точные комиссии смотрите в действующих условиях.','/work/me/money','Финансы'),
    lesson('Технические вопросы','TrakBot и справка помогут с навигацией и проверенными кодами.','Не полагайтесь на непроверенный диагноз без измерений.','/help','Справка'),
  ]},
  tow:{label:'Эвакуаторщик',lessons:[
    lesson('Ваша смена','Заявки на эвакуацию приходят в рабочий кабинет.','Просмотр уроков ничего не принимает.','/work','Рабочий стол'),
    lesson('Готовность к вызову','Настройте транспорт, график и доступность.','Отключайте линию, если не можете выехать.','/work/me','Профиль'),
    lesson('Принятие заказа','Проверьте маршрут, автомобиль и цену перевозки.','Вызов станет реальным только после принятия в рабочем кабинете.','/work/jobs','Заявки'),
    lesson('Завершение и финансы','Статусы меняйте по факту, выплаты смотрите отдельно.','Вопросы по оплате — через поддержку.','/work/me/money','Финансы'),
    lesson('Помощь','Читайте справку и обращайтесь в поддержку.','Эфир владельцев и водителей для исполнителей закрыт.','/help','Справка'),
  ]},
  service:{label:'СТО и рембаза',lessons:[
    lesson('Кабинет СТО','Принимайте записи, ведите ремонт и историю работ.','Урок не создаёт заказов.','/base','Рабочий стол'),
    lesson('Карточка и расписание','Укажите марки, услуги и реальные сроки приёма.','Клиент видит заявленные вами условия.','/base/me','Моя СТО'),
    lesson('Статусы ремонта','Отмечайте фактический прогресс и готовность автомобиля.','Не подтверждайте несделанные работы.','/base','Заявки'),
    lesson('Счета и поддержка','Проверяйте начисления и обращайтесь за помощью приватно.','В публичный эфир водителей СТО не входит.','/base/money','Финансы'),
  ]},
  courier:{label:'Курьер TrakSOS',lessons:[
    lesson('Только ваши доставки','Назначенные администратором посылки появятся на рабочем столе.','Не открывайте чужие заказы и не включайте линию, если не готовы к рейсу.','/courier','Главная'),
    lesson('Забрал, в пути, на месте','Обновляйте этапы только после фактического действия.','Пропуск или откат этапов недоступен.','/courier/jobs','Рейсы'),
    lesson('Шестизначный код','После прибытия получатель показывает код из истории покупок.','Код не выдаётся курьеру сервером. После пяти ошибок или истечения срока его восстановит администратор по записанной причине, не более трёх раз на доставку.','/courier/jobs','Доставка'),
    lesson('Покупатель подтверждает вручение','Проверенный код не завершает выдачу. Клиент нажимает подтверждение отдельно.','Не закрывайте заказ за клиента.','/courier/jobs','Рейсы'),
    lesson('Безопасная связь','При сложности обращайтесь через поддержку, личные номера не показываем.','Маршрут открывается без придуманной оценки времени.','/support','Поддержка'),
  ]},
  insurer:{label:'Страховой партнёр',lessons:[
    lesson('Страховой кабинет','Здесь обрабатываются заявки клиентов.','Уроки не создают полисов.','/insurance','Рабочий стол'),
    lesson('Полученная заявка','Проверьте сведения и при необходимости запросите уточнения.','Не публикуйте документы в общих чатах.','/insurance','Заявки'),
    lesson('Предложения','Передавайте клиенту проверенные варианты и цены.','Реальная оплата выполняется в отдельном процессе.','/insurance','Предложения'),
    lesson('Поддержка','Вопросы передавайте приватно сотрудникам.','Эфир водителей страховщикам недоступен.','/support','Поддержка'),
  ]},
  inspection:{label:'Оператор техосмотра',lessons:[
    lesson('Рабочий кабинет','Здесь отображаются задачи технического осмотра.','Урок не создаёт диагностических карт.','/inspections','Кабинет'),
    lesson('Этапы осмотра','Проверяйте сведения и фиксируйте реальные результаты в рабочем процессе.','Не выдавайте документы из демонстрационного примера.','/inspections','Очередь'),
    lesson('Помощь','За разъяснениями обращайтесь в поддержку.','Обучение всегда можно открыть снова.','/support','Поддержка'),
  ]},
  moderator:{label:'Модератор',lessons:[
    lesson('Очередь','Откройте рабочий стол и изучите поступившие обращения.','Урок не блокирует аккаунты.','/moderation','Модерация'),
    lesson('Проверка фактов','Решения принимайте на основании данных и регламента.','Любое ограничение должно быть обосновано.','/moderation','Очередь'),
    lesson('Эфир и поддержка','В эфире вы наблюдаете и скрываете нарушения, но не ведёте обычную переписку.','Личные сведения по жалобе — только в закрытом обращении.','/support','Обращения'),
    lesson('Справка','Обзор можно повторить когда угодно.','Не меняйте правила по одному сообщению без проверки.','/help','Справка'),
  ]},
  admin:{label:'Администратор',lessons:[
    lesson('Панель управления','Здесь контролируются основные процессы площадки.','Учебные шаги ничего не меняют.','/admin','Рабочий стол'),
    lesson('Люди и заявки','Ищите пользователей, организации и проблемы с заказами.','Сведения доступны по правам администратора.','/admin/section/people','Пользователи'),
    lesson('Модерация и обращения','Проверяйте эскалации и решения по жалобам.','Первый ответ обычно даёт модератор.','/admin/section/support','Обращения'),
    lesson('Курьерское вручение','Курьер получает заказ только после назначения, а получатель подтверждает вручение отдельно.','Восстановление кода — только после блокировки или истечения срока, с причиной и аудитом, максимум три раза. Код доступен лишь покупателю.','/admin','Админка'),
    lesson('Тестовые кабинеты','Администратор может изучить роли на вымышленных данных, без реальных списаний.','Тест-центр не предназначен для публичного доступа.','/admin/test-center','Тест-центр'),
    lesson('Настройки','Проверяйте условия и настройки прежде чем сохранять изменения.','Платежи и роли изменяются только при реальном подтверждении.','/admin/section/settings','Настройки'),
  ]},
};
function key(userId:string,role:Role):string {return 'traksos.learn.v2.'+userId+'.'+role;}
function marked(k:string):boolean {try{return localStorage.getItem(k)==='yes';}catch{return true;}}
function mark(k:string) {try{localStorage.setItem(k,'yes');}catch{/* private browser */}}

/** Small first-use invitation, never an interrupting modal or an automatic order. */
export function IntroInvitation({userId,mode,roles}:{userId:string;mode:string;roles:string[]}) {
  const role=learningRole(mode,roles);
  const k=key(userId,role);
  const [dismissed,setDismissed]=useState(()=>marked(k));
  if(dismissed)return null;
  const start=()=>setDismissed(true);
  const close=()=>{mark(k);setDismissed(true);};
  return <section className="card" aria-label="Знакомство с TrakSOS"
    style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',margin:'12px 12px 4px',padding:14}}>
    <div style={{flex:'1 1 220px'}}>
      <b>Впервые в TrakSOS?</b>
      <p className="note">Покажем кабинет «{courses[role].label}», затем вместе пройдём учебную заявку. Без настоящих заказов и платежей.</p>
    </div>
    <div className="row" style={{gap:8,flexWrap:'wrap'}}>
      <a className="btn small" href="#/learn" onClick={start}>Познакомиться</a>
      <button className="btn ghost small" type="button" onClick={close}>Не сейчас</button>
    </div>
  </section>;
}

/** Read-only lessons; action links open the real section but never submit changes. */
export function PlatformIntro() {
  const {me,mode}=useMe();
  const role=learningRole(mode,me?.roles??[]);
  const course=courses[role];
  const [index,setIndex]=useState(0);
  const [modeView,setModeView]=useState<'lessons'|'practice'>('lessons');
  const lesson=course.lessons[index];
  const finish=()=>{
    if(me)mark(key(me.id,role));
    location.hash='#/help';
  };
  return <main className="stack" style={{maxWidth:1000}}>
    <Back to="" />
    <div><span className="label">TRAKSOS · ЗНАКОМСТВО</span><h1>Как пользоваться TrakSOS</h1>
      <p className="sub">Обзор для роли «{course.label}». Просмотр ничего не оформляет и не оплачивает.</p></div>
    <nav className="training-intro-switch" aria-label="Этап обучения">
      <button type="button" className={modeView==='lessons'?'active':''}
        aria-current={modeView==='lessons'?'step':undefined} onClick={()=>setModeView('lessons')}>1. Знакомство с кабинетом</button>
      <button type="button" className={modeView==='practice'?'active':''}
        aria-current={modeView==='practice'?'step':undefined} onClick={()=>setModeView('practice')}>2. Учебная заявка</button>
    </nav>
    {modeView==='practice' ? <TrainingPractice role={role} onBack={()=>setModeView('lessons')} /> : <div className="card stack">
      <div className="between"><b>Шаг {index+1} из {course.lessons.length}</b><span className="note">Можно пропустить</span></div>
      <div role="progressbar" aria-label="Прогресс знакомства" aria-valuemin={0} aria-valuemax={course.lessons.length} aria-valuenow={index+1}
        style={{height:6,borderRadius:10,overflow:'hidden',background:'var(--line, #d5dce5)'}}>
        <div style={{height:'100%',width:(((index+1)/course.lessons.length)*100)+'%',background:'var(--accent, #2f84df)'}} />
      </div>
      <h2>{lesson.title}</h2>
      <p>{lesson.text}</p>
      <div className="note" style={{padding:12,borderRadius:10,border:'1px solid var(--line, #ddd)'}}>{lesson.tip}</div>
      <a className="btn ghost" href={'#'+lesson.path}>Открыть раздел: {lesson.link}</a>
      <div className="row" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
        <button className="btn ghost" disabled={index===0} type="button" onClick={()=>setIndex(i=>Math.max(0,i-1))}>Назад</button>
        {index+1===course.lessons.length
          ? <button className="btn" type="button" onClick={()=>setModeView('practice')}>К учебной заявке →</button>
          : <button className="btn" type="button" onClick={()=>setIndex(i=>Math.min(course.lessons.length-1,i+1))}>Дальше</button>}
      </div>
    </div>}
    <section className="card stack">
      <b>Энциклопедия сложных ситуаций</b>
      <p className="note">Отказ от оплаты, спор, невыезд мастера, проблемы со связью и другие форс-мажоры — отдельные курсы для вашей роли. Сами выбирайте действия и узнавайте последствия без риска для реальных заявок.</p>
      <a className="btn ghost" href="#/help">Открыть энциклопедию ситуаций</a>
    </section>
    <div className="row" style={{gap:12,flexWrap:'wrap'}}>
      <a href="#/help">Вся справка</a><a href="#/economics">Комиссии, баллы и рефералы</a><a href="#/trakbot">Спросить TrakBot</a>
      <button className="btn ghost small" type="button" onClick={finish}>Завершить знакомство</button>
    </div>
    <p className="note">Повторить знакомство можно в «Меню → Знакомство с TrakSOS».</p>
  </main>;
}
