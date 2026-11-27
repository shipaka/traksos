import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, parse, type AuthUser } from '../http/router.ts';

const siteId=z.string().regex(/^directory:[a-z0-9-]+$/).max(120);
const category=z.enum(['sto','tyre','wash','refrigeration','trailer']);
const input=z.object({
 id:siteId, name:z.string().trim().min(1).max(200), address:z.string().trim().min(5).max(400),
 phone:z.string().regex(/^\+7\d{10}$/), category,
 lat:z.number().finite().min(-85).max(85).nullable(), lng:z.number().finite().min(-180).max(180).nullable(),
 services:z.array(z.string().trim().min(1).max(160)).min(1).max(30),
 hours:z.string().trim().max(200).nullable(),
 source:z.string().url().max(1000).refine(s=>/^https?:\/\//i.test(s)),
}).strict().refine(p=>(p.lat===null)===(p.lng===null)&&!(p.lat===0&&p.lng===0),'Проверьте координаты');
const review=z.object({revision:z.number().int().positive(),state:z.enum(['draft','published','hidden']),sourceReuseChecked:z.boolean(),locationChecked:z.boolean()}).strict();
const vote=z.object({verdict:z.enum(['working','not_working'])}).strict();
export class StoDirectory {
 constructor(private db:Db){}
 async publicList(){
  const points=await this.db.query(`select id,'service' as kind,true as directory,name,address,phone,category,lat,lng,services,hours,source
    from sto_directory_sites where state='published' and source_reuse_checked and location_checked
    order by id limit 10000`);
  return {source:'independent_directory',points};
 }
 async adminList(after:string,limit:number){
  return {items:await this.db.query(`select s.*, 
   (select count(*)::int from sto_directory_feedback f join users u on u.id=f.user_id where f.site_id=s.id and f.verdict='working' and u.deleted_at is null and u.status='active') as working_reports,
   (select count(*)::int from sto_directory_feedback f join users u on u.id=f.user_id where f.site_id=s.id and f.verdict='not_working' and u.deleted_at is null and u.status='active') as not_working_reports
   from sto_directory_sites s where s.id>$1 order by s.id limit $2`,[after,limit])};
 }
 async create(body:unknown){
  const rows=parse(z.array(input).min(1).max(100),body);
  if(new Set(rows.map(p=>p.id)).size!==rows.length)throw bad('duplicate_id','Повтор идентификатора в пакете');
  return this.db.tx(async q=>{
   let inserted=0;
   for(const p of rows){const row=await q.one(`insert into sto_directory_sites(id,name,address,phone,category,lat,lng,services,hours,source)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) on conflict(id) do nothing returning id`,
     [p.id,p.name,p.address,p.phone,p.category,p.lat,p.lng,JSON.stringify(p.services),p.hours,p.source]);if(row)inserted++;}
   return {inserted,existing:rows.length-inserted};
  });
 }
 async edit(id:string,body:unknown){
  const key=parse(siteId,id);
  const p=parse(z.object({revision:z.number().int().positive(),site:input}).strict(),body);
  if(p.site.id!==key)throw bad('id_mismatch');
  return this.db.tx(async q=>{
   const current=await q.one<{revision:number}>('select revision from sto_directory_sites where id=$1 for update',[key]);
   if(!current)throw notFound();
   if(current.revision!==p.revision)throw conflict('stale_revision','Карточка уже изменена');
   const x=p.site;
   return q.one(`update sto_directory_sites set name=$2,address=$3,phone=$4,category=$5,lat=$6,lng=$7,services=$8::jsonb,hours=$9,source=$10,
      state='draft',source_reuse_checked=false,location_checked=false,reviewed_by=null,reviewed_at=null,revision=revision+1,updated_at=now()
      where id=$1 returning id,state,revision`,[key,x.name,x.address,x.phone,x.category,x.lat,x.lng,JSON.stringify(x.services),x.hours,x.source]);
  });
 }
 async review(id:string,user:AuthUser,body:unknown){
  const key=parse(siteId,id),p=parse(review,body);
  return this.db.tx(async q=>{
   const current=await q.one<{revision:number;lat:number|null;lng:number|null}>('select revision,lat,lng from sto_directory_sites where id=$1 for update',[key]);
   if(!current)throw notFound();
   if(current.revision!==p.revision)throw conflict('stale_revision','Карточка уже изменена');
   if(p.state==='published'&&(!p.sourceReuseChecked||!p.locationChecked||current.lat===null||current.lng===null))throw bad('review_required','Проверьте источник, право использования и координаты');
   return q.one(`update sto_directory_sites set state=$2,source_reuse_checked=$3,location_checked=$4,reviewed_by=$5,reviewed_at=now(),updated_at=now(),revision=revision+1
    where id=$1 returning id,state,revision`,[key,p.state,p.sourceReuseChecked,p.locationChecked,user.id]);
  });
 }
 async feedback(id:string,user:AuthUser,body:unknown){
  const key=parse(siteId,id),p=parse(vote,body);
  if(!user.roles.some(r=>r==='client'||r==='driver'))throw forbidden();
  return this.db.tx(async q=>{
   const active=await q.one("select id from users where id=$1 and status='active' and deleted_at is null for share",[user.id]);
   if(!active)throw forbidden();
   const site=await q.one("select id from sto_directory_sites where id=$1 and state='published' for share",[key]);
   if(!site)throw notFound();
   await q.query(`insert into sto_directory_feedback(site_id,user_id,verdict) values($1,$2,$3)
    on conflict(site_id,user_id) do update set verdict=excluded.verdict,updated_at=now()`,[key,user.id,p.verdict]);
   return {ok:true,verdict:p.verdict};
  });
 }
}
