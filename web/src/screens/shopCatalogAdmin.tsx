// Catalog ingestion is separate from sellable products: never invent prices.
import { useEffect, useRef, useState } from 'react';
import { get, post, getToken } from '../api.ts';
import { useLoad, useAction, useMe, Loading } from '../ui.tsx';
import { parseCatalogCsv, type CatalogCsvRow } from '../catalogCsv.ts';

type CatalogPreview = { newRows: number; existingRows: number; processed: number; revision: number; actorId: string; token: string };
export function AdminShopCatalog() {
  const { me } = useMe();
  const config = useLoad(() => get('/api/shop?light=1'), [me?.id]);
  const stats = useLoad(() => get('/api/admin/shop/catalog/stats'), [me?.id]);
  const [sourceNote, setSourceNote] = useState('');
  const [rights, setRights] = useState(false);
  const [rows, setRows] = useState<CatalogCsvRow[]>([]);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [progress, setProgress] = useState('');
  const [revision, setRevision] = useState(0);
  const { busy, run } = useAction();
  const fileReadId = useRef(0);
  const formRevision = useRef(0);
  const requestBusy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUserId = useRef(me?.id);
  currentUserId.current = me?.id;
  const invalidate = () => {
    ++formRevision.current;
    setPreview(null);
    setProgress('');
  };
  const sameSession = (actor: string, token: string, rev: number) =>
    currentUserId.current === actor && getToken() === token && formRevision.current === rev;
  useEffect(() => {
    // Do not reuse another administrator's CSV, provenance or approval.
    ++fileReadId.current;
    invalidate();
    setRows([]); setRights(false); setSourceNote(''); setFileError('');
    if (inputRef.current) inputRef.current.value = '';
  }, [me?.id]);
  useEffect(() => {
    const reset = () => {
      ++fileReadId.current;
      invalidate();
      setRows([]); setRights(false); setSourceNote(''); setFileError('');
      if (inputRef.current) inputRef.current.value = '';
    };
    window.addEventListener('traksos-auth-external-change', reset);
    window.addEventListener('traksos-auth-expired', reset);
    return () => {
      window.removeEventListener('traksos-auth-external-change', reset);
      window.removeEventListener('traksos-auth-expired', reset);
    };
  }, []);

  const [state, setState] = useState('pending');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(query); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [query]);
  const list = useLoad(() => get(
    `/api/admin/shop/catalog?state=${encodeURIComponent(state)}&q=${encodeURIComponent(debounced)}&page=${page}`
  ), [state, debounced, page, revision, me?.id]);

  async function loadFile(file: File | undefined) {
    const readId = ++fileReadId.current;
    invalidate(); setFileError(''); setRows([]);
    if (!file) return;
    const actor=me?.id, token=getToken(), rev=formRevision.current;
    try {
      if (!actor || !token) throw new Error('Войдите заново перед загрузкой справочника');
      if (file.size > 2_000_000) throw new Error('Выберите CSV меньше 2 МБ.');
      const source=await file.text();
      if (readId!==fileReadId.current || !sameSession(actor,token,rev)) return;
      const parsed=parseCatalogCsv(source,config.data?.categories ?? {});
      if (readId!==fileReadId.current || !sameSession(actor,token,rev)) return;
      setRows(parsed);
    } catch (error) {
      if (readId===fileReadId.current && formRevision.current===rev)
        setFileError(error instanceof Error ? error.message : 'Не удалось прочитать CSV');
    }
  }

  const valid = !!me?.id && !!rows.length && rights && sourceNote.trim().length >= 3;
  const approvedPreview=!!preview && valid && preview.revision===formRevision.current &&
    preview.actorId===me?.id && preview.token===getToken() &&
    preview.processed===rows.length;

  async function check() {
    if(requestBusy.current || !valid || !me?.id || !getToken()) return;
    requestBusy.current=true;
    const actor=me.id, token=getToken()!, revision=formRevision.current;
    const snapshot=rows.map(row=>({...row}));
    const provenance=sourceNote.trim();
    setPreview(null);
    setProgress('');
    try {
      const result=await run(async()=>{
        let newRows=0, existingRows=0;
        for(let i=0;i<snapshot.length;i+=150){
          if(!sameSession(actor,token,revision))
            throw new Error('Аккаунт или файл изменён. Проверьте сведения заново.');
          const chunk=snapshot.slice(i,i+150);
          const answer=await post('/api/admin/shop/catalog/import',{
            rows:chunk,sourceNote:provenance,rightsConfirmed:true,dryRun:true,
          });
          if(!sameSession(actor,token,revision))
            throw new Error('Аккаунт или файл изменён. Проверьте сведения заново.');
          newRows+=answer.newRows;
          existingRows+=answer.existingRows;
          setProgress('Проверено '+Math.min(i+chunk.length,snapshot.length)+
            ' из '+snapshot.length);
        }
        return {newRows,existingRows,processed:snapshot.length};
      },null);
      if(result && sameSession(actor,token,revision))
        setPreview({...result,revision,actorId:actor,token});
    } finally {
      requestBusy.current=false;
    }
  }

  async function importAll() {
    if(requestBusy.current || !approvedPreview || !me?.id || !getToken()) return;
    requestBusy.current=true;
    const actor=me.id, token=getToken()!, revision=formRevision.current;
    const provenance=sourceNote.trim(),snapshot=rows.map(row=>({...row}));
    let confirmed=0;
    setProgress('Начинаем загрузку. Не закрывайте раздел до подтверждения последней партии.');
    try {
      const success=await run(async()=>{
        for(let i=0;i<snapshot.length;i+=150){
          if(!sameSession(actor,token,revision))
            throw new Error('Аккаунт или файл изменён. Загрузка остановлена.');
          const chunk=snapshot.slice(i,i+150);
          // Each batch is an atomic server transaction. Unknown network
          // outcomes must NEVER be represented as completed imports.
          const answer=await post('/api/admin/shop/catalog/import',{
            rows:chunk,sourceNote:provenance,rightsConfirmed:true,dryRun:false,
          });
          if(!sameSession(actor,token,revision))
            throw new Error('Аккаунт или файл изменён. Загрузка остановлена.');
          confirmed+=answer.processed;
          setProgress('Сервер подтвердил '+confirmed+' из '+snapshot.length+
            '. Эти позиции отправлены только на ручную проверку.');
        }
        return true;
      },null);
      if(!sameSession(actor,token,revision))return;
      if(success){
        setPreview(null);setRows([]);setProgress('');
        ++formRevision.current;
        if(inputRef.current)inputRef.current.value='';
        stats.reload();setRevision(n=>n+1);
      }else{
        setPreview(null);
        setProgress('Подтверждено сервером '+confirmed+' из '+snapshot.length+
          '. Ответ по последней партии мог потеряться. Проверьте файл повторно и загрузите остаток; одинаковые записи не размножаются.');
      }
    } finally {
      requestBusy.current=false;
    }
  }

  const reviewEntry=async(item:any, reviewed:boolean)=>{
    if(requestBusy.current || busy || !me?.id)return;
    if(reviewed && !window.confirm('Вы проверили номер детали и право использовать его описание? Подтвердить публикацию справочной записи?'))return;
    requestBusy.current=true;
    const actor=me.id,token=getToken();
    try {
      const done=await run(()=>post('/api/admin/shop/catalog/'+encodeURIComponent(item.id)+'/review',{
        reviewed,expectedUpdatedAt:item.updatedAt,
        expectedName:item.name,expectedSourceNote:item.sourceNote,
        expectedBrand:item.brand,expectedArticle:item.article,
        expectedCategory:item.category,expectedSearchTerms:item.searchTerms,
      }),reviewed?'Позиция проверена':'Позиция возвращена на проверку');
      if(actor===currentUserId.current && token===getToken()){
        // Also on a version-conflict refresh the actual row before retrying.
        await Promise.all([stats.reload(),list.reload()]);
      }
      return done;
    } finally {
      requestBusy.current=false;
    }
  };

  if (!config.data) return <Loading error={config.error} />;
  return <div className="stack">
    <div className="card stack">
      <b>Массовая загрузка справочника запчастей</b>
      <span className="note">Здесь готовим названия, бренды, номера и категории грузовиков и прицепов. Это не товары для продажи: без цен и наличия. Магазин остаётся закрытым.</span>
      <div className="row">
        <span className="pill">Всего: {stats.data?.total ?? '…'}</span>
        <span className="pill">На проверке: {stats.data?.pending ?? '…'}</span>
        <span className="pill good">Проверено: {stats.data?.approved ?? '…'}</span>
      </div>
      <span className="note">Формат CSV (разделитель «;», запятая или табуляция). Колонки: <b>бренд;артикул;название;категория;синонимы</b>. Категория — код или название раздела TrakSOS. Поддерживаются русские заголовки и кавычки.</span>
      <label className="field" style={{ display: 'block' }}>
        Выберите файл CSV
        <input ref={inputRef} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
          disabled={busy} onChange={(e) => void loadFile(e.target.files?.[0])}
          style={{ display: 'block', marginTop: 8, maxWidth: '100%' }} />
      </label>
      <label className="stack" style={{ gap: 5 }}>
        <b>Откуда получены данные?</b>
        <input className="field" maxLength={300} disabled={busy} value={sourceNote} onChange={(e) => { invalidate(); setSourceNote(e.target.value); }}
          placeholder="Название каталога, источник и разрешение на использование" />
      </label>
      <label className="agree">
        <input type="checkbox" disabled={busy} checked={rights} onChange={(e) => { invalidate(); setRights(e.target.checked); }}/>
        <span>Подтверждаю, что имею право использовать и импортировать эти данные в TrakSOS.</span>
      </label>
      {fileError && <div className="banner warn">{fileError}</div>}
      {!!rows.length && <>
        <span className="note">Прочитано {rows.length} позиций. Первые строки:</span>
        {rows.slice(0, 4).map((r, i) => <div key={i} className="card" style={{ padding: 10 }}>
          <b>{r.brand} · {r.article}</b>
          <span className="note">{r.name} · {config.data.categories[r.category]}</span>
        </div>)}
      </>}
      {progress && <span className="note" role="status">{progress}</span>}
      {approvedPreview && preview && <div className="banner">
        Предварительная проверка: {preview.processed} позиций · новых: {preview.newRows} · уже известных: {preview.existingRows}. Ничего не опубликовано. Если другой администратор изменит каталог, итоговые числа могут отличаться.
      </div>}
      <div className="row">
        <button className="btn ghost" disabled={busy || !valid} onClick={() => void check()}>
          {busy ? 'Обрабатываем…' : 'Проверить перед загрузкой'}
        </button>
        <button className="btn" disabled={busy || !approvedPreview}
          onClick={() => void importAll()}>Загрузить на проверку</button>
      </div>
      <span className="note">За один запрос передаётся максимум 150 деталей. При обрыве связи прогресс показывает только подтверждённые сервером партии; повторно проверьте исходный CSV, затем загрузите снова. Записи остаются на ручной модерации, а не в продаже.</span>
    </div>
    <div className="card stack">
      <b>Проверка импортированных артикулов</b>
      <div className="scroll-x">
        {([['pending', 'На проверке'], ['approved', 'Подтверждены'], ['all', 'Все']] as const).map(([k, label]) =>
          <button key={k} className="chip" aria-pressed={state === k} onClick={() => { setState(k); setPage(0); }}>{label}</button>)}
      </div>
      <input className="field" placeholder="Искать бренд, номер или название" value={query} onChange={(e) => setQuery(e.target.value)}/>
      {list.error ? <div className="card stack" role="alert">
        <span>Не удалось обновить список артикулов. Не подтверждайте устаревшие сведения.</span>
        <button type="button" className="btn ghost" disabled={busy}
          onClick={() => void list.reload()}>Повторить загрузку</button>
      </div> : !list.data ? <Loading error={list.error} /> : <>
        {!list.data.items.length && <div className="empty">Подходящих записей нет</div>}
        {list.data.items.map((p: any) => <div key={p.id} className="card stack" style={{ gap: 8 }}>
          <b>{p.name}</b>
          <span className="note">{p.brand} · {p.article} · {config.data.categories[p.category]}</span>
          <span className="note">Источник: {p.sourceNote}</span>
          <div className="row">
            <span className={p.reviewed ? 'pill good' : 'pill'}>{p.reviewed ? 'Подтверждена' : 'Требует проверки'}</span>
            <button className="btn ghost small" disabled={busy}
              onClick={() => void reviewEntry(p, !p.reviewed)}>
              {p.reviewed ? 'Отозвать проверку' : 'Подтвердить запись'}
            </button>
          </div>
        </div>)}
        {list.data.total > list.data.limit && <div className="between">
          <button className="btn ghost small" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Назад</button>
          <span className="note">{page + 1} из {Math.ceil(list.data.total / list.data.limit)}</span>
          <button className="btn ghost small" disabled={(page + 1) * list.data.limit >= list.data.total}
            onClick={() => setPage((n) => n + 1)}>Дальше</button>
        </div>}
      </>}
    </div>
  </div>;
}
