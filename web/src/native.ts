// Мост к Android-приложению (android/): window.TrakSOSNative + события 'traksos-native'.
// В обычном браузере всё — заглушки.

type CallAction = (orderId: string, action: 'accept' | 'decline', handled: boolean) => void;

const bridge = (window as any).TrakSOSNative as undefined | {
  isApp(): boolean;
  setSession(apiUrl: string, token: string | null): void;
  pushToken(): string;
  performerOnline(): void;
  appLockEnabled(): boolean;
  setAppLockEnabled(enabled: boolean): boolean;
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

  /** Android optionally unlocks the same saved session with fingerprint or system device PIN. */
  appLockEnabled(): boolean {
    try { return bridge?.appLockEnabled?.() === true; } catch { return false; }
  },
  setAppLockEnabled(enabled: boolean): boolean {
    try { return bridge?.setAppLockEnabled?.(enabled) === true; } catch { return false; }
  },

  /** Ответ на вызов из уведомления или экрана блокировки (уже отправлен приложением — handled) */
  onCallAction(fn: CallAction) {
    on('callAction', (d) => fn(d.orderId, d.action, d.handled === 'true'));
  },
};
