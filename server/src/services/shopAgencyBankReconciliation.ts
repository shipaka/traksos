/**
 * ADMIN-ONLY internal reconciliation against manually normalized bank CSV.
 * An uploaded CSV is not a bank API confirmation or signed bank statement.
 * Nothing in this service posts funds, refunds or statutory tax income.
 */
import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';

type BankDirection = 'in' | 'out';
export type BankRow = {
  lineNo:number;transactionRef:string;occurredAt:string;
  direction:BankDirection;amount:number;note:string;
};
type ImportInput = {bankName:string;accountRef:string;filename:string;base64:string};
const directions:Record<string,BankDirection> = {
  customer_receipt:'in', supplier_refund:'in', supplier_payment_reversal:'in',
  supplier_payment:'out', customer_refund:'out', customer_receipt_reversal:'out',
};
function adminOnly(actor:AuthUser) {
  if(!actor.roles?.includes('admin'))throw forbidden('Банковская сверка доступна только администратору');
}
function validateNote(note:string) {
  if(typeof note!=='string'||note.trim().length<8||note.trim().length>1000)
    throw bad('bank_note_required','Нужно осмысленное основание (8–1000 символов)');
  return note.trim();
}
function strictInstant(v:string):string {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))
    throw bad('bank_bad_timestamp','В CSV нужен ISO-8601 с явным часовым поясом');
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v)!;
  const dateOnly=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  if(dateOnly.getUTCFullYear()!==+m[1]||dateOnly.getUTCMonth()+1!==+m[2]||
    dateOnly.getUTCDate()!==+m[3]||!Number.isFinite(Date.parse(v)))
    throw bad('bank_bad_timestamp','Дата банковской операции недействительна');
  return new Date(v).toISOString();
}
/** Strict semicolon format, single physical line per transaction.
 * Doubled quotes are permitted; newline inside a quoted field is forbidden.
 * Import is normalized by an operator; this parser does NOT recognize
 * arbitrary vendor bank statement schemas. */
function parseFields(line:string):string[] {
  const fields:string[]=[];
  let value='',quoted=false,closed=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(quoted){
      if(char==='"'&&line[i+1]==='"'){value+='"';i++;}
      else if(char==='"'){quoted=false;closed=true;}
      else value+=char;
    }else if(char===';'){fields.push(value);value='';closed=false;}
    else if(char==='"'&&!value&&!closed){quoted=true;}
    else if(char==='"'||closed)throw bad('bank_bad_csv','Неверное экранирование кавычек в CSV');
    else value+=char;
  }
  if(quoted)throw bad('bank_bad_csv','Многострочные значения CSV не поддерживаются');
  fields.push(value);
  return fields;
}
export function parseNormalizedBankCsv(csv:string):BankRow[] {
  if(typeof csv!=='string'||csv.length>450_000)
    throw bad('bank_bad_csv','Файл должен быть текстовым CSV до 450 КБ');
  if(csv.includes('\0')||csv.includes('\uFFFD')||csv.includes('\u2028'))
    throw bad('bank_bad_csv','Недопустимые символы CSV');
  const lines=csv.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  if(lines.at(-1)==='')lines.pop();
  if(!lines.length||lines[0]!=='transaction_ref;occurred_at;direction;amount_kopecks;note')
    throw bad('bank_bad_header',
      'Ожидаются колонки transaction_ref;occurred_at;direction;amount_kopecks;note');
  if(lines.length<2||lines.length>1001)
    throw bad('bank_bad_rows','Нужно от 1 до 1000 банковских строк');
  const used=new Set<string>();
  return lines.slice(1).map((raw,i)=>{
    const a=parseFields(raw);
    if(a.length!==5)throw bad('bank_bad_csv','В строке '+(i+2)+' требуется ровно 5 колонок');
    const [ref,at,dir,kop,note]=a.map(x=>x.trim());
    if(ref.length<2||ref.length>160||/[\x00-\x1f]/.test(ref))
      throw bad('bank_bad_reference','Некорректный банковский идентификатор, строка '+(i+2));
    if(used.has(ref))throw conflict('bank_duplicate_transaction','Повтор ID операции внутри CSV: '+ref);
    used.add(ref);
    if(dir!=='in'&&dir!=='out')
      throw bad('bank_bad_direction','Направление должно быть in или out, строка '+(i+2));
    if(!/^[1-9]\d{0,11}$/.test(kop)||!Number.isSafeInteger(Number(kop)))
      throw bad('bank_bad_amount','Нужна положительная сумма в копейках, строка '+(i+2));
    if(note.length>300||/[\x00-\x08\x0b-\x1f]/.test(note))
      throw bad('bank_bad_note','Описание слишком длинное или содержит управляющие символы');
    return {lineNo:i+2,transactionRef:ref,occurredAt:strictInstant(at),
      direction:dir,amount:Number(kop),note};
  });
}
function csvBytes(base64:string):Buffer {
  if(typeof base64!=='string'||base64.length>650_000||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw bad('bank_invalid_file','Передайте оригинальные байты CSV в Base64');
  const bytes=Buffer.from(base64,'base64');
  if(!bytes.length||bytes.length>450_000||
    bytes.toString('base64')!==base64)
    throw bad('bank_invalid_file','Размер CSV не должен превышать 450 КБ');
  return bytes;
}
export class ShopAgencyBankReconciliation {
  constructor(private db:Db) {}
  private audit(actor:AuthUser,action:string,target:string,data:unknown,db:Queryable=this.db){
    return db.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [actor.id,action,target,data]);
  }
  async importStatement(actor:AuthUser,b:ImportInput) {
    adminOnly(actor);
    const bankName=b.bankName?.trim(),accountRef=b.accountRef?.trim(),filename=b.filename?.trim();
    if(!bankName||bankName.length<2||bankName.length>160||
       !accountRef||accountRef.length<4||accountRef.length>100||
       !filename||filename.length>180||/[/\\\x00-\x1f]/.test(filename))
      throw bad('bank_import_metadata','Укажите банк, уникальный идентификатор счёта и имя CSV');
    const bytes=csvBytes(b.base64);
    let csv:string;
    try{csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch{throw bad('bank_bad_encoding','Нужен UTF-8 без повреждённых символов');}
    const rows=parseNormalizedBankCsv(csv);
    const hash=createHash('sha256').update(bytes).digest('hex');
    return this.db.tx(async q=>{
      const [newRow]=await q.query<any>(
        'insert into shop_agency_bank_statements '+
        '(bank_name,account_ref,filename,content_sha256,row_count,csv_data,created_by) '+
        'values($1,$2,$3,$4,$5,$6,$7) on conflict(content_sha256) do nothing '+
        'returning id,bank_name,account_ref,filename,row_count,content_sha256',
        [bankName,accountRef,filename,hash,rows.length,'\\x'+bytes.toString('hex'),actor.id]);
      const saved=newRow??await q.one<any>(
        'select id,bank_name,account_ref,filename,row_count,content_sha256 '+
        'from shop_agency_bank_statements where content_sha256=$1',[hash]);
      if(!saved)throw conflict('bank_import_race','Конкурентная загрузка банковской выписки');
      if(!newRow){
        if(saved.bank_name!==bankName||saved.account_ref!==accountRef||
           saved.filename!==filename||Number(saved.row_count)!==rows.length)
          throw conflict('bank_import_metadata_conflict',
            'Этот CSV уже сохранён с другими реквизитами');
        return {id:saved.id,sha256:hash,rows:rows.length,duplicate:true,
          source:'manual_unverified'};
      }
      const imported=await q.query<any>(
        'insert into shop_agency_bank_rows '+
        '(statement_id,account_ref,line_no,transaction_ref,occurred_at,direction,amount,note) '+
        'select $1::uuid,$2::text,x.line_no,x.transaction_ref,x.occurred_at,x.direction,x.amount,x.note '+
        'from unnest($3::int[],$4::text[],$5::timestamptz[],$6::text[],$7::bigint[],$8::text[]) '+
        'as x(line_no,transaction_ref,occurred_at,direction,amount,note) '+
        'on conflict (account_ref,transaction_ref) do nothing returning id',
        [saved.id,accountRef,rows.map(r=>r.lineNo),rows.map(r=>r.transactionRef),
          rows.map(r=>r.occurredAt),rows.map(r=>r.direction),rows.map(r=>r.amount),
          rows.map(r=>r.note)]);
      if(imported.length!==rows.length)
        throw conflict('bank_duplicate_transaction',
          'Такая операция уже импортирована по этому счёту; выписка отклонена целиком');
      await this.audit(actor,'shop.agency.bank_statement_import',saved.id,
        {bankName,accountRef,sha256:hash,rows:rows.length},q);
      return {id:saved.id,sha256:hash,rows:rows.length,duplicate:false,
        source:'manual_unverified'};
    });
  }
  async statements(actor:AuthUser){
    adminOnly(actor);
    const items=await this.db.query<any>(
      'select id,bank_name,account_ref,filename,content_sha256,row_count,created_at '+
      'from shop_agency_bank_statements order by created_at desc,id desc limit 100');
    await this.audit(actor,'shop.agency.bank_statement_list','index',{count:items.length});
    return items;
  }
  async statementRows(actor:AuthUser,id:string){
    adminOnly(actor);
    const parent=await this.db.one<any>(
      'select id,bank_name,account_ref,filename,content_sha256,row_count,created_at '+
      'from shop_agency_bank_statements where id=$1',[id]);
    if(!parent)throw notFound('Импорт банковских операций не найден');
    const rows=await this.db.query<any>(
      'select r.id,r.line_no,r.transaction_ref,r.occurred_at,r.direction,'+
      'r.amount,r.note,m.id as match_id,m.event_id,m.case_id '+
      'from shop_agency_bank_rows r left join shop_agency_bank_matches m '+
      'on m.row_id=r.id and not exists ('+
      'select 1 from shop_agency_bank_match_retractions t where t.match_id=m.id) '+
      'where r.statement_id=$1 order by r.line_no',[id]);
    await this.audit(actor,'shop.agency.bank_statement_read',id,{rows:rows.length});
    return {statement:parent,rows,matched:rows.filter(x=>x.match_id).length,
      unmatched:rows.filter(x=>!x.match_id).length,
      disclaimer:'Ручной CSV не является независимым банковским подтверждением; сверка не создаёт и не проводит платежи.'};
  }
  async caseMatches(actor:AuthUser,caseId:string){
    adminOnly(actor);
    const c=await this.db.one<any>('select id from shop_agency_cases where id=$1',[caseId]);
    if(!c)throw notFound('Агентская операция не найдена');
    const events=await this.db.query<any>(
      'select e.id as event_id,e.kind,e.amount,e.source_ref,e.occurred_at,'+
      'm.id as match_id,br.id as row_id,br.transaction_ref,br.direction,'+
      'br.amount as bank_amount,br.occurred_at as bank_occurred_at,'+
      'bs.bank_name,bs.account_ref,bs.content_sha256 '+
      'from shop_agency_events e left join shop_agency_bank_matches m '+
      'on m.event_id=e.id and not exists ('+
      'select 1 from shop_agency_bank_match_retractions t where t.match_id=m.id) '+
      'left join shop_agency_bank_rows br on br.id=m.row_id '+
      'left join shop_agency_bank_statements bs on bs.id=br.statement_id '+
      'where e.case_id=$1 and e.kind not in (\'handover\',\'agent_report\') '+
      'order by e.occurred_at,e.id',[caseId]);
    const matches=events.filter(e=>e.match_id).length;
    await this.audit(actor,'shop.agency.bank_case_read',caseId,{matches,total:events.length});
    return {caseId,events,matched:matches,unmatched:events.length-matches,
      disclaimer:'Совпадение с импортом CSV не заменяет проверку оригинала платёжного документа.'};
  }
  async match(actor:AuthUser,rowId:string,eventId:string,note:string) {
    adminOnly(actor);
    const explanation=validateNote(note);
    return this.db.tx(async q=>{
      const event=await q.one<any>(
        'select id,case_id,kind,amount,source_ref,occurred_at from shop_agency_events where id=$1',
        [eventId]);
      if(!event)throw notFound('Денежное событие не найдено');
      const c=await q.one<any>('select id from shop_agency_cases where id=$1 for update',[event.case_id]);
      if(!c)throw notFound('Агентская операция не найдена');
      const row=await q.one<any>(
        'select r.*,s.bank_name,s.account_ref as statement_account_ref '+
        'from shop_agency_bank_rows r join shop_agency_bank_statements s '+
        'on s.id=r.statement_id where r.id=$1 for update of r',[rowId]);
      if(!row)throw notFound('Банковская строка не найдена');
      const active=await q.one<any>(
        'select m.id,m.row_id,m.event_id from shop_agency_bank_matches m '+
        'where (m.row_id=$1 or m.event_id=$2) and not exists ('+
        'select 1 from shop_agency_bank_match_retractions t where t.match_id=m.id) '+
        'order by m.created_at desc limit 1',[rowId,eventId]);
      if(active) {
        if(active.row_id===rowId&&active.event_id===eventId)
          return {id:active.id,duplicate:true,caseId:event.case_id};
        throw conflict('bank_match_conflict','Банковская строка или платёж уже сопоставлены с другим событием');
      }
      const direction=directions[event.kind];
      if(!direction)throw bad('bank_not_cash_event','Нельзя сопоставлять неденежное событие');
      if(row.direction!==direction)throw conflict('bank_direction_mismatch','Выплата и поступление перепутаны');
      if(Number(row.amount)!==Number(event.amount))
        throw conflict('bank_amount_mismatch','Сумма копеек не совпадает с журналом');
      if(row.transaction_ref!==event.source_ref)
        throw conflict('bank_reference_mismatch',
          'Номер операции банка не совпадает с реквизитом денежного события');
      if(Math.abs(new Date(row.occurred_at).getTime()-
                  new Date(event.occurred_at).getTime())>7*86400_000)
        throw conflict('bank_time_mismatch','Разница дат банка и события более 7 дней');
      const proof=await q.one<any>(
        'select a.id from shop_agency_allocations a '+
        'join shop_agency_documents d on d.id=a.document_id '+
        'where a.case_id=$1 and d.kind=\'payment_proof\' '+
        'and d.source=\'manually_checked\' and d.reference=$2 limit 1',
        [event.case_id,event.source_ref]);
      if(!proof)throw conflict('bank_proof_missing',
        'Перед сверкой приложите и проверьте платёжный документ по этому реквизиту');
      const [created]=await q.query<any>(
        'insert into shop_agency_bank_matches(row_id,event_id,case_id,note,created_by) '+
        'values($1,$2,$3,$4,$5) returning id',
        [rowId,eventId,event.case_id,explanation,actor.id]);
      await q.query(
        'update shop_agency_cases set evidence_version=evidence_version+1 where id=$1',
        [event.case_id]);
      await this.audit(actor,'shop.agency.bank_match',created.id,
        {rowId,eventId,caseId:event.case_id},q);
      return {id:created.id,duplicate:false,caseId:event.case_id};
    });
  }
  async retract(actor:AuthUser,matchId:string,note:string) {
    adminOnly(actor);
    const explanation=validateNote(note);
    return this.db.tx(async q=>{
      const m=await q.one<any>(
        'select id,case_id,row_id,event_id from shop_agency_bank_matches where id=$1',
        [matchId]);
      if(!m)throw notFound('Связка банка и денежного события не найдена');
      await q.one('select id from shop_agency_cases where id=$1 for update',[m.case_id]);
      const old=await q.one<any>(
        'select id,note from shop_agency_bank_match_retractions where match_id=$1',[matchId]);
      if(old) {
        if(old.note!==explanation)throw conflict('bank_retraction_conflict',
          'Отмена уже зафиксирована с другим основанием');
        return {id:old.id,duplicate:true};
      }
      const [row]=await q.query<any>(
        'insert into shop_agency_bank_match_retractions(match_id,note,created_by) '+
        'values($1,$2,$3) returning id',[matchId,explanation,actor.id]);
      await q.query(
        'update shop_agency_cases set evidence_version=evidence_version+1 where id=$1',
        [m.case_id]);
      await this.audit(actor,'shop.agency.bank_match_retract',row.id,
        {matchId,caseId:m.case_id,reason:explanation},q);
      return {id:row.id,duplicate:false};
    });
  }
}
