/**
 * Shared integrity rules for the two public, price-free local part indexes.
 * No VIN, availability, order or personal information is cached.
 */
export interface IndexCheckpoint {
  key:'index';
  schema:number;
  revision:string;
  cursor:string|null;
  complete:boolean;
  count:number;
}
const DECIMAL=/^(0|[1-9]\d{0,18})$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEQUENCE=9223372036854775807n;
const invalid=()=>new Error('Получен некорректный ответ справочника. Повторите синхронизацию.');

export function validRevision(value:unknown):value is string {
  return typeof value==='string'&&DECIMAL.test(value)&&BigInt(value)<=MAX_SEQUENCE;
}

export function validCheckpoint(value:unknown,schema:number):value is IndexCheckpoint {
  if(!value||typeof value!=='object')return false;
  const m=value as Partial<IndexCheckpoint>;
  return m.key==='index'&&m.schema===schema&&validRevision(m.revision)&&
    typeof m.complete==='boolean'&&Number.isSafeInteger(m.count)&&
    (m.count as number)>=0&&
    (m.complete ? m.cursor===null : typeof m.cursor==='string'&&UUID.test(m.cursor));
}

/** Compare the meta snapshot read before a network request with the value
 * INSIDE the write transaction. A stale tab must not roll back the cursor. */
export function sameCheckpoint(a:unknown,b:unknown):boolean {
  if(a==null||b==null)return a==null&&b==null;
  if(typeof a!=='object'||typeof b!=='object')return false;
  const left=a as Partial<IndexCheckpoint>,right=b as Partial<IndexCheckpoint>;
  return left.key===right.key&&left.schema===right.schema&&
    left.revision===right.revision&&left.cursor===right.cursor&&
    left.complete===right.complete&&left.count===right.count;
}

function validPartRecord(row:unknown):boolean {
  if(!Array.isArray(row)||row.length!==6)return false;
  const [id,category,brand,article,name,aliases]=row;
  return typeof id==='string'&&UUID.test(id)&&
    typeof category==='string'&&!!category.trim()&&
    typeof name==='string'&&!!name.trim()&&
    [brand,article,aliases].every(x=>x===null||typeof x==='string');
}

export function assertSnapshotPage(rows:unknown,next:unknown,after:string|null):asserts rows is unknown[][] {
  if(!Array.isArray(rows)||!rows.every(validPartRecord)||
    !(next===null||(typeof next==='string'&&UUID.test(next))))
    throw invalid();
  const typed=rows as unknown[][];
  if(after!==null&&(!UUID.test(after)||typed.some(r=>String(r[0])<=after)))throw invalid();
  if(next!==null&&(!typed.length||typed[typed.length-1][0]!==next))throw invalid();
}

export function assertDeltaPage(rows:unknown,next:unknown,revision:unknown,after:string):
  asserts rows is unknown[][] {
  if(!validRevision(after)||!validRevision(revision)||
    BigInt(revision)<BigInt(after)||!Array.isArray(rows)||
    !(next===null||validRevision(next)))throw invalid();
  const typed=rows as unknown[][];
  let seq=BigInt(after);
  for(const line of typed){
    if(!Array.isArray(line)||!validRevision(line[0])||
      BigInt(line[0])<=seq||BigInt(line[0])>BigInt(revision))throw invalid();
    seq=BigInt(line[0]);
    const isDeletion=line.length===2&&typeof line[1]==='string'&&UUID.test(line[1]);
    const isUpdate=line.length===7&&validPartRecord(line.slice(1));
    if(!isDeletion&&!isUpdate)throw invalid();
  }
  if(next!==null&&(!typed.length||next!==typed[typed.length-1][0]))throw invalid();
}
