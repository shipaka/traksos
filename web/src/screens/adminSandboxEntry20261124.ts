// Backend emits a signed, 45-second, one-time handoff. Browser cannot
// validate its HMAC without a server secret; it CAN reject arbitrary HTTPS
// redirects that do not match the agreed sandbox handoff protocol.
export function checkedSandboxEntryUrl(value: unknown, requestedRole: string,
  issuedRole: unknown, primaryOrigin: string): string {
  if (issuedRole !== requestedRole)
    throw new Error('Тестовый сервер вернул вход для другой роли');
  if (typeof value !== 'string' || value.length > 2000)
    throw new Error('Некорректная ссылка тестового входа');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Некорректная ссылка тестового входа'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.pathname !== '/' || url.origin === primaryOrigin ||
      !url.hash.startsWith('#/sandbox-enter?'))
    throw new Error('Тестовый вход не соответствует защищённому маршруту');
  const params = new URLSearchParams(url.hash.slice('#/sandbox-enter?'.length));
  const entries = [...params.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'ticket')
    throw new Error('Тестовый вход содержит неожиданные параметры');
  const token=entries[0][1];
  const parts=token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{20,1300}$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1]))
    throw new Error('Тестовый билет имеет неверный формат');
  return url.href;
}
