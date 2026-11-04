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
    await Promise.all(
      tokens
        .filter((t) => t.provider === 'rustore')
        .map(async (t) => {
          const r = await fetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${this.serviceToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              message: {
                token: t.token,
                data: { ...msg.data, kind: msg.kind, title: msg.title, body: msg.body },
                android: { priority: msg.kind === 'call' ? 'HIGH' : 'NORMAL', ttl: `${msg.ttlSeconds ?? 3600}s` },
              },
            }),
          });
          if (!r.ok) console.warn(`[push] RuStore ${r.status}: ${await r.text().catch(() => '')}`);
        }),
    );
  }
}

export function createPush(): PushProvider {
  if (config.push.provider === 'rustore') return new RuStorePush(config.push.rustoreProjectId, config.push.rustoreServiceToken);
  return new LogPush();
}
