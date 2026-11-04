// Мост к Android-приложению (Capacitor). В обычном браузере всё — заглушки.
// Нативная часть (android/) регистрирует плагин TrakSOS: токен RuStore Push и нажатия «Беру/Отклонить» на экране вызова.

type CallAction = (orderId: string, action: 'accept' | 'decline') => void;

const cap = (window as any).Capacitor;
const plugin = cap?.Plugins?.TrakSOS;

export const native = {
  isApp: !!cap?.isNativePlatform?.(),

  /** Получить токен RuStore Push и отправить его на сервер */
  async registerPush(send: (token: string) => Promise<unknown>) {
    if (!plugin) return;
    try {
      const { token } = await plugin.getPushToken();
      if (token) await send(token);
      plugin.addListener('pushToken', (e: { token: string }) => send(e.token).catch(() => {}));
    } catch (e) {
      console.warn('[native] push', e);
    }
  },

  /** Передать токен входа нативной части, чтобы «Беру» с экрана блокировки работало без открытия приложения */
  async setSession(apiUrl: string, token: string | null) {
    await plugin?.setSession?.({ apiUrl, token }).catch(() => {});
  },

  onCallAction(fn: CallAction) {
    plugin?.addListener?.('callAction', (e: { orderId: string; action: 'accept' | 'decline' }) => fn(e.orderId, e.action));
  },
};
