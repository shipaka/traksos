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
type AirSosContext = {text:string;bottom:boolean;anchor:{id:string;offset:number;top:number}|null;uncertain:boolean};
let sosPending:({owner:string;token:string;roleKey:string;context:AirSosContext})|null=null;
// Single in-memory, session-bound handoff. The SOS route receives no chat data.
export function stageAirSosDraft(owner:string,token:string,roleKey:string,context:AirSosContext){
  sosPending={owner,token,roleKey,context};
}
// SOS can inspect the existence of its own return context, never the message text.
export function hasAirSosDraft(owner:string,token:string|null,roleKey:string):boolean{
  return !!sosPending&&!!token&&sosPending.owner===owner&&sosPending.token===token&&sosPending.roleKey===roleKey;
}
export function takeAirSosDraft(owner:string,token:string|null,roleKey:string){
  const saved=sosPending;
  sosPending=null;
  return saved&&saved.owner===owner&&saved.token===token&&saved.roleKey===roleKey?saved.context:null;
}
export function clearAirDraft(){ pending=null;sosPending=null; }
