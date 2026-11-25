import type { StaffRecipient } from '../../server/src/domain/airIntent.ts';
type PrivateDraft = { owner: string; token: string; text: string; recipient: StaffRecipient | null };
let pending: PrivateDraft | null = null;
// Memory only: never put private text in hash, browser storage or logs.
export function stageAirDraft(owner: string, token: string | null, text: string, recipient: StaffRecipient | null) {
  pending = token ? {owner, token, text, recipient} : null;
}
export function takeAirDraft(owner: string, token: string | null) {
  const draft = pending;
  pending = null;
  return draft && draft.owner===owner && draft.token===token ? {text:draft.text, recipient:draft.recipient} : null;
}
export function clearAirDraft(){ pending=null; }
