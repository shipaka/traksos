import './ecuDiscovery.css';

type EcuDiscoveryProps={place:'home'|'sos'};

/** The client-facing ECU service is a real route, not a demo contractor.
 * It is intentionally separate from the three top-level SOS directions
 * and from the four core service/photo cards.
 */
export function EcuDiscovery({place}:EcuDiscoveryProps){
  const sos=place==='sos';
  return <section className={'ecu-discovery ecu-discovery--'+place}
    aria-label="Специалист по электронным блокам управления">
    <div className="ecu-discovery__mark" aria-hidden="true">
      <svg viewBox="0 0 80 80" width="52" height="52" fill="none">
        <rect x="17" y="17" width="46" height="46" rx="9" stroke="currentColor" strokeWidth="3"/>
        <rect x="28" y="28" width="24" height="24" rx="3" stroke="currentColor" strokeWidth="2"/>
        {Array.from({length:4},(_,i)=><g key={i} stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d={`M${27+i*9} 9v8 M${27+i*9} 63v8`}/>
          <path d={`M9 ${27+i*9}h8 M63 ${27+i*9}h8`}/>
        </g>)}
        <path d="M34 42l6-9v7h6l-6 9v-7h-6z" fill="currentColor"/>
      </svg>
    </div>
    <div className="ecu-discovery__copy">
      <span className="ecu-discovery__label">{sos?'ОТДЕЛЬНАЯ СПЕЦИАЛИЗАЦИЯ':'ДОПОЛНИТЕЛЬНАЯ ВОЗМОЖНОСТЬ TRACKSOS'}</span>
      <h2>Специалист по ЭБУ</h2>
      <p>Диагностика, программирование и восстановление электронных блоков грузовиков.
        Не заменяет обычного диагноста: здесь работают с самим блоком управления.</p>
      {sos&&<span className="ecu-discovery__hint">Нужен после другого мастера?
        Откройте его заявку: подключение отдельного этапа оформляет только клиент.</span>}
    </div>
    <a className="ecu-discovery__action" href="#/new/ecu">
      {sos?'Выбрать специалиста':'Заявка специалисту'} <span aria-hidden="true">›</span>
    </a>
  </section>;
}
