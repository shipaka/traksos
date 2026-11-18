import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx, AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound, parse } from '../http/router.ts';

const isStaff=(u:AuthUser)=>u.roles.includes('admin')||u.roles.includes('moderator');
const hasRole=(u:AuthUser)=>u.roles.some(r=>['master','tow','service','insurer'].includes(r));
const phone=/(?:\+?\d[\s().-]*){10,}/u;
const contact=/(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/|wa\.me\/|@[\p{L}\p{N}._-]{3,})/iu;
const forbiddenContact=(text:string)=>phone.test(text)||contact.test(text);
const id=z.string().uuid();
const create=z.object({
  displayName:z.string().trim().min(3).max(80),
  title:z.string().trim().min(6).max(90),
  description:z.string().trim().min(15).max(700),
  region:z.string().trim().min(2).max(80),
});
const review=z.object({
  decision:z.enum(['published','rejected','hidden']),
  reason:z.string().trim().min(8).max(500),
});
type Category='master'|'tow'|'service'|'insurer';

/** Advertising must never grant access to driver-only chat, private messages or GPS. */
async function partnerCategory(db:Db,user:AuthUser):Promise<Category>{
  if(user.status!=='active'||!hasRole(user))throw forbidden('Размещение доступно только партнёрам TrackSOS');
  if(user.roles.includes('master')||user.roles.includes('tow')||user.roles.includes('service')){
    const p=await db.one<{kind:string;verification:string}>(
      'select kind,verification from performer_profiles where user_id=$1',[user.id]);
    if(p?.verification==='approved'){
      if(user.roles.includes('service')||p.kind==='service')return 'service';
      if(user.roles.includes('tow')||p.kind==='tow')return 'tow';
      return 'master';
    }
    if(!user.roles.includes('insurer'))throw forbidden('Перед публикацией подтвердите профиль исполнителя');
  }
  // Insurers are assigned a distinct role by administrators, not self-registered
  // via the performer verification path.
  if(user.roles.includes('insurer'))return 'insurer';
  throw forbidden('Сначала подтвердите профиль партнёра');
}
const visibleSelect=`select o.id,o.category,o.display_name as "displayName",
  o.title,o.description,o.region_label as region,o.published_at as "publishedAt",
  o.expires_at as "expiresAt",o.status
  from community_partner_offers o`;

/**
 * Partner offers have their own moderation queue and no links to the driver's
 * private community messages. No ad is visible without human approval.
 */
export function registerCommunityPartnerOfferRoutes(r:Router,db:Db,now:()=>Date=()=>new Date()){
  r.get('/api/community/partner-offers',true,async(c:AuthedCtx)=>{
    if(c.user.status!=='active')throw forbidden();
    // No GPS-driven advertising. The chosen region is a label only.
    return {offers:await db.query(`
      ${visibleSelect}
      where o.status='published' and o.published_at<=$1 and o.expires_at>$1
      order by o.published_at desc,o.id desc limit 60`,[now()])};
  });

  r.get('/api/community/partner-offers/mine',true,async(c:AuthedCtx)=>{
    await partnerCategory(db,c.user);
    return {offers:await db.query(`
      ${visibleSelect}
      where o.partner_id=$1 order by o.created_at desc limit 30`,[c.user.id])};
  });

  r.post('/api/community/partner-offers',true,async(c:AuthedCtx)=>{
    const input=parse(create,c.body);
    for(const str of Object.values(input)){
      if(forbiddenContact(str))throw bad('contact_not_allowed',
        'В публичном предложении не размещайте телефон, ссылку или контактный ник. Общение — через TrackSOS.');
    }
    return db.tx(async q=>{
      // A user row lock serializes parallel submissions, preventing rate bypass.
      const account=await q.one('select id from users where id=$1 and status=$2 and deleted_at is null for update',[c.user.id,'active']);
      if(!account)throw forbidden();
      const category=await partnerCategory(db,c.user);
      const recent=await q.one<{count:number}>(`select count(*)::int as count
        from community_partner_offers where partner_id=$1 and created_at>$2`,
        [c.user.id,new Date(now().getTime()-7*86400000)]);
      if((recent?.count??0)>=2)throw conflict('post_limit','Можно подать не более двух предложений за 7 дней');
      const row=await q.one<{id:string;status:string}>(`insert into
        community_partner_offers(partner_id,category,display_name,title,description,region_label,created_at)
        values ($1,$2,$3,$4,$5,$6,$7) returning id,status`,
        [c.user.id,category,input.displayName,input.title,input.description,input.region,now()]);
      await q.query(`insert into audit_log(actor_id,action,target,data) values
        ($1,'community.partner_offer_submitted',$2,$3)`,
        [c.user.id,row!.id,{category,region:input.region}]);
      return {id:row!.id,status:row!.status};
    });
  });

  r.get('/api/admin/community/partner-offers', ['admin','moderator'],async(c:AuthedCtx)=>{
    const status=c.query.get('status')==='all'?'all':'pending';
    return {offers:await db.query(`
      select o.id,o.category,o.display_name as "displayName",o.title,
        o.description,o.region_label as region,o.status,o.created_at as "createdAt",
        o.published_at as "publishedAt",o.expires_at as "expiresAt"
      from community_partner_offers o
      where ($1::text='all' or o.status='pending')
      order by case when o.status='pending' then 0 else 1 end, o.created_at desc limit 100`,[status])};
  });

  r.post('/api/admin/community/partner-offers/:id/review',['admin','moderator'],async(c:AuthedCtx)=>{
    const offerId=parse(id,c.params.id),input=parse(review,c.body);
    return db.tx(async q=>{
      const existing=await q.one<{status:string}>(`
        select status from community_partner_offers where id=$1 for update`,[offerId]);
      if(!existing)throw notFound('Предложение не найдено');
      if(input.decision==='published'&&existing.status!=='pending')
        throw conflict('not_pending','Опубликовать можно только предложение на модерации');
      if(input.decision==='rejected'&&existing.status!=='pending')
        throw conflict('not_pending','Отклонить можно только предложение на модерации');
      if(input.decision==='hidden'&&existing.status!=='published')
        throw conflict('not_published','Скрыть можно только опубликованное предложение');
      const published=input.decision==='published';
      const row=await q.one<{id:string;status:string}>(`update community_partner_offers
        set status=$2,reviewed_by=$3,reviewed_at=$4,moderation_note=$5,
          published_at=case when $6::boolean then $4::timestamptz else published_at end,
          expires_at=case when $6::boolean then $4::timestamptz+interval '7 days' else expires_at end
        where id=$1 returning id,status`,[offerId,input.decision,c.user.id,now(),input.reason,published]);
      await q.query(`insert into audit_log(actor_id,action,target,data)
        values ($1,'community.partner_offer_review',$2,$3)`,
        [c.user.id,offerId,{from:existing.status,to:input.decision,reason:input.reason}]);
      return row;
    });
  });
}
