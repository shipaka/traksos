// Мост к Android-приложению (android/): window.TrakSOSNative + события 'traksos-native'.
// В обычном браузере всё — заглушки.

type CallAction = (orderId: string, action: 'accept' | 'decline', handled: boolean) => void;

const bridge = (window as any).TrakSOSNative as undefined | {
  isApp(): boolean;
  setSession(apiUrl: string, token: string | null): void;
  pushToken(): string;
  performerOnline(): void;
};

const listeners: Record<string, ((d: any) => void)[]> = {};
window.addEventListener('traksos-native', (e: any) => {
  for (const fn of listeners[e.detail?.name] ?? []) fn(e.detail.data);
});
const on = (name: string, fn: (d: any) => void) => (listeners[name] ??= []).push(fn);

export const native = {
  isApp: !!bridge,

  /** Получить токен RuStore Push и отправить на сервер (приложение отправит и само, но так надёжнее) */
  async registerPush(send: (token: string) => Promise<unknown>) {
    if (!bridge) return;
    on('pushToken', (d) => d?.token && send(d.token).catch(() => {}));
    const t = bridge.pushToken();
    if (t) await send(t).catch(() => {});
  },

  /** Передать токен входа нативной части, чтобы «Беру» с экрана блокировки работало без открытия страницы */
  async setSession(apiUrl: string, token: string | null) {
    bridge?.setSession(apiUrl, token);
  },

  /** Исполнитель на линии: приложение попросит разрешить вызов на весь экран (Android 14+) */
  performerOnline() {
    bridge?.performerOnline();
  },

  /** Ответ на вызов из уведомления или экрана блокировки (уже отправлен приложением — handled) */
  onCallAction(fn: CallAction) {
    on('callAction', (d) => fn(d.orderId, d.action, d.handled === 'true'));
  },
};
