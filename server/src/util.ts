import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { config } from './config.ts';

/** +7XXXXXXXXXX или null */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') return '+7' + d;
  return null;
}

export const hmac = (v: string) => createHmac('sha256', config.secret).update(v).digest('hex');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const newCode = () => String(randomInt(0, 10_000)).padStart(4, '0');

/** «1 575 ₽» из копеек */
export function rub(kopecks: number) {
  const r = kopecks / 100;
  return r.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ') + ' ₽';
}

/** Скрываем номера телефонов в тексте чата */
const phoneRe = /(?:\+7|8|7)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g;
export function maskPhones(text: string) {
  const masked = text.replace(phoneRe, '[номер скрыт]');
  return { text: masked, masked: masked !== text };
}
