// Release gate: the public brand has exactly one written form: TrakSOS.
// The domain is traksos.ru. Do not touch stable package names, storage keys or URLs.
// Photographic assets require a separate human visual proof because text burned
// into image pixels cannot be detected by this source-code check.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const roots = [
  ['web/src', new Set(['.ts', '.tsx', '.js', '.jsx', '.css'])],
  ['web/public', new Set(['.svg', '.html'])],
  ['server/src', new Set(['.ts', '.tsx', '.js'])],
  ['android/app/src/main/java', new Set(['.kt'])],
  ['android/app/src/main/res/values', new Set(['.xml'])],
];
const individual = ['web/index.html', 'web/sw.template.js', 'package.json'];
const forbidden = [
  /TrackSOS|TRACKSOS|Tracksos|TracSOS/g,
  /ТракSOS|ТРАКSOS|ТрекSOS|ТРЕКSOS|ТракСОС|ТрекСОС/g,
  /Track\s*<\s*b\s*>\s*SOS|Трак\s*<\s*b\s*>\s*SOS/g,
];
const failures = [];
let checked = 0;

async function scan(file) {
  const text = await readFile(file, 'utf8');
  checked++;
  for (const pattern of forbidden) {
    pattern.lastIndex = 0;
    for (const hit of text.matchAll(pattern)) {
      const line = text.slice(0, hit.index).split('\n').length;
      failures.push(`${file}:${line} — noncanonical brand spelling`);
    }
  }
}
async function walk(directory, ext) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const file = join(directory, item.name);
    if (item.isDirectory()) await walk(file, ext);
    else if (item.isFile() && ext.has(extname(item.name))) await scan(file);
  }
}
for (const [root, ext] of roots) await walk(root, ext);
for (const file of individual) await scan(file);

for (const [file, marker] of [
  ['web/index.html', '<title>TrakSOS</title>'],
  ['android/app/src/main/res/values/strings.xml', '<string name="app_name">TrakSOS</string>'],
  ['web/src/main.tsx', 'Trak<b>SOS</b>'],
  ['server/src/domain/defaults.ts', "brand: 'TrakSOS'"],
]) {
  if (!(await readFile(file, 'utf8')).includes(marker))
    failures.push(`${file} — missing required canonical branding`);
}
if (failures.length) {
  console.error('Brand gate blocked release: '+failures.length+' issue(s).');
  console.error(failures.slice(0, 80).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: TrakSOS is the only displayed brand form across ${checked} text source files`);
  console.log('Note: brand lettering embedded in raster photographs still needs manual image inspection.');
}
