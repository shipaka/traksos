// Раздача собранного веб-приложения (web/dist). Неизвестные пути → index.html (приложение само разбирает адрес).

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

export function staticHandler(root: string) {
  const base = path.resolve(root);
  return async function serve(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(base)) file = path.join(base, 'index.html');
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(base, 'index.html');
    }
    try {
      const body = await readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, {
        'content-type': TYPES[ext] ?? 'application/octet-stream',
        'cache-control': ext === '.html' || url.pathname === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Веб-приложение не собрано: npm -w web run build');
    }
  };
}
