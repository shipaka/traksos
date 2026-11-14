import {useState} from 'react';
import {PerformerTrainingCabinet} from './performerTrainingCabinet.tsx';

// Combined role retains both complete training workspaces, not a four-tab mock.
export function MasterServiceTrainingCabinet(){
  const [workspace,setWorkspace]=useState<'master'|'service'>('master');
  return <div className="stack" aria-label="Тестовый кабинет: Мастер и своя СТО">
    <div className="service-preview-admin-bar" role="banner" aria-label="Переключатель совмещённой роли">
      <div className="service-preview-admin-identity"><strong>TRACKSOS · АДМИНИСТРАТОР</strong><span>Совмещённая роль: мастер и своя СТО · только демонстрация</span></div>
      <div className="service-preview-admin-actions">
        <button className="btn small" type="button" aria-pressed={workspace==='master'} onClick={()=>setWorkspace('master')}>Выездной мастер</button>
        <button className="btn small ghost" type="button" aria-pressed={workspace==='service'} onClick={()=>setWorkspace('service')}>Моя СТО</button>
        <a href="#/admin/test-center">← Все кабинеты</a>
      </div>
    </div>
    {workspace==='master'?<PerformerTrainingCabinet/>:<main className="sandbox-root sandbox-cabinet stack">
      <section className="sandbox-hero"><span className="sandbox-eyebrow">TRACKSOS · МОЯ СТО</span><h1>Ремонтная база и выездная работа</h1><p>Для проверки полноценного интерфейса СТО используется отдельный изолированный стенд TrackSOS.</p></section>
      <section className="card stack"><h2>Рабочее пространство СТО</h2><p>В стенде доступны заявки ремонтной базы, этапы обслуживания и взаимодействие с клиентом без изменения реальных заказов.</p>
        <a className="btn" href="#/admin/test-center/service">Открыть полный тестовый кабинет СТО</a>
        <button className="btn ghost" type="button" onClick={()=>setWorkspace('master')}>Вернуться к выездным вызовам</button>
      </section>
    </main>}
  </div>;
}
