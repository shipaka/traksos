// Сборка веб-приложения в web/dist. API_URL — адрес сервера для Android-сборки (по умолчанию тот же сайт).
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

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
  loader: { '.css': 'css' },
};

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
  console.log('Готово: web/dist');
}
