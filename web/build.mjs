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
  // Android 10 Google-API images can ship WebView 74 without Play updates.
  // Keep syntax within that engine's baseline; esbuild downlevels newer JS.
  target: ['es2018', 'chrome69'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
    __API_URL__: JSON.stringify(process.env.API_URL ?? ''),
    __TRAKSOS_BUILD_REV__: JSON.stringify(process.env.TRAKSOS_BUILD_REV ?? 'unknown'),
  },
  loader: { '.css': 'css', '.svg': 'file', '.webp': 'file' },
  // Files from public/ are copied verbatim to dist/ before bundling.
  // CSS url('/asset.webp') is a runtime root-relative URL, not a file to
  // resolve from web/src; otherwise esbuild breaks the approved PC layout.
  external: ['/*.webp', '/*.svg', '/*.png', '/*.jpg', '/*.jpeg'],
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
  // Real manufacturer/model photography is shipped as static, privacy-safe
  // local WebP. Precache these nested files for poor mobile connectivity;
  // never precache a customer's own uploaded photo, orders or API responses.
  const modelImages = (await readdir('dist/vehicles/models').catch(() => []))
    .filter((name) => /^[a-z0-9-]+\.webp$/.test(name))
    .map((name) => '/vehicles/models/' + name).sort();
  const photoCredits = await readFile('dist/vehicle-photo-credits.html').then(
    () => ['/vehicle-photo-credits.html'], () => []);
  const staticPaths = ['/', '/index.html', ...files.map((file) => '/' + file),
    ...modelImages, ...photoCredits];
  // Version the complete static bundle, including branded artwork. Otherwise
  // a truck image replacement under an unchanged file name stays in old PWA caches.
  const cacheHash = createHash('sha256');
  for (const p of staticPaths) {
    const file = p === '/' ? 'index.html' : p.slice(1);
    cacheHash.update(p).update(await readFile('dist/' + file));
  }
  const digest = cacheHash.digest('hex').slice(0, 16);
  const template = await readFile('sw.template.js', 'utf8');
  await writeFile('dist/sw.js', template
    .replace('__CACHE_NAME__', JSON.stringify('tracksos-static-' + digest))
    .replace('__STATIC_PATHS__', JSON.stringify(staticPaths)));
  console.log('Готово: web/dist; static precache:', staticPaths.length, 'files');
}
