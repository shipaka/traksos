// Versioned sandbox admin handoff contract. Production and sandbox may have
// different application builds as long as they speak the same ticket protocol.
// All sandbox access remains admin-only, HMAC-signed, expiring and single-use.
export const SANDBOX_HANDOFF_PROTOCOL = 1;

export type SandboxPeerHealth = {
  enabled: boolean;
  reason?: string;
  buildRevision?: string;
  sandboxRevision?: string;
  versionsMatch?: boolean;
};

export function assessSandboxPeerHealth(remote: unknown, currentRevision: string): SandboxPeerHealth {
  const unavailable = (reason: string): SandboxPeerHealth => ({enabled: false, reason});
  if (!remote || typeof remote !== 'object') return unavailable('Тестовый сервер недоступен');
  const health = remote as Record<string, unknown>;
  if (health.ok !== true || health.db !== true || health.sandbox !== true)
    return unavailable('Тестовый сервер или его отдельная база недоступны');
  // Never let a very old or incompatible image receive a signed admin ticket.
  // This is an explicit protocol negotiation, NOT a relaxation of ticket auth.
  if (health.sandboxHandoffVersion !== SANDBOX_HANDOFF_PROTOCOL)
    return unavailable('Тестовому серверу требуется обновление механизма безопасного входа');
  const sandboxRevision = health.buildRevision;
  if (typeof sandboxRevision !== 'string' || sandboxRevision.length < 7 ||
      sandboxRevision === 'unknown')
    return unavailable('Не удалось подтвердить версию тестового сервера');
  return {
    enabled: true,
    buildRevision: currentRevision,
    sandboxRevision,
    versionsMatch: currentRevision === sandboxRevision,
  };
}
