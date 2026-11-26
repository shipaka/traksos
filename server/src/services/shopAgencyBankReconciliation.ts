/**
 * ADMIN-ONLY internal reconciliation against manually normalized bank CSV.
 * An uploaded CSV is not a bank API confirmation or signed bank statement.
 * Nothing in this service posts funds, refunds or statutory tax income.
 */
import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, notFound } from '../http/router.ts';
import { parseNormalizedBankCsv } from '../domain/shopAgencyBankCsv.ts';
import { requireAgencyAdmin } from './shopAgencyAccess.ts';
export { parseNormalizedBankCsv } from '../domain/shopAgencyBankCsv.ts';
export type { BankRow } from '../domain/shopAgencyBankCsv.ts';

type BankDirection = 'in' | 'out';
export const BANK_ACTIVITIES=['unmatched','traksos_service','traksos_shop','ip_primary','other'] as const;
export type BankActivity=typeof BANK_ACTIVITIES[number];
type ImportInput = {bankName:string;accountRef:string;filename:string;base64:string};
const directions:Record<string,BankDirection> = {
  customer_receipt:'in', supplier_refund:'in', supplier_payment_reversal:'in',
  supplier_payment:'out', customer_refund:'out', customer_receipt_reversal:'out',
};
function validateNote(note:string) {
  if(typeof note!=='string'||note.trim().length<8||note.trim().length>1000)
    throw bad('bank_note_required','Нужно осмысленное основание (8–1000 символов)');
  return note.trim();
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
    await requireAgencyAdmin(this.db,actor);
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
      await requireAgencyAdmin(q,actor,true);
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
    await requireAgencyAdmin(this.db,actor);
    const items=await this.db.query<any>(
      'select id,bank_name,account_ref,filename,content_sha256,row_count,created_at '+
      'from shop_agency_bank_statements order by created_at desc,id desc limit 100');
    await this.audit(actor,'shop.agency.bank_statement_list','index',{count:items.length});
    return items;
  }
  async statementRows(actor:AuthUser,id:string){
    await requireAgencyAdmin(this.db,actor);
    const parent=await this.db.one<any>(
      'select id,bank_name,account_ref,filename,content_sha256,row_count,created_at '+
      'from shop_agency_bank_statements where id=$1',[id]);
    if(!parent)throw notFound('Импорт банковских операций не найден');
    const rows=await this.db.query<any>(
      'select r.id,r.line_no,r.transaction_ref,r.occurred_at,r.direction,'+
      'r.amount,r.note,coalesce(c.activity,\'unmatched\') as activity,c.id as classification_id,m.id as match_id,m.event_id,m.case_id '+
      'from shop_agency_bank_rows r left join lateral (select id,activity from shop_agency_bank_classifications where row_id=r.id order by revision desc limit 1) c on true '+
      'left join shop_agency_bank_matches m '+
      'on m.row_id=r.id and not exists ('+
      'select 1 from shop_agency_bank_match_retractions t where t.match_id=m.id) '+
      'where r.statement_id=$1 order by r.line_no',[id]);
    await this.audit(actor,'shop.agency.bank_statement_read',id,{rows:rows.length});
    return {statement:parent,rows,matched:rows.filter(x=>x.match_id).length,
      unmatched:rows.filter(x=>!x.match_id).length,
      unclassified:rows.filter(x=>x.activity==='unmatched').length,
      disclaimer:'Ручной CSV не является независимым банковским подтверждением; сверка не создаёт и не проводит платежи.'};
  }
  /** Explicit, append-only classification. Never infer an activity from the
   * amount or a free-text description. Classification is not bank verification. */
  async classify(actor:AuthUser,rowId:string,b:{activity:BankActivity;note:string;requestKey:string}){
    await requireAgencyAdmin(this.db,actor);
    const explanation=validateNote(b.note);
    const key=b.requestKey?.trim();
    if(!BANK_ACTIVITIES.includes(b.activity)||!key||key.length<8||key.length>120)
      throw bad('bank_activity_invalid','Укажите вид деятельности и уникальный ключ изменения');
    return this.db.tx(async q=>{
      await requireAgencyAdmin(q,actor,true);
      const row=await q.one<{id:string}>('select id from shop_agency_bank_rows where id=$1 for update',[rowId]);
      if(!row)throw notFound('Банковская строка не найдена');
      const saved=await q.one<any>('select id,activity,note,revision from shop_agency_bank_classifications where row_id=$1 and request_key=$2',[rowId,key]);
      if(saved){
        if(saved.activity!==b.activity||saved.note!==explanation)
          throw conflict('bank_classification_key_conflict','Ключ изменения уже относится к другим данным');
        return {id:saved.id,activity:saved.activity,revision:Number(saved.revision),duplicate:true};
      }
      const active=await q.one('select m.id from shop_agency_bank_matches m where m.row_id=$1 and not exists (select 1 from shop_agency_bank_match_retractions t where t.match_id=m.id)',[rowId]);
      if(active)throw conflict('bank_classification_matched','Сначала отмените действующую сверку с указанием причины');
      const previous=await q.one<any>('select activity,revision from shop_agency_bank_classifications where row_id=$1 order by revision desc limit 1',[rowId]);
      const [created]=await q.query<any>(
        'insert into shop_agency_bank_classifications(row_id,activity,note,request_key,revision,created_by) values($1,$2,$3,$4,$5,$6) returning id,activity,revision',
        [rowId,b.activity,explanation,key,Number(previous?.revision??0)+1,actor.id]);
      await this.audit(actor,'shop.agency.bank_classify',created.id,{rowId,from:previous?.activity??'unmatched',to:b.activity,revision:created.revision},q);
      return {id:created.id,activity:created.activity,revision:Number(created.revision),duplicate:false};
    });
  }
  async classificationHistory(actor:AuthUser,rowId:string){
    await requireAgencyAdmin(this.db,actor);
    const row=await this.db.one('select id from shop_agency_bank_rows where id=$1',[rowId]);
    if(!row)throw notFound('Банковская строка не найдена');
    const revisions=await this.db.query<any>('select id,activity,note,revision,created_by,created_at from shop_agency_bank_classifications where row_id=$1 order by revision',[rowId]);
    await this.audit(actor,'shop.agency.bank_classification_read',rowId,{count:revisions.length});
    return {rowId,activity:revisions.at(-1)?.activity??'unmatched',revisions};
  }
  async caseMatches(actor:AuthUser,caseId:string){
    await requireAgencyAdmin(this.db,actor);
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
    await requireAgencyAdmin(this.db,actor);
    const explanation=validateNote(note);
    return this.db.tx(async q=>{
      await requireAgencyAdmin(q,actor,true);
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
      const classification=await q.one<{activity:BankActivity}>('select activity from shop_agency_bank_classifications where row_id=$1 order by revision desc limit 1',[rowId]);
      if(classification?.activity!=='traksos_shop')
        throw conflict('bank_activity_mismatch','Для сверки агентской закупки явно отнесите операцию к магазину TrakSOS');
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
    await requireAgencyAdmin(this.db,actor);
    const explanation=validateNote(note);
    return this.db.tx(async q=>{
      await requireAgencyAdmin(q,actor,true);
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
