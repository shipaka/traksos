// Audit imports from the actual web entry without deleting any source files.
// Run from repository root. Orphans may be test-only: review before removal.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const src = resolve('web/src');
const extensions = new Set(['.ts', '.tsx', '.css']);
async function filesUnder(dir) {
  const children = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(children.map(entry => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file)
      : Promise.resolve(entry.isFile() && extensions.has(extname(file)) ? [file] : []);
  }));
  return nested.flat();
}
const all = new Set(await filesUnder(src));
const sources = new Map(await Promise.all([...all].map(async path =>
  [path, await readFile(path, 'utf8')])));
const seen = new Set();
const missing = [];
const pending = [join(src, 'main.tsx')];
const importRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)['"]((?:\.\/|\.\.\/)[^'"]+)['"]/g;
while (pending.length) {
  const path = pending.pop();
  if (seen.has(path)) continue;
  seen.add(path);
  const body = sources.get(path);
  if (body === undefined) { missing.push(path); continue; }
  for (const match of body.matchAll(importRe)) {
    const name = match[1].split(/[?#]/, 1)[0];
    const target = resolve(dirname(path), name);
    const choices = [target, target + '.ts', target + '.tsx', target + '.css',
      join(target, 'index.ts'), join(target, 'index.tsx')];
    const found = choices.find(candidate => all.has(candidate));
    if (found) pending.push(found);
    else if (/\.(ts|tsx|css)$/.test(name)) missing.push(relative(src, path) + ' -> ' + name);
  }
}
const unused = [...all].filter(path => !seen.has(path))
  .map(path => relative(src, path)).sort();
const result = {
  checked: all.size, reachable: seen.size,
  candidateModules: unused.filter(path => !path.endsWith('.css')),
  candidateStyles: unused.filter(path => path.endsWith('.css')),
  missingImports: missing.sort()
};
console.log('TrakSOS source reachability (no automatic deletion):\n' +
  JSON.stringify(result, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    '### UI source inventory\n' +
    '- Reachable: ' + seen.size + '/' + all.size + '\n' +
    '- Potential orphan modules: ' + result.candidateModules.length + '\n' +
    '- Potential orphan styles: ' + result.candidateStyles.length + '\n');
}
if (missing.length || (process.argv.includes('--strict') && unused.length)) {
  process.exitCode = 1;
}
