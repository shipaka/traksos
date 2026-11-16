import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';
import {TechReferenceDetail,type OpenTechReference} from './techReferenceShelf.tsx';

type AdminSource=OpenTechReference&{
  active:boolean;technical_review_note:string|null;technically_reviewed_at:string|null
};
type AdminResponse={sources:AdminSource[];requiresDocumentedHumanReview:boolean};

/** Review record metadata and rights only, never pull or mirror OEM files. */
export function AdminTechReferences(){
  const list=useLoad<AdminResponse>(()=>get('/api/admin/community/knowledge/references'),[]);
  const [selected,setSelected]=useState<string|null>(null);
  const [note,setNote]=useState('');
  const {busy,run}=useAction();
  const row=list.data?.sources.find(s=>s.id===selected);
  const change=async(status:'illustrative'|'portal_link'|'expert_approved'|'withdrawn')=>{
    if(!row||note.trim().length<12)return;
    const saved=await run(()=>post('/api/admin/community/knowledge/references/'+row.id+'/review',{
      status,note:note.trim()
    }),'Решение внесено в журнал');
    if(saved){setNote('');await list.reload()}
  };
  return <section className="tech-section">
    <h2>Открытые источники — контроль прав и актуальности</h2>
    <p className="note">
      Здесь отображаются все записи, включая снятые с выдачи. Удаление источника
      не удаляет оригинал с внешнего сайта. Проверка лицензии и технической
      применимости — разные действия. Нельзя подтверждать заводскую схему
      только по красивой иллюстрации.
    </p>
    {list.error&&<p role="alert">{list.error} <button type="button" onClick={list.reload}>Повторить</button></p>}
    <div className="tech-result-layout">
      <div className="tech-list">
        {list.data?.sources.map(source=><button key={source.id} type="button"
          aria-current={selected===source.id?'page':undefined}
          onClick={()=>{setSelected(source.id);setNote('')}}>
          <strong>{source.title}</strong>
          <small>{source.make??'Общее'} · {source.subsystem}</small>
          <small>{source.active?'Доступно':'Снято'} · {source.technical_status}</small>
        </button>)}
      </div>
      {row&&<article className="tech-review">
        <h3>{row.title}</h3>
        <p>Источник: {row.attribution_author??'см. оригинал'}</p>
        <p>Лицензия: {row.license_code}</p>
        <p>Категория: {row.source_kind}</p>
        <a href={row.source_url} target="_blank" rel="noopener noreferrer">Проверить оригинал</a>
        {row.license_url&&<a href={row.license_url} target="_blank" rel="noopener noreferrer">
          Условия лицензии</a>}
        {row.technical_review_note&&<p className="note">
          Последняя запись проверки: {row.technical_review_note}
          {row.technically_reviewed_at?' · '+fmtTime(row.technically_reviewed_at):''}
        </p>}
        <TechReferenceDetail reference={row}/>
        <label>Обязательная запись основания решения
          <textarea className="field" rows={3} minLength={12} maxLength={1000}
            value={note} onChange={e=>setNote(e.target.value)}
            placeholder="Почему снимаем, возвращаем или кто технически проверил и на каком основании?"/>
        </label>
        <div className="tech-actions">
          {row.active&&<button className="btn ghost" type="button"
            disabled={busy||note.trim().length<12} onClick={()=>void change('withdrawn')}>
            Снять источник с выдачи
          </button>}
          {!row.active&&<button className="btn" type="button"
            disabled={busy||note.trim().length<12} onClick={()=>void change(
              row.source_kind==='manufacturer_portal'?'portal_link':'illustrative'
            )}>Вернуть как справочный источник</button>}
          {row.active&&row.source_kind!=='manufacturer_portal'&&
            row.technical_status!=='expert_approved'&&<button className="btn" type="button"
              disabled={busy||note.trim().length<12} onClick={()=>void change('expert_approved')}>
              Записать подтверждение технической проверки
            </button>}
        </div>
      </article>}
    </div>
  </section>;
}
