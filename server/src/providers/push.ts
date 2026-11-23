import { config } from '../config.ts';

export interface PushMessage {
  /** call — входящая заявка: приложение показывает полноэкранный вызов на 30 секунд */
  kind: 'call' | 'normal';
  title: string;
  body: string;
  data: Record<string, string>;
  ttlSeconds?: number;
}

export interface PushProvider {
  name: string;
  send(tokens: { provider: string; token: string }[], msg: PushMessage): Promise<void>;
}

export class LogPush implements PushProvider {
  name = 'log';
  sent: { tokens: string[]; msg: PushMessage }[] = [];
  async send(tokens: { provider: string; token: string }[], msg: PushMessage) {
    this.sent.push({ tokens: tokens.map((t) => t.token), msg });
  }
}

/**
 * RuStore Push (VK Push): только data-сообщения, чтобы приложение само решало,
 * показывать ли полноэкранный вызов. Адрес и формат сверить с документацией RuStore при подключении.
 */
export class RuStorePush implements PushProvider {
  name = 'rustore';
  constructor(private projectId: string, private serviceToken: string) {}
  async send(tokens: { provider: string; token: string }[], msg: PushMessage) {
    const url = `https://vkpns.rustore.ru/v1/projects/${this.projectId}/messages:send`;
    // Duplicate device tokens must not receive duplicate requests. Devices
    // registered through other providers are not valid RuStore recipients.
    const devices = [...new Set(tokens
      .filter(t => t.provider === 'rustore' && t.token)
      .map(t => t.token))];
    if (!devices.length) return;

    // A single offline device cannot hang the whole request indefinitely or
    // prevent trying the remaining devices. The caller handles this transport
    // failure without losing the already committed application notification.
    const results = await Promise.allSettled(devices.map(async token => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.serviceToken}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          message: {
            token,
            data: { ...msg.data, kind: msg.kind, title: msg.title, body: msg.body },
            android: { priority: msg.kind === 'call' ? 'HIGH' : 'NORMAL', ttl: `${msg.ttlSeconds ?? 3600}s` },
          },
        }),
      });
      // Do not read/log the external response body: it can contain device
      // tokens, service details or account information. HTTP status is enough
      // to record failure for this best-effort delivery layer.
      if (!response.ok) throw new Error('RuStore rejected push');
    }));
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) throw new Error(`RuStore push failed for ${failed} of ${devices.length} devices`);
  }
}

export function createPush(): PushProvider {
  if (config.push.provider === 'rustore') return new RuStorePush(config.push.rustoreProjectId, config.push.rustoreServiceToken);
  return new LogPush();
}
