import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden, notFound } from '../http/router.ts';
import { config } from '../config.ts';

export type QuoteInput = {company:string;product:string;premiumKopecks:number;description:string;coverage:string};
type CaseRow = {id:string;owner_id:string;requested_by:string;vehicle_id:string;kind:string;
  assigned_to:string|null;status:string;insurance_stage:string|null;insurance_choice_id:string|null};
const canAgent=(user:AuthUser,r:CaseRow)=>user.roles.includes('insurer')&&r.assigned_to===user.id;
const isStaff=(user:AuthUser)=>user.roles.includes('admin')||user.roles.includes('moderator');
const key=()=>createHash('sha256').update('traksos-insurance-policy:'+ (process.env.DOCS_KEY ?? config.secret)).digest();
const asBuf=(v:unknown)=>Buffer.isBuffer(v)?v:typeof v==='string'&&v.startsWith('\\x')?Buffer.from(v.slice(2),'hex'):Buffer.alloc(0);
const pgBytes=(buf:Buffer)=>'\\x'+buf.toString('hex');

export class InsuranceQuoteFlow {
  constructor(private db:Db) {}

  async agents() {
    // Names only: no private phones, emails, documents or insurance credentials.
    return this.db.query<{id:string;name:string}>(
      `select id, coalesce(nullif(company_name,''),nullif(name,''),'Страховой партнёр') as name
         from users where 'insurer'=any(roles) and status='active'
         order by name, id limit 100`);
  }

  private async case(q:Queryable,id:string):Promise<CaseRow> {
    const r=await q.one<CaseRow>(
      `select id,owner_id,requested_by,vehicle_id,kind,assigned_to,status,insurance_stage,insurance_choice_id
         from vehicle_service_requests where id=$1`,[id]);
    if(!r||r.kind!=='insurance')throw notFound('Страховая заявка не найдена');
    return r;
  }

  private async clientAccess(q:Queryable,user:AuthUser,r:CaseRow) {
    if(r.owner_id===user.id)return true;
    if(r.requested_by!==user.id||user.owner_id!==r.owner_id)return false;
    const right=await q.one<{id:string}>(`select v.id from vehicles v join users o on o.id=v.owner_id
      where v.id=$1 and v.owner_id=$2 and v.driver_id=$3
        and (o.fleet->'allow'->>'insurance')::boolean is true`,[r.vehicle_id,r.owner_id,user.id]);
    return !!right;
  }
  private async access(q:Queryable,user:AuthUser,r:CaseRow) {
    const isClient=await this.clientAccess(q,user,r);
    const isPartner=canAgent(user,r);
    if(!isClient&&!isPartner&&!isStaff(user))throw forbidden('Нет доступа к этой страховой заявке');
    return {isClient,isPartner};
  }

  async detail(user:AuthUser,id:string) {
    const r=await this.case(this.db,id);
    const permissions=await this.access(this.db,user,r);
    const request=await this.db.one(`select r.id,r.owner_id,r.requested_by,r.assigned_to,r.kind,r.status,r.insurance_stage,r.insurance_details,
      r.insurance_choice_id,r.created_at,r.updated_at,r.policy_expires_on,r.comment,
      v.brand,v.model,v.year,v.plate,
      coalesce(nullif(agent.company_name,''),nullif(agent.name,''),'Страховой партнёр') as agent_name
      from vehicle_service_requests r join vehicles v on v.id=r.vehicle_id
      left join users agent on agent.id=r.assigned_to where r.id=$1`,[id]);
    if(!request)throw notFound('Страховая заявка не найдена');
    const proposals=await this.db.query(`select id,company,product,premium_kopecks,description,coverage,created_at
      from insurance_proposals where request_id=$1 order by premium_kopecks asc,company,id`,[id]);
    const messages=await this.db.query(`select m.id,m.kind,m.body,m.created_at,
      case when m.sender_id=$2 then 'you' when m.sender_id=$3 then 'agent' else 'system' end as sender
      from insurance_thread_messages m
      join vehicle_service_requests r on r.id=m.request_id
      where m.request_id=$1 order by m.id`,[id,user.id,r.assigned_to]);
    const hasPolicy=await this.db.one<{has:boolean}>(
      `select exists(select 1 from insurance_policy_files where request_id=$1) as has`,[id]);
    return {request,proposals,messages,hasPolicy:hasPolicy?.has??false,...permissions};
  }

  async accept(user:AuthUser,id:string) {
    return this.db.tx(async q=>{
      const r=await this.case(q,id);
      if(!canAgent(user,r))throw forbidden('Только назначенный страховой агент может принять заявку');
      if(r.status!=='sent_to_partner')throw bad('closed','Заявка закрыта');
      const target=r.insurance_stage==='received'?'preparing':r.insurance_stage==='selected'?'processing':null;
      if(!target)throw bad('invalid_stage','Заявка сейчас не ожидает принятия в работу');
      await q.query('update vehicle_service_requests set insurance_stage=$2,updated_at=now() where id=$1',[id,target]);
      await q.query(`insert into insurance_thread_messages(request_id,sender_id,kind,body) values ($1,$2,'status',$3)`,
        [id,user.id,target==='preparing'?'Принято в работу: подготовка предложений':'Принято в работу: оформление выбранного полиса']);
      return {stage:target};
    });
  }

  async publish(user:AuthUser,id:string,offers:QuoteInput[]) {
    if(!Array.isArray(offers)||offers.length===0||offers.length>20)
      throw bad('offer_count','От одного до двадцати предложений за заявку');
    for(const offer of offers) {
      if(!offer.company?.trim()||!offer.product?.trim()||!Number.isInteger(offer.premiumKopecks)
        ||offer.premiumKopecks<=0||offer.premiumKopecks>1_000_000_000)
        throw bad('invalid_offer','Укажите компанию, продукт и стоимость предложения');
    }
    return this.db.tx(async q=>{
      const r=await this.case(q,id);
      if(!canAgent(user,r))throw forbidden('Только назначенный агент может отправлять предложения');
      if(r.status!=='sent_to_partner')throw bad('closed','Заявка закрыта');
      if(r.insurance_stage!=='preparing')throw bad('invalid_stage','Сначала примите заявку в работу');
      const count=await q.one<{n:number}>('select count(*)::int as n from insurance_proposals where request_id=$1',[id]);
      if((count?.n??0)!==0)throw bad('offers_already_sent','Предложения уже отправлены');
      for(const o of offers)await q.query(
        `insert into insurance_proposals(request_id,company,product,premium_kopecks,description,coverage)
          values ($1,$2,$3,$4,$5,$6)`,
        [id,o.company.trim(),o.product.trim(),o.premiumKopecks,o.description.trim(),o.coverage.trim()]);
      await q.query(`update vehicle_service_requests set insurance_stage='offers_sent',updated_at=now() where id=$1`,[id]);
      await q.query(`insert into insurance_thread_messages(request_id,sender_id,kind,body)
        values ($1,$2,'offers',$3)`,[id,user.id,'Подготовлено предложений: '+offers.length]);
      return {stage:'offers_sent',count:offers.length};
    });
  }

  async choose(user:AuthUser,id:string,proposalId:string) {
    return this.db.tx(async q=>{
      const r=await this.case(q,id);
      if(!await this.clientAccess(q,user,r))throw forbidden('Выбирать страховой полис может только заявитель');
      if(r.status!=='sent_to_partner')throw bad('closed','Заявка закрыта');
      if(r.insurance_stage!=='offers_sent')throw bad('invalid_stage','Предложения пока не готовы или выбор уже сделан');
      const choice=await q.one<{company:string;product:string}>(
        'select company,product from insurance_proposals where id=$1 and request_id=$2',[proposalId,id]);
      if(!choice)throw bad('unknown_offer','Предложение не найдено');
      await q.query(`update vehicle_service_requests set insurance_choice_id=$2,insurance_stage='selected',updated_at=now()
         where id=$1`,[id,proposalId]);
      await q.query(`insert into insurance_thread_messages(request_id,sender_id,kind,body)
        values ($1,$2,'selection',$3)`,[id,user.id,choice.company+' · '+choice.product+' — клиент выбрал «Оформить»']);
      return {stage:'selected',proposalId};
    });
  }

  async message(user:AuthUser,id:string,text:string) {
    const message=text.trim();
    if(message.length<1||message.length>2000)throw bad('invalid_message','Сообщение должно быть от 1 до 2000 символов');
    return this.db.tx(async q=>{
      const r=await this.case(q,id);
      const allowed=await this.access(q,user,r);
      if(!allowed.isClient&&!allowed.isPartner)throw forbidden('Сотрудник может наблюдать заявку, но не писать от имени агента или клиента');
      if(['cancelled','rejected'].includes(r.status))throw bad('closed','Заявка закрыта');
      return q.one(`insert into insurance_thread_messages(request_id,sender_id,kind,body)
        values($1,$2,'message',$3) returning id,body,kind,created_at`,[id,user.id,message]);
    });
  }

  async uploadPolicy(user:AuthUser,id:string,dataUrl:string,fileName:string,expiresOn:string) {
    const m=/^data:application\/pdf;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
    if(!m)throw bad('invalid_file','Загрузите документ PDF');
    const bytes=Buffer.from(m[1],'base64');
    if(bytes.length<100||bytes.length>4*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')
      throw bad('invalid_file','Нужен настоящий PDF размером до 4 МБ');
    const parsedDate=new Date(expiresOn+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)||expiresOn<=new Date().toISOString().slice(0,10)||
       !Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==expiresOn)
      throw bad('invalid_expiry','Укажите корректный будущий срок действия полиса');
    const safeName=(fileName||'policy.pdf').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,90);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
    const enc=Buffer.concat([cipher.update(bytes),cipher.final()]),tag=cipher.getAuthTag();
    return this.db.tx(async q=>{
      const r=await this.case(q,id);
      if(!canAgent(user,r))throw forbidden('Только назначенный агент может передать полис');
      if(r.status!=='sent_to_partner')throw bad('closed','Заявка закрыта');
      if(r.insurance_stage!=='processing')throw bad('invalid_stage','Сначала примите выбранный вариант в работу');
      const current=await q.one<{id:string}>(`select id from insurance_proposals where id=$1 and request_id=$2`,
        [r.insurance_choice_id,id]);
      if(!current)throw bad('missing_choice','Клиент ещё не выбрал предложение');
      await q.query(`insert into insurance_policy_files(request_id,mime,file_name,iv,tag,data)
        values ($1,'application/pdf',$2,$3,$4,$5)`,
        [id,safeName,pgBytes(iv),pgBytes(tag),pgBytes(enc)]);
      await q.query(`update vehicle_service_requests set status='completed',insurance_stage='policy_sent',
        policy_expires_on=$2::date,updated_at=now() where id=$1`,[id,expiresOn]);
      await q.query(`insert into insurance_thread_messages(request_id,sender_id,kind,body)
        values ($1,$2,'policy','Готовый PDF-полис доступен в этой переписке')`,[id,user.id]);
      return {stage:'policy_sent',status:'completed'};
    });
  }

  async downloadPolicy(user:AuthUser,id:string) {
    const r=await this.case(this.db,id);
    await this.access(this.db,user,r);
    const file=await this.db.one<any>(`select file_name,iv,tag,data from insurance_policy_files
      where request_id=$1`,[id]);
    if(!file)throw notFound('Полис ещё не загружен');
    const decipher=createDecipheriv('aes-256-gcm',key(),asBuf(file.iv));
    decipher.setAuthTag(asBuf(file.tag));
    const body=Buffer.concat([decipher.update(asBuf(file.data)),decipher.final()]);
    return {body,name:String(file.file_name)};
  }
}
