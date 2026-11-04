import { config } from '../config.ts';

export interface SmsProvider {
  name: string;
  /** true — код можно показать в ответе (только разработка) */
  exposesCode: boolean;
  send(phone: string, text: string): Promise<void>;
}

export class LogSms implements SmsProvider {
  name = 'log';
  exposesCode = true;
  sent: { phone: string; text: string }[] = [];
  async send(phone: string, text: string) {
    this.sent.push({ phone, text });
    console.log(`[sms] ${phone}: ${text}`);
  }
}

/** SMS.ru — https://sms.ru/api/send. Проверить формат ответа при подключении. */
export class SmsRu implements SmsProvider {
  name = 'smsru';
  exposesCode = false;
  constructor(private apiId: string) {}
  async send(phone: string, text: string) {
    const url = new URL('https://sms.ru/sms/send');
    url.searchParams.set('api_id', this.apiId);
    url.searchParams.set('to', phone.replace('+', ''));
    url.searchParams.set('msg', text);
    url.searchParams.set('json', '1');
    const r = await fetch(url, { method: 'POST' });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || j?.status !== 'OK') throw new Error(`SMS.ru: ${j?.status_text ?? r.status}`);
  }
}

export function createSms(): SmsProvider {
  if (config.sms.provider === 'smsru') return new SmsRu(config.sms.smsruApiId);
  return new LogSms();
}
