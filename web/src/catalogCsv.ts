// Strict, lightweight CSV/TSV parsing for admin-only reference catalog imports.
// Nothing is sent to the server until the administrator verifies the file and
// confirms that they have permission to use the source data.
export interface CatalogCsvRow {
  brand: string;
  article: string;
  name: string;
  category: string;
  searchTerms?: string;
}

function delimiter(header: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === '"') {
      if (quoted && header[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && counts[ch] != null) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseRows(text: string, separator: string): string[][] {
  const result: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === separator && !quoted) {
      cells.push(cell.trim()); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell.trim());
      if (cells.some(Boolean)) result.push(cells);
      cells = []; cell = '';
      if (result.length > 10_001) throw new Error('В файле больше 10 000 строк. Разделите его на несколько файлов.');
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('Некорректные кавычки в CSV: проверьте файл.');
  cells.push(cell.trim());
  if (cells.some(Boolean)) result.push(cells);
  return result;
}

const aliases: Record<string, string[]> = {
  brand: ['brand', 'manufacturer', 'producer', 'бренд', 'производитель', 'маркадетали'],
  article: ['article', 'sku', 'partnumber', 'partno', 'артикул', 'номерартикула', 'номердетали', 'каталожныйномер'],
  name: ['name', 'title', 'description', 'название', 'наименование', 'деталь', 'названиедетали'],
  category: ['category', 'group', 'категория', 'раздел', 'группа'],
  searchTerms: ['searchterms', 'synonyms', 'aliases', 'синонимы', 'ключевыеслова'],
};
const normalized = (s: string) => s.replace(/^\uFEFF/, '').trim().toLocaleLowerCase('ru-RU').replace(/[\s._-]+/g, '');

export function parseCatalogCsv(text: string, categories: Record<string, string>): CatalogCsvRow[] {
  if (text.length > 2_000_000) throw new Error('Файл слишком большой. Максимум 2 МБ текста.');
  const content = text.replace(/^\uFEFF/, '');
  const headerLine = content.split(/\r?\n/, 1)[0];
  const cells = parseRows(content, delimiter(headerLine));
  const headers = (cells.shift() ?? []).map(normalized);
  const position = (field: keyof CatalogCsvRow) =>
    headers.findIndex((header) => aliases[field].includes(header));
  const brand = position('brand'), article = position('article'),
    name = position('name'), category = position('category'), searchTerms = position('searchTerms');
  if ([brand, article, name, category].some((index) => index < 0))
    throw new Error('Не найдены обязательные колонки: бренд, артикул, название, категория.');
  if (!cells.length) throw new Error('Файл не содержит деталей.');

  const keys = new Set<string>();
  const result: CatalogCsvRow[] = [];
  for (let i = 0; i < cells.length; i++) {
    const line = cells[i];
    const rawCategory = (line[category] ?? '').trim();
    const key = Object.keys(categories).find((k) => k === rawCategory ||
      categories[k].toLocaleLowerCase('ru-RU') === rawCategory.toLocaleLowerCase('ru-RU'));
    if (!key) throw new Error(`Строка ${i + 2}: неизвестная категория «${rawCategory}».`);
    const item = {
      brand: (line[brand] ?? '').trim(), article: (line[article] ?? '').trim(),
      name: (line[name] ?? '').trim(), category: key,
      searchTerms: searchTerms < 0 ? '' : (line[searchTerms] ?? '').trim(),
    };
    if (!item.brand || item.article.length < 2 || item.name.length < 2)
      throw new Error(`Строка ${i + 2}: укажите бренд, артикул и название.`);
    const identity = JSON.stringify([item.brand.toLocaleUpperCase('ru-RU').replace(/\s+/g, ' '),
      item.article.toLocaleUpperCase('ru-RU').replace(/\s+/g, ' ')]);
    if (keys.has(identity)) throw new Error(`Строка ${i + 2}: артикул повторяется в файле.`);
    keys.add(identity);
    result.push(item);
  }
  return result;
}
