import { useState } from 'react';
import { customerStageFor, nextPracticeStage, practiceKindFor, practiceStages, type PracticeInput } from './trainingDemoModel.ts';

const services = ['Выездной мастер', 'Эвакуатор', 'СТО', 'Консультация по телефону'] as const;

/**
 * A miniature training order. Its complete state stays in React memory.
 * There are deliberately NO app API, web socket or native bridge imports.
 */
export function TrainingPractice({role,onBack}:{role:string;onBack:()=>void}) {
  const kind=practiceKindFor(role);
  const stages=practiceStages[kind];
  const [index,setIndex]=useState(0);
  const [vehicle,setVehicle]=useState('Scania R520 · учебный автомобиль');
  const [service,setService]=useState<string>('Выездной мастер');
  const [problem,setProblem]=useState('');
  const [error,setError]=useState('');
  const [chatOpen,setChatOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(true);
  const stage=kind==='customer'?customerStageFor(service,index):stages[index];
  const isCustomer=kind==='customer';
  const isPerformer=kind==='performer';
  const orderExample=isCustomer||isPerformer||kind==='service';
  const input:PracticeInput={vehicle,problem,service};
  const advance=()=>{
    const next=nextPracticeStage(kind,index,input);
    if(next===index) {
      setError('Для учебной заявки укажите автомобиль и опишите проблему хотя бы в пяти символах.');
      return;
    }
    setIndex(next);
    setError('');
    setChatOpen(false);
    if(next===0) {
      setProblem('');setService('Выездной мастер');setVehicle('Scania R520 · учебный автомобиль');
    }
  };
  const caseTitle=kind==='staff'?'Вопрос о сроке ответа':
    kind==='insurance'?'Страхование грузового автомобиля':
    kind==='service'?'Проверить электрику и зарядку':
    isPerformer&&role==='tow'?'Учебная эвакуация с трассы':'Не заводится грузовик, требуется диагностика';
  return <section className="training-practice stack" aria-label="Практическая часть обучения">
    <div className="training-practice-top">
      <div><span className="label">TRAKSOS · БЕЗОПАСНЫЙ ТРЕНАЖЁР</span>
        <h2>Пройдём одну тестовую заявку</h2>
        <p className="note">Нажимайте кнопки сами. После каждого действия объясним, что произошло и где это находится в настоящем кабинете.</p>
      </div>
      <button className="btn ghost small" type="button" onClick={onBack}>← К знакомству</button>
    </div>
    <div className="training-practice-alert" role="note">
      <strong>ДЕМОНСТРАЦИЯ · НЕ НАСТОЯЩАЯ ЗАЯВКА</strong>
      <span>Нет обращения к серверу. Не вызываются мастера, не отправляются SMS, не меняются реальные статусы и не списываются деньги.</span>
    </div>
    <div className="training-demo-overview" aria-label="Прогресс учебной заявки">
      <span>Шаг {index+1} из {stages.length}</span>
      <span className="training-demo-status">{stage.status} · демо</span>
    </div>
    <div className="training-demo-progress" role="progressbar" aria-label="Прогресс учебной заявки"
      aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={index+1}>
      <span style={{width:(((index+1)/stages.length)*100)+'%'}} />
    </div>
    <div className="training-demo-workspace">
      <div className="training-demo-card stack">
        <div className="row" style={{alignItems:'center',flexWrap:'wrap'}}>
          <span className="pill accent">УЧЕБНАЯ ЗАЯВКА · DEMO-001</span>
          <span className="note">Все данные вымышленные</span>
        </div>
        <h3>{stage.title}</h3>
        <p>{stage.explanation}</p>

        {isCustomer && index===0 && <fieldset className="training-demo-fieldset">
          <legend>Кого будем вызывать?</legend>
          <div className="training-demo-options">
            {services.map(value=><label key={value} className={'training-demo-option'+(value===service?' selected':'')}>
              <input type="radio" name="demo-service" checked={value===service} onChange={()=>setService(value)} />
              <span>{value}</span>
            </label>)}
          </div>
        </fieldset>}
        {isCustomer && index===1 && <div className="stack">
          <label className="stack" htmlFor="demo-vehicle"><b>Автомобиль</b>
            <select id="demo-vehicle" className="field" value={vehicle} onChange={e=>setVehicle(e.target.value)}>
              <option value="Scania R520 · учебный автомобиль">Scania R520 · учебный</option>
              <option value="Iveco Stralis · учебный автомобиль">Iveco Stralis · учебный</option>
              <option value="Volvo FH · учебный автомобиль">Volvo FH · учебный</option>
            </select>
          </label>
          <label className="stack" htmlFor="demo-problem"><b>Что случилось?</b>
            <textarea id="demo-problem" className="field" rows={3} maxLength={220}
              placeholder="Например: не запускается двигатель, нужен выездной мастер"
              value={problem} onChange={e=>{setProblem(e.target.value);setError('');}} />
          </label>
          <p className="note">Это тренировочный ввод. Не пишите здесь свои номера телефонов, адреса или настоящие данные транспорта.</p>
        </div>}
        {orderExample && (isCustomer?index>=2:true) && <section className="training-demo-order" aria-label="Карточка учебной заявки">
          <div className="between" style={{gap:12,flexWrap:'wrap'}}>
            <strong>Грузовик: {isCustomer?vehicle:'Scania R520 · учебный'}</strong>
            <span className="training-demo-status">{stage.status}</span>
          </div>
          <div className="training-demo-details">
            <div><span>Услуга</span><b>{isCustomer?service:isPerformer&&role==='tow'?'Эвакуатор':kind==='service'?'Ремонт в СТО':'Выездной мастер'}</b></div>
            <div><span>Проблема</span><b>{isCustomer?(problem.trim()||'Только демонстрация'):caseTitle}</b></div>
            <div><span>Место</span><b>Учебная стоянка · адрес не передаётся</b></div>
            <div><span>Стоимость</span><b>Не рассчитывается в тренажёре</b></div>
          </div>
          {isCustomer && index>=4 && index<=7 && <div className="training-demo-chat">
            <button className="btn ghost small" type="button" aria-expanded={chatOpen}
              onClick={()=>setChatOpen(v=>!v)}>
              {chatOpen?'Скрыть':'Показать'} пример чата заявки
            </button>
            {chatOpen && <div className="training-demo-chat-bubble">
              <b>Исполнитель · учебное сообщение</b>
              <p>{service==='Консультация по телефону'
                ? 'Здравствуйте! Расскажите, что проверяли до обращения, и есть ли диагностический код.'
                : service==='СТО'
                ? 'Запись вижу. Уточните, пожалуйста, удобно ли подъехать к станции в назначенное время.'
                : 'Здравствуйте! Заявку вижу. Уточните, пожалуйста, удобный подъезд к грузовику.'}</p>
              <small>Настоящее сообщение не отправлено. Ответы по заказу пишут в чате конкретной заявки.</small>
            </div>}
          </div>}
        </section>}
        {!orderExample && <section className="training-demo-order" aria-label="Учебное обращение">
          <div className="between" style={{gap:8,flexWrap:'wrap'}}>
            <b>DEMO-001 · {caseTitle}</b><span className="training-demo-status">{stage.status}</span>
          </div>
          <p className="note">Вымышленная карточка для знакомства с этапами работы. Ни один клиент и сотрудник не получил сообщения.</p>
        </section>}

        <div className="training-demo-navigator">
          <button type="button" className="btn ghost" disabled={index===0}
            onClick={()=>{setIndex(v=>Math.max(v-1,0));setError('');setChatOpen(false);}}>← Предыдущий шаг</button>
          <button className="btn" type="button" onClick={advance}>{stage.button}</button>
        </div>
        {error && <p role="alert" className="note">{error}</p>}
        {index===stages.length-1 && <div className="training-demo-complete">
          <strong>Готово — вы прошли учебный сценарий.</strong>
          <span>Никаких настоящих заявок не создавалось. Теперь можно возвращаться к урокам или пройти пример ещё раз.</span>
        </div>}
      </div>
      <aside className="training-demo-hints stack" aria-label="Подсказки к шагу">
        <div className="card stack">
          <div className="between" style={{gap:6}}>
            <b>Что и для чего?</b>
            <button className="btn ghost small" type="button" aria-expanded={helpOpen}
              onClick={()=>setHelpOpen(v=>!v)}>{helpOpen?'Свернуть':'Подсказка'}</button>
          </div>
          {helpOpen && <>
            <div><span className="label">Где это в кабинете</span><p>{stage.where}</p></div>
            <div><span className="label">Зачем нужен этот шаг</span><p>{stage.why}</p></div>
          </>}
        </div>
        <div className="card stack">
          <b>Где искать подсказки?</b>
          <p className="note"><b>Меню → Знакомство с TrakSOS</b> — повторить обучение. <b>«?» / Справка</b> — инструкции, условия и поиск по темам.</p>
          <p className="note"><b>TrakBot</b> — личный помощник: объясняет, где найти функцию. <b>Поддержка</b> — вопросы по конкретному заказу и спорные случаи.</p>
          <a href="#/help">Открыть справку</a>
          <a href="#/trakbot">Спросить TrakBot</a>
          <a href="#/support/new">Личная поддержка</a>
        </div>
      </aside>
    </div>
  </section>;
}
