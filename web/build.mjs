// Сборка веб-приложения в web/dist. API_URL — адрес сервера для Android-сборки (по умолчанию тот же сайт).
import { build, context } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'esm',
  target: ['es2020', 'chrome80'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
    __API_URL__: JSON.stringify(process.env.API_URL ?? ''),
  },
  loader: { '.css': 'css', '.svg': 'file', '.webp': 'file' },
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const html = await readFile('index.html', 'utf8');
await writeFile('dist/index.html', html.replaceAll('%BUILD%', Date.now().toString(36)));
await cp('public', 'dist', { recursive: true }).catch(() => {});

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('Слежу за изменениями…');
} else {
  await build(opts);
  // Service worker precaches ONLY static files. APIs, protected documents, messages
  // and authenticated responses are never stored in CacheStorage.
  const files = (await readdir('dist')).filter((name) =>
    /\.(?:js|css|svg|png|ico|webp|webmanifest|woff2)$/.test(name));
  const staticPaths = ['/', '/index.html', ...files.map((file) => '/' + file)];
  const digest = createHash('sha256').update(await readFile('dist/app.js'))
    .update(await readFile('dist/app.css')).digest('hex').slice(0, 16);
  const template = await readFile('sw.template.js', 'utf8');
  await writeFile('dist/sw.js', template
    .replace('__CACHE_NAME__', JSON.stringify('tracksos-static-' + digest))
    .replace('__STATIC_PATHS__', JSON.stringify(staticPaths)));
  console.log('Готово: web/dist; static precache:', staticPaths.length, 'files');
}
