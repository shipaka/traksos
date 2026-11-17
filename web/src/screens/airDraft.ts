/**
 * Optional driver chat draft for the current tab/session only.
 * NEVER store chat history, other participants' messages or private profiles.
 * Users must actively opt into preserving their own unsent text.
 */
export type DraftStorage={
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
};
export const AIR_DRAFT_TTL_MS=24*60*60*1000;
const keyFor=(userId:string,endpoint:string)=>
  'tracksos:air:opt-in-draft:v1:'+userId+':'+endpoint;

export function readAirDraft(storage:DraftStorage,userId:string,endpoint:string,now=Date.now()){
  const key=keyFor(userId,endpoint);
  try{
    const raw=storage.getItem(key);
    if(!raw)return {enabled:false,text:'',nonce:null};
    const value=JSON.parse(raw) as {expires:number;enabled:boolean;text:string;nonce?:string};
    if(value.enabled!==true||typeof value.expires!=='number'||
       value.expires<=now||value.expires>now+AIR_DRAFT_TTL_MS||
       typeof value.text!=='string'||value.text.length>2000){
      storage.removeItem(key);return {enabled:false,text:'',nonce:null};
    }
    return {enabled:true,text:value.text,nonce:typeof value.nonce==='string'&&
      /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value.nonce)
      ?value.nonce:null};
  }catch{
    try{storage.removeItem(key)}catch{}
    return {enabled:false,text:'',nonce:null};
  }
}
export function writeAirDraft(storage:DraftStorage,userId:string,endpoint:string,text:string,
  now=Date.now(),nonce:string|null=null){
  if(text.length>2000)return false;
  try{
    storage.setItem(keyFor(userId,endpoint),JSON.stringify({
      enabled:true,text,expires:now+AIR_DRAFT_TTL_MS,nonce
    }));
    return true;
  }catch{return false}
}
export function clearAirDraft(storage:DraftStorage,userId:string,endpoint:string){
  try{storage.removeItem(keyFor(userId,endpoint))}catch{}
}
