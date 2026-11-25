// Only recovery metadata is persisted. No body, bearer token or sender name.
export const CHAT_RECOVERY_PREFIX='traksos.chatPending.v1:';
export type ChatRecovery={requestId:string;kind:'text'|'quick';digest:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function digest(value:string){
  const data=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function chatRecoveryKey(token:string,userId:string,orderId:string){
  return CHAT_RECOVERY_PREFIX+await digest(JSON.stringify([token,userId,orderId]));
}
export function chatRecoveryDigest(requestId:string,kind:string,body:string){
  return digest(JSON.stringify([requestId,kind,body.trim().slice(0,2000)]));
}
export function readChatRecovery(key:string):ChatRecovery|null{
  const raw=localStorage.getItem(key);
  if(!raw)return null;
  const r=JSON.parse(raw);
  if(!r||!uuid.test(r.requestId)||!['text','quick'].includes(r.kind)||!/^\w{64}$/.test(r.digest))
    throw new Error('Некорректные данные восстановления отправки');
  return {requestId:r.requestId,kind:r.kind,digest:r.digest};
}
export function writeChatRecovery(key:string,r:ChatRecovery){
  const old=readChatRecovery(key);
  if(old&&old.requestId!==r.requestId)throw new Error('Есть другая неподтверждённая отправка. Откройте чат снова.');
  localStorage.setItem(key,JSON.stringify(r));
}
export function clearChatRecovery(key:string,requestId:string){
  if(readChatRecovery(key)?.requestId===requestId)localStorage.removeItem(key);
}
export function clearAllChatRecovery(){
  try{
    for(let i=localStorage.length-1;i>=0;i--){
      const key=localStorage.key(i);
      if(key?.startsWith(CHAT_RECOVERY_PREFIX))localStorage.removeItem(key);
    }
  }catch{/* storage unavailable */}
}
