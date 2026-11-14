// Single designated insurance partner is private VPS configuration, not a public role.
// All paths (SMS request, code verification and existing-account login) must agree.
import type { AccountChoice } from './roles.ts';

export type InsuranceRegistrationError =
  | 'insurer_only'
  | 'insurer_registration_closed'
  | 'insurer_number_missing';

export function insuranceRegistrationError(
  phone: string,
  accountType: AccountChoice | undefined,
  primaryPhone: string,
  registrationOpen: boolean,
): InsuranceRegistrationError | null {
  // Reserved phone cannot create another kind of account, even through a
  // forged /api/auth/verify request or a legacy client omitting accountType.
  if (primaryPhone && phone === primaryPhone && accountType !== 'insurer')
    return 'insurer_only';
  if (accountType === 'insurer') {
    if (!primaryPhone) return 'insurer_number_missing';
    if (phone !== primaryPhone && !registrationOpen)
      return 'insurer_registration_closed';
  }
  return null;
}
export function insuranceRegistrationMessage(error: InsuranceRegistrationError): string {
  switch (error) {
    case 'insurer_only':
      return 'Этот номер закреплён за страховым агентом. Для него доступна только регистрация «Я представитель страховой компании». Перейдите в страховой кабинет.';
    case 'insurer_registration_closed':
      return 'Регистрация новых страховых агентов сейчас закрыта. Обратитесь к администратору TrakSOS.';
    case 'insurer_number_missing':
      return 'Регистрация страховых агентов пока не настроена. Обратитесь к администратору TrakSOS.';
  }
}
