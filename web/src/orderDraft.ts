// Offline drafts are local and EXPLICITLY saved, never auto-submitted.
// AES-GCM encrypted with the current authenticated session token; on logout
// or account switch, api.setToken() erases the stored ciphertext.
import { getToken } from './api.ts';

export type NewOrderDraft = {
  service: string;
  regionId: ''|'spb'|'lo'|'other';
  zoneId: string;
  tier: 'eco'|'comfort'|'pro';
  night: boolean|null;
  group: boolean;
  vehicleId: string;
  car: {brand:string;model:string;year:string};
  description: string;
  address: string;
  destination: string;
  cargo: 'tractor'|'semitrailer'|'coupling'|'truck12'|'bus'|'special';
  loaded: 'empty'|'loaded'|'adr';
  driverOnSite: boolean;
  method: 'cash'|'online'|'invoice';
  site: {place?:string;pass?:string;meet?:string;state?:string;when?:string;time?:string};
  roadside: boolean;
  roadName: string;
  roadKm: string;
  roadDirection: string;
  roadSide: 'right'|'left'|'unknown';
};
export type SavedNewOrderDraft = { data:NewOrderDraft; savedAt:number };
const STORAGE_KEY='traksos.savedOrderDraft.v1';
const MAX_AGE=48*60*60*1000;
const encoder=new TextEncoder(),decoder=new TextDecoder();

function bytesToHex(data:Uint8Array):string {
  return Array.from(data,x=>x.toString(16).padStart(2,'0')).join('');
}
function hexToBytes(value:string):Uint8Array {
  if(!/^(?:[0-9a-f]{2})+$/.test(value))throw Error('Невозможно прочитать локальный черновик');
  return Uint8Array.from(value.match(/../g)!,x=>parseInt(x,16));
}
async function key() {
  const token=getToken();
  if(!token||!crypto?.subtle)throw Error('Локальные черновики доступны только после входа через защищённое соединение');
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode('TrackSOS-order-draft-v1:'+token));
  return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
export function clearNewOrderDraft() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}
export async function saveNewOrderDraft(userId:string,data:NewOrderDraft):Promise<SavedNewOrderDraft> {
  const savedAt=Date.now();
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const payload=encoder.encode(JSON.stringify({userId,data,savedAt}));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},await key(),payload);
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify({
      version:1,savedAt,nonce:bytesToHex(nonce),ciphertext:bytesToHex(new Uint8Array(encrypted))
    }));
  }catch{throw Error('Не удалось сохранить на устройстве: возможно, заполнена память браузера')}
  return {data,savedAt};
}
export async function readNewOrderDraft(userId:string,service:string):Promise<SavedNewOrderDraft|null> {
  let envelope:any;
  try {
    const value=localStorage.getItem(STORAGE_KEY);
    if(!value)return null;
    envelope=JSON.parse(value);
    if(envelope?.version!==1 || !Number.isFinite(envelope.savedAt) ||
       envelope.savedAt>Date.now()+60_000 || Date.now()-envelope.savedAt>MAX_AGE){
      clearNewOrderDraft();
      return null;
    }
    const nonce=hexToBytes(envelope.nonce);
    if(nonce.length!==12)throw Error('bad nonce');
    const decrypted=await crypto.subtle.decrypt(
      {name:'AES-GCM',iv:nonce},await key(),hexToBytes(envelope.ciphertext));
    const plain=JSON.parse(decoder.decode(decrypted));
    const data=plain?.data as NewOrderDraft | undefined;
    if(plain?.userId!==userId || data?.service!==service)return null;
    if(!data || typeof data.address!=='string' || typeof data.description!=='string' ||
       typeof data.regionId!=='string' || typeof data.vehicleId!=='string')return null;
    return {data,savedAt:envelope.savedAt};
  }catch{
    // A different session cannot decrypt the old payload. Don't leak even
    // a partial snapshot or automatically transmit it to the server.
    return null;
  }
}
