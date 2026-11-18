import { config } from '../config.ts';

export interface SmsProvider {
  name: string;
  /** true — код можно показать в ответе (только разработка) */
  exposesCode: boolean;
  send(phone: string, text: string): Promise<void>;
  /** Inbound Flash Call: return only the 4 caller-ID digits. The auth layer stores a keyed hash. */
  verificationCall?(phone: string, ip: string): Promise<string>;
}

export class LogSms implements SmsProvider {
  name = 'log';
  exposesCode = true;
  sent: { phone: string; text: string }[] = [];
  async send(phone: string, text: string) {
    this.sent.push({ phone, text });
    console.log(`[sms] ${phone}: ${text}`);
  }
  /** Local-only simulation, never used by the real SMS.ru provider. */
  async verificationCall(phone: string, _ip: string) {
    const { newCode } = await import('../util.ts');
    const code = newCode();
    this.sent.push({ phone, text: '[local Flash Call simulation] ' + code });
    console.log('[call] local simulation: ' + code);
    return code;
  }
}

/** SMS.ru — https://sms.ru/api/send. Проверить формат ответа при подключении. */
/** An explicit refusal from SMS.ru (not an ambiguous network timeout). */
export class SmsRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsRejectedError';
  }
}

export class SmsRu implements SmsProvider {
  name = 'smsru';
  exposesCode = false;
  constructor(private apiId: string) {}
  /**
   * SMS.ru /code/call: provider calls the CUSTOMER. Never use /callcheck/add
   * (the reverse direction), and never expose the returned code to a browser.
   * https://sms.ru/docs/api/api_group_call/code_call
   */
  async verificationCall(phone: string, ip: string): Promise<string> {
    if (!this.apiId) throw new Error('SMSRU_API_ID не задан');
    const body = new URLSearchParams({
      api_id: this.apiId, phone: phone.replace('+',''),
      // Provider requires client IP; -1 is documented for internal or manual calls.
      ip: ip || '-1',
    });
    const response = await fetch('https://sms.ru/code/call', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body, signal: AbortSignal.timeout(15_000),
    });
    const result: unknown = await response.json().catch(() => null);
    const data = result && typeof result === 'object' ? result as Record<string, unknown> : null;
    // An explicit provider refusal is safe to retry after correcting the cause.
    if (data?.status && data.status !== 'OK')
      throw new SmsRejectedError('SMS.ru отклонил исходящий проверочный звонок');
    // Unknown status/malformed reply can mean the call was already placed:
    // preserve auth cooldown rather than charging twice.
    if (!response.ok || data?.status !== 'OK' || typeof data.code !== 'string' || !/^\\d{4}$/.test(data.code))
      throw new Error('Не удалось подтвердить статус Flash Call от SMS.ru');
    return data.code;
  }
  async send(phone: string, text: string) {
    if (!this.apiId) throw new Error('SMSRU_API_ID не задан');
    const to = phone.replace('+', '');
    const body = new URLSearchParams({ api_id: this.apiId, to, msg: text, json: '1' });
    const r = await fetch('https://sms.ru/sms/send', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => null);
    // SMS.ru may return overall status=OK even if a particular recipient is rejected.
    const delivery = j?.sms?.[to];
    if (!r.ok || j?.status !== 'OK' || delivery?.status !== 'OK') {
      const reason = delivery?.status_text ?? j?.status_text ?? `HTTP ${r.status}`;
      // Rejection is certain only when the provider explicitly says ERROR.
      // A malformed or incomplete response could follow an accepted SMS;
      // keep the cooldown instead of risking an accidental duplicate send.
      const rejected = (typeof j?.status === 'string' && j.status !== 'OK')
        || (typeof delivery?.status === 'string' && delivery.status !== 'OK');
      if (rejected) throw new SmsRejectedError(`SMS.ru не принял сообщение: ${reason}`);
      throw new Error('SMS.ru не подтвердил итог отправки; попробуйте позже');
    }
  }
}

export function createSms(): SmsProvider {
  if (config.sms.provider === 'smsru') return new SmsRu(config.sms.smsruApiId);
  return new LogSms();
}
