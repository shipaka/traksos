// Персональные данные: что собираем и зачем, скачать, исправить, удалить аккаунт.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, getToken, post, del, fmtTime } from '../api.ts';
import { useAction, useMe, Back } from '../ui.tsx';

const WHAT: [string, string][] = [
  ['Телефон', 'SMS только при регистрации и восстановлении доступа; обычный вход по паролю и связь по заявке; исполнителям номер не показываем'],
  ['Имя, компания, ИНН, ЭДО', 'чтобы оформлять документы на компанию — если вы их указали'],
  ['Машины', 'марка, модель, год и госномер — чтобы подобрать мастера и узнать машину на месте'],
  ['Место', 'адрес или GPS только в заявке — чтобы мастер приехал; постоянно не отслеживаем'],
  ['Заявки, чат, отзывы', 'история работ, споры и оплаты — для расчётов и разбора споров'],
  ['Исполнителям: паспорт, ИНН, фото', 'добровольная проверка личности для отметки подтверждённого профиля; налоговые сведения — по отдельным основаниям'],
];

export function Privacy() {
  const {me}=useMe();
  const token=getToken();
  if(!me||!token)return null;
  return <PrivacyAccount key={JSON.stringify([me.id,token])} token={token} owner={me.id} isDriver={!!me.owner_id}/>;
}

function PrivacyAccount({token,owner,isDriver}:{token:string;owner:string;isDriver:boolean}){
  const alive=useRef(true),lock=useRef(false);
  useLayoutEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  const current=()=>alive.current&&getToken()===token;
  // Deletion status is sensitive account-specific data; never show a previous
  // account's result while the next session is loading.
  const [status, setStatus] = useState<{owner:string; value:any}|null>(null);
  const [loadError, setLoadError] = useState<{owner:string; message:string}|null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setLoadError(null);
    if (owner) {
      get('/api/me/privacy').then((value:any) => {
        if (!active||!current()) return;
        if (!value || !Number.isInteger(value.graceDays) || value.graceDays <= 0)
          throw Error('Invalid privacy status');
        setStatus({owner, value});
      }).catch(() => {
        if (active&&current()) setLoadError({owner, message:'Не удалось получить статус удаления аккаунта'});
      });
    }
    return () => { active = false; };
  }, [owner, token, retry]);
  const { run } = useAction();
  const [busy,setBusy]=useState(false);
  async function action(fn:()=>Promise<void>){
    if(lock.current||!current())return;
    lock.current=true;setBusy(true);
    try{await fn();}finally{lock.current=false;if(current())setBusy(false);}
  }
  async function download(){await action(async()=>{
    const data=await run(()=>get('/api/me/export'),'Файл готов');
    if(!data||!current())return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `traksos-moi-dannye-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });}
  const s = status?.owner === owner ? status.value : null;
  const statusError = loadError?.owner === owner ? loadError.message : null;
  const applyStatus = (value:any) => {
    if (current()) {
      setStatus({owner, value});
      setLoadError(null);
    }
  };
  return (
    <main>
      <Back to="profile" label="Профиль" />
      <div><h1>Персональные данные</h1><div className="sub">Что мы храним, зачем, и как это скачать, исправить или удалить.</div></div>
      <div className="card">
        <b>Что собираем и зачем</b>
        <dl className="kv">{WHAT.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        <span className="note">Рекламных рассылок не делаем. Данные не продаём и не передаём третьим лицам, кроме случаев, нужных для заявки (исполнитель видит машину и место) и по закону.</span>
        <a className="note" href="#/offer/privacy">Политика обработки персональных данных →</a>
      </div>
      <button className="btn ghost" disabled={busy} onClick={download}>Скачать мои данные</button>
      <span className="note">В файл входят до 500 последних уведомлений и до 500 собственных сообщений Эфира. В разделе exportLimits файла указано общее число, число включённых записей и признак неполной выгрузки.</span>
      <button className="btn ghost" onClick={() => { location.hash = '#/profile'; }}>Исправить данные — в профиле</button>
      <div className="card">
        <b>Удалить аккаунт и данные</b>
        {!s ? (
          <div className="empty" role={statusError ? 'alert' : 'status'}>
            {statusError ?? 'Загружаем статус удаления аккаунта…'}
            {statusError && <button type="button" className="btn ghost" onClick={() => setRetry(value => value + 1)}>Попробовать снова</button>}
          </div>
        ) : s.deleteRequestedAt ? (
          <>
            <span className="note" style={{ color: 'var(--warn)' }}>Запрос принят {fmtTime(s.deleteRequestedAt)}. Плановая дата — {fmtTime(s.deleteAt)}; если есть незавершённые заявки, заказы, ремонты или доставки, удаление откладывается до их закрытия. До этого можно передумать.</span>
            <button className="btn ghost" disabled={busy} onClick={()=>void action(async()=>{const r=await run(()=>del('/api/me/delete'),'Запрос на удаление отменён');if(r)applyStatus(r);})}>Не удалять</button>
          </>
        ) : (
          <>
            <span className="note">Через {s.graceDays} дней аккаунт будет закрыт, если завершены все действующие заявки, заказы, ремонты, страхование и доставки; иначе удаление будет отложено до их закрытия. Персональные поля профиля обезличиваются; часть данных о выполненных заявках и расчётах может сохраняться в установленных законом пределах; сведения о технике и истории заказов могут быть связаны с другими участниками.</span>
            {isDriver && <span className="note">Вы водитель: машины и заказы принадлежат владельцу и останутся у него.</span>}
            <button className="btn bad" disabled={busy} onClick={()=>void action(async()=>{
              if (!confirm('Первое подтверждение: вы хотите закрыть аккаунт TrakSOS и отправить запрос на удаление данных?')) return;
              if (!confirm('Второе подтверждение: вы действительно уверены? Действующие заявки необходимо завершить; после подтверждения начнётся установленная законом процедура удаления.')) return;
              if(!current())return;
              const r = await run(() => post('/api/me/delete'), 'Запрос на удаление принят — срок указан в разделе'); if (r) applyStatus(r);
            })}>Удалить аккаунт</button>
          </>
        )}
      </div>
    </main>
  );
}
