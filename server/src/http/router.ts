import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public data?: unknown) {
    super(message ?? code);
  }
}

export const bad = (code: string, message?: string, data?: unknown) => new HttpError(400, code, message, data);
export const forbidden = (message = 'Нет доступа') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Не найдено') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);

export interface AuthUser {
  id: string;
  phone: string;
  name: string | null;
  roles: string[];
  status: string;
  owner_id: string | null;
}

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  user: AuthUser | null;
  ip: string;
  rawBody: string;
  headers: IncomingMessage['headers'];
}

export interface AuthedCtx extends Ctx {
  user: AuthUser;
}

type Handler = (ctx: any) => Promise<unknown> | unknown;
type Auth = false | true | string[];

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  auth: Auth;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, auth: Auth, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' + path.replace(/\/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '/([^/]+)')) + '/?$',
    );
    this.routes.push({ method, re, keys, auth, handler });
    return this;
  }
  get(p: string, a: Auth, h: Handler) { return this.add('GET', p, a, h); }
  post(p: string, a: Auth, h: Handler) { return this.add('POST', p, a, h); }
  put(p: string, a: Auth, h: Handler) { return this.add('PUT', p, a, h); }
  patch(p: string, a: Auth, h: Handler) { return this.add('PATCH', p, a, h); }
  delete(p: string, a: Auth, h: Handler) { return this.add('DELETE', p, a, h); }

  match(method: string, path: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return null;
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw bad('validation', 'Проверьте поля формы', r.error.flatten());
  return r.data;
}

export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(json);
}

export function errorBody(e: unknown) {
  if (e instanceof HttpError) return { status: e.status, body: { error: e.code, message: e.message, data: e.data } };
  if (e instanceof ZodError) return { status: 400, body: { error: 'validation', message: 'Проверьте поля формы', data: e.flatten() } };
  if ((e as any)?.name === 'TransitionError') return { status: 409, body: { error: 'bad_status', message: (e as Error).message } };
  return { status: 500, body: { error: 'internal', message: 'Ошибка сервера' } };
}
