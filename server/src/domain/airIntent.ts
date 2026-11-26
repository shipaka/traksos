// Explicit address to staff, not ordinary discussion about staff.
export type StaffRecipient = 'admin' | 'moderator';
export function staffRecipient(text: string): StaffRecipient | null {
  const value = text.trim();
  if (/(?:^|\s)@(?:admin|админ(?:истратор)?)(?![a-zа-яё0-9_])|(?:^|\s)(?:позов[иите]+|вызов[иите]+)\s+(?:админ(?:истратор)?а?)(?![а-яё])|^(?:админ(?:истратор)?)[\s,!:?—-]*(?:$|[,!:?—-]|помоги|помогите|привет|здравствуй|скажите|подскажите|ответьте)/iu.test(value)) return 'admin';
  if (/(?:^|\s)@(?:moderator|модератор)(?![a-zа-яё0-9_])|(?:^|\s)(?:позов[иите]+|вызов[иите]+)\s+модератора?(?![а-яё])|^модератор[\s,!:?—-]*(?:$|[,!:?—-]|помоги|помогите|привет|здравствуй|скажите|подскажите|ответьте)/iu.test(value)) return 'moderator';
  return null;
}
