// Catalog ingestion is separate from sellable products: never invent prices.
import { useEffect, useState } from 'react';
import { get, post } from '../api.ts';
import { useLoad, useAction, Loading } from '../ui.tsx';
import { parseCatalogCsv, type CatalogCsvRow } from '../catalogCsv.ts';

export function AdminShopCatalog() {
  const config = useLoad(() => get('/api/shop?light=1'), []);
  const stats = useLoad(() => get('/api/admin/shop/catalog/stats'), []);
  const [sourceNote, setSourceNote] = useState('');
  const [rights, setRights] = useState(false);
  const [rows, setRows] = useState<CatalogCsvRow[]>([]);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<{ newRows: number; existingRows: number; processed: number } | null>(null);
  const [progress, setProgress] = useState('');
  const [revision, setRevision] = useState(0);
  const { busy, run } = useAction();

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
  ), [state, debounced, page, revision]);

  async function loadFile(file: File | undefined) {
    setPreview(null); setProgress(''); setFileError(''); setRows([]);
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Выберите CSV меньше 2 МБ.');
      const parsed = parseCatalogCsv(await file.text(), config.data?.categories ?? {});
      setRows(parsed);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Не удалось прочитать CSV');
    }
  }

  const valid = !!rows.length && rights && sourceNote.trim().length >= 3;
  async function check() {
    const answer = await run(async () => {
      let newRows = 0, existingRows = 0;
      for (let i = 0; i < rows.length; i += 150) {
        const chunk = rows.slice(i, i + 150);
        const result = await post('/api/admin/shop/catalog/import', {
          rows: chunk, sourceNote, rightsConfirmed: true, dryRun: true,
        });
        newRows += result.newRows;
        existingRows += result.existingRows;
        setProgress(`Проверено ${Math.min(i + chunk.length, rows.length)} из ${rows.length}`);
      }
      return { newRows, existingRows, processed: rows.length };
    }, null);
    if (answer) setPreview(answer);
  }

  async function importAll() {
    const ok = await run(async () => {
      for (let i = 0; i < rows.length; i += 150) {
        const chunk = rows.slice(i, i + 150);
        await post('/api/admin/shop/catalog/import', {
          rows: chunk, sourceNote, rightsConfirmed: true, dryRun: false,
        });
        setProgress(`Загружено ${Math.min(i + chunk.length, rows.length)} из ${rows.length}`);
      }
      return true;
    }, 'Справочник загружен на проверку');
    if (ok) {
      setPreview(null); setRows([]); setProgress('');
      stats.reload(); setRevision((n) => n + 1);
    }
  }

  const reviewEntry = async (id: string, reviewed: boolean) => {
    if (reviewed && !window.confirm('Вы проверили номер детали и право использовать его описание? Подтвердить публикацию справочной записи?')) return;
    const done = await run(() => post(`/api/admin/shop/catalog/${id}/review`, { reviewed }),
      reviewed ? 'Позиция проверена' : 'Позиция возвращена на проверку');
    if (done) { stats.reload(); list.reload(); }
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
      <span className="note">Формат CSV (разделитель «;», запятая или табуляция). Колонки: <b>бренд;артикул;название;категория;синонимы</b>. Категория — код или название раздела TrackSOS. Поддерживаются русские заголовки и кавычки.</span>
      <label className="field" style={{ display: 'block' }}>
        Выберите файл CSV
        <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
          onChange={(e) => void loadFile(e.target.files?.[0])} style={{ display: 'block', marginTop: 8, maxWidth: '100%' }} />
      </label>
      <label className="stack" style={{ gap: 5 }}>
        <b>Откуда получены данные?</b>
        <input className="field" maxLength={300} value={sourceNote} onChange={(e) => { setSourceNote(e.target.value); setPreview(null); }}
          placeholder="Название каталога, источник и разрешение на использование" />
      </label>
      <label className="agree">
        <input type="checkbox" checked={rights} onChange={(e) => { setRights(e.target.checked); setPreview(null); }}/>
        <span>Подтверждаю, что имею право использовать и импортировать эти данные в TrackSOS.</span>
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
      {preview && <div className="banner">
        Проверка файла: {preview.processed} позиций · новых: {preview.newRows} · уже известных: {preview.existingRows}. Ничего не опубликовано.
      </div>}
      <div className="row">
        <button className="btn ghost" disabled={busy || !valid} onClick={() => void check()}>
          {busy ? 'Обрабатываем…' : 'Проверить перед загрузкой'}
        </button>
        <button className="btn" disabled={busy || !valid || !preview || preview.processed !== rows.length}
          onClick={() => void importAll()}>Загрузить на проверку</button>
      </div>
      <span className="note">За один запрос передаётся максимум 150 деталей. При обрыве интернета файл можно загрузить повторно — одинаковые записи не размножаются.</span>
    </div>
    <div className="card stack">
      <b>Проверка импортированных артикулов</b>
      <div className="scroll-x">
        {([['pending', 'На проверке'], ['approved', 'Подтверждены'], ['all', 'Все']] as const).map(([k, label]) =>
          <button key={k} className="chip" aria-pressed={state === k} onClick={() => { setState(k); setPage(0); }}>{label}</button>)}
      </div>
      <input className="field" placeholder="Искать бренд, номер или название" value={query} onChange={(e) => setQuery(e.target.value)}/>
      {!list.data ? <Loading error={list.error} /> : <>
        {!list.data.items.length && <div className="empty">Подходящих записей нет</div>}
        {list.data.items.map((p: any) => <div key={p.id} className="card stack" style={{ gap: 8 }}>
          <b>{p.name}</b>
          <span className="note">{p.brand} · {p.article} · {config.data.categories[p.category]}</span>
          <span className="note">Источник: {p.sourceNote}</span>
          <div className="row">
            <span className={p.reviewed ? 'pill good' : 'pill'}>{p.reviewed ? 'Подтверждена' : 'Требует проверки'}</span>
            <button className="btn ghost small" disabled={busy}
              onClick={() => void reviewEntry(p.id, !p.reviewed)}>
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
