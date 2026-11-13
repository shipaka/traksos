// Central role policy: never grant a client account provider privileges on sign-in.
import { bad } from '../http/router.ts';

export const SELF_ROLES = ['client', 'driver', 'master', 'tow', 'service', 'insurer'] as const;
export type SelfRole = typeof SELF_ROLES[number];
export type AccountChoice = 'owner' | 'driver' | 'master' | 'tow' | 'service' | 'master_service' | 'insurer';

export function requestedRoles(choice: AccountChoice): SelfRole[] {
  switch (choice) {
    case 'owner': return ['client'];
    case 'driver': return ['driver'];
    case 'master': return ['master'];
    case 'tow': return ['tow'];
    case 'service': return ['service'];
    case 'master_service': return ['master', 'service'];
    case 'insurer': return ['insurer'];
  }
}

export function validateRoles(existing: string[], requested: readonly string[]) {
  const current = new Set(existing.filter((r) => !['admin', 'moderator'].includes(r)));
  const target = new Set([...current, ...requested]);
  const client = target.has('client') || target.has('driver');
  const provider = ['master', 'tow', 'service'].some((r) => target.has(r));
  const insurer = target.has('insurer') || target.has('inspection_operator');
  if ((client && provider) || (insurer && (client || provider)) ||
      (target.has('client') && target.has('driver'))) {
    throw bad('incompatible_roles', 'Этот номер уже привязан к другой категории. Для другой деятельности нужен отдельный аккаунт.');
  }
  // The allowed combined workplace is a mobile master plus a repair base.
  if (target.has('tow') && (target.has('master') || target.has('service'))) {
    throw bad('incompatible_roles', 'Эвакуатор оформляется отдельным рабочим аккаунтом.');
  }
  return [...target, ...existing.filter((r) => r === 'admin' || r === 'moderator')];
}

export function assertRoleExtension(existing: string[], role: string) {
  return validateRoles(existing, [role]);
}
