// One-time, opt-in import of independently written CC0 OBD-II explanations.
// This is NOT a downloader for proprietary OEM/J1939 service databases.
// Run: npm -w server run import:dtc
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDb } from '../db/index.ts';
import { migrate } from '../db/migrate.ts';
import { config } from '../config.ts';

const SOURCE = 'https://foerbsnavi.github.io/OBDex/generic.min.json';
const CREDIT = 'https://github.com/foerbsnavi/OBDex';
const CODE = /^[PBCU][0-3][0-9A-F]{3}$/;

interface RecordDtc {
  code: string;
  title?: { en?: string };
  description?: { en?: string };
  common_causes?: Array<{ label?: { en?: string }; likelihood?: string }>;
  symptoms?: Array<{ en?: string }>;
  reviewed?: string;
}
async function main() {
  const checkOnly = process.argv.includes('--check');
  const file = process.argv.slice(2).find((arg) => arg !== '--check');
  const raw = file ? await readFile(file, 'utf8') : await (async () => {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error('OBDex fetch failed: HTTP ' + response.status);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 100_000_000) throw new Error('OBDex payload is too large');
    return response.text();
  })();
  if (raw.length > 100_000_000) throw new Error('OBDex payload exceeds size limit');
  const digest = createHash('sha256').update(raw).digest('hex');
  const expected = process.env.TRAKBOT_DTC_SOURCE_SHA256?.toLowerCase().trim();
  if (expected && expected !== digest) throw new Error('OBDex checksum mismatch: import cancelled');
  const input: unknown = JSON.parse(raw);
  if (!Array.isArray(input) || input.length < 8000 || input.length > 20000)
    throw new Error('Unexpected OBDex dataset size: refusing partial import');
  const unique = new Map<string, RecordDtc>();
  for (const item of input as RecordDtc[]) {
    if (!item || typeof item.code !== 'string' || !CODE.test(item.code) ||
        typeof item.title?.en !== 'string' || !item.title.en.trim()) {
      throw new Error('Invalid OBDex record; import cancelled');
    }
    if (unique.has(item.code)) throw new Error('Duplicate OBDex code: ' + item.code);
    unique.set(item.code, item);
  }
  if (checkOnly) {
    console.log('OBDex dataset OK: ' + unique.size + ' records, SHA-256 ' + digest +
      '. Source: ' + CREDIT + ' (CC0-1.0). No database changes.');
    return;
  }
  // In production the upstream dataset must be explicitly pinned to an audited checksum.
  if (config.env === 'production' && !expected)
    throw new Error('Set TRAKBOT_DTC_SOURCE_SHA256 after staging validation before production import');
  const db = await createDb(config.databaseUrl);
  try {
    await migrate(db);
    let inserted = 0;
    const records = [...unique.values()];
    for (let start = 0; start < records.length; start += 150) {
      const batch = records.slice(start, start + 150);
      const params: unknown[] = [];
      const values: string[] = [];
      for (const row of batch) {
        const base = params.length;
        const causes = (row.common_causes ?? []).slice(0, 15).map((c) => ({
          label: String(c.label?.en ?? '').slice(0, 250),
          likelihood: String(c.likelihood ?? '').slice(0, 15),
        }));
        const symptoms = (row.symptoms ?? []).slice(0, 15).map((s) => String(s.en ?? '').slice(0, 250));
        params.push(row.code, row.title!.en!.slice(0, 250),
          String(row.description?.en ?? '').slice(0, 3000), JSON.stringify(causes),
          JSON.stringify(symptoms), CREDIT, 'CC0-1.0', row.reviewed ? 'external_reviewed' : 'unverified');
        values.push('(' + Array.from({ length: 8 }, (_, i) => '$' + (base + i + 1) + (i === 3 || i === 4 ? '::jsonb' : '')).join(',') + ')');
      }
      const result = await db.query<{ code: string }>(
        `insert into diagnostic_codes(code,title_en,detail_en,causes,symptoms,source_url,source_license,review_state)
           values ${values.join(',')}
           on conflict (protocol,make,ecu,code) do nothing returning code`,
        params,
      );
      inserted += result.length;
      console.log(`OBDex import: ${Math.min(start + batch.length, records.length)}/${records.length} processed`);
    }
    console.log(`OBDex: ${records.length} validated, ${inserted} new, existing records preserved. SHA-256 ${digest}. Source: ${CREDIT} (CC0-1.0)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
