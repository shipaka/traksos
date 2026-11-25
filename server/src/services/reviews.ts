import type { Db, Queryable } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { authorWeight, weightedRating } from '../domain/rating.ts';

export const REVIEW_TAGS = {
  aboutPerformer: ['Приехал быстро', 'Решил проблему', 'Вежливый', 'Цена как договорились', 'Опоздал', 'Не решил проблему', 'Цена выросла'],
  aboutClient: ['Оплатил сразу', 'Машина была на месте', 'Задержал оплату', 'Спорил о времени', 'Пришлось ждать', 'Без пропуска на завод'],
};

export class ReviewsService {
  constructor(private db: Db, private settings: SettingsService, private orders: OrdersService) {}


  private async currentAuthor(q: Queryable, user: AuthUser) {
    const current = await q.one<{roles:string[]; rating:string|null; rating_count:number}>(
      "select roles,rating,rating_count from users where id=$1 and status='active' and deleted_at is null for share",
      [user.id]);
    if (!current) throw forbidden();
    return {...current,roles:user.roles.filter(role=>current.roles.includes(role))};
  }

  async leave(user: AuthUser, orderId: string, r: { stars: number; tags?: string[]; text?: string }) {
    const o = await this.orders.mustSee(user, orderId);
    if (o.status !== 'completed') throw bad('not_completed', 'Отзыв — после подтверждения суммы');
    const actor = this.orders.actorOf(user, o);
    let target: string;
    if (actor === 'client') target = o.performer_id;
    else if (actor === 'performer') target = o.client_id;
    else throw forbidden('Отзыв оставляют участники заявки');

    const settings = await this.settings.get('reviews');
    // A review, recalculated reputation and the immutable order event are one
    // action. Serialize ratings for the same target across different orders.
    try {
      return await this.db.tx(async q=>{
        const current=await q.one<{status:string;client_id:string;created_by:string;
          performer_id:string|null;vehicle_id:string|null}>(
          'select status,client_id,created_by,performer_id,vehicle_id from orders where id=$1 for share',
          [orderId]);
        if(!current||current.status!=='completed'||current.performer_id!==o.performer_id||
           current.client_id!==o.client_id)
          throw conflict('review_order_changed','Заявка изменилась, откройте её заново');
        const author=await this.currentAuthor(q,user);
        if(author.roles.some(role=>role==='admin'||role==='moderator'))
          throw forbidden('Отзыв оставляют участники заявки');
        const weight=authorWeight(settings,author.rating==null?null:Number(author.rating),author.rating_count);
        if(actor==='client' && current.client_id!==user.id) {
          if(!author.roles.includes('driver'))throw forbidden();
          const live=await q.one(
            `select 1 from users u join vehicles v
              on v.owner_id=u.owner_id and v.driver_id=u.id
             where u.id=$1 and u.owner_id=$2 and 'driver'=any(u.roles)
               and ($3::uuid is null or v.id=$3::uuid)
             limit 1 for share of u,v`,
            [user.id,current.client_id,current.vehicle_id]);
          if(current.created_by!==user.id||!live)throw forbidden('Водитель больше не закреплён за заявкой');
        }
        await q.one('select id from users where id=$1 for update',[target]);
        await q.query(
          `insert into reviews(order_id,author_id,target_id,stars,tags,text,weight)
            values ($1,$2,$3,$4,$5,$6,$7)`,
          [orderId,user.id,target,r.stars,r.tags??[],r.text??null,weight]);
        await this.recompute(target,q);
        await this.orders.event(q,orderId,user.id,'review',{stars:r.stars,target});
        return {ok:true,weight};
      });
    } catch(e:any){
      if(e.code==='23505')throw conflict('already_reviewed','Отзыв по этой заявке уже оставлен');
      throw e;
    }
  }

  /** Отзывы по заявке: мой, вес моего отзыва и — после моего — что написали обо мне */
  async forOrder(user: AuthUser, orderId: string) {
    const settings=await this.settings.get('reviews');
    return this.db.tx(async q=>{
      const o=await q.one<{client_id:string;created_by:string;performer_id:string|null;vehicle_id:string|null}>(
        'select client_id,created_by,performer_id,vehicle_id from orders where id=$1 for share',[orderId]);
      if(!o)throw notFound('Заявка не найдена');
      const me=await this.currentAuthor(q,user);
      if(!me.roles.some(role=>role==='admin'||role==='moderator') &&
         o.client_id!==user.id && o.performer_id!==user.id){
        if(o.created_by!==user.id || !me.roles.includes('driver'))throw forbidden();
        const linked=await q.one(
          `select 1 from users u join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
           where u.id=$1 and u.owner_id=$2 and 'driver'=any(u.roles)
             and ($3::uuid is null or v.id=$3::uuid)
           limit 1 for share of u,v`,[user.id,o.client_id,o.vehicle_id]);
        if(!linked)throw forbidden('Водитель больше не закреплён за заявкой');
      }
      const weight=authorWeight(settings,me?.rating==null?null:Number(me.rating),me?.rating_count??0);
      const mine=await q.one('select stars,tags,text,weight::float as weight,created_at from reviews where order_id=$1 and author_id=$2',[orderId,user.id]);
      const aboutMe=mine?await q.one(
        `select id,stars,tags,text,weight::float as weight,disputed,hidden,created_at
           from reviews where order_id=$1 and target_id=$2 and not hidden`,[orderId,user.id]):null;
      return {weight,myRating:me?.rating==null?null:Number(me.rating),mine,aboutMe};
    });
  }

  async recompute(userId: string, q: Queryable = this.db) {
    await q.one('select id from users where id=$1 for update',[userId]);
    const rows = await q.query<{stars:number;weight:string;disputed:boolean;hidden:boolean}>(
      'select stars,weight,disputed,hidden from reviews where target_id=$1',[userId]);
    const rating=weightedRating(rows.map(x=>({...x,weight:Number(x.weight)})));
    await q.query('update users set rating=$2,rating_count=$3 where id=$1',
      [userId,rating.rating,rating.count]);
    return rating;
  }

  async about(userId: string) {
    return this.db.query(
      `select r.id, r.stars, r.tags, r.text, r.created_at, r.disputed, u.name as author_name
         from reviews r join users u on u.id = r.author_id
        where r.target_id=$1 and not r.hidden order by r.created_at desc limit 50`, [userId]);
  }

  /** Модератор: оспорить / скрыть */
  async moderate(actor: AuthUser, reviewId: string, p: { disputed?: boolean; hidden?: boolean }) {
    if(!actor.roles.some(role=>role==='admin'||role==='moderator'))throw forbidden();
    return this.db.tx(async q=>{
      const current=await this.currentAuthor(q,actor);
      if(!current.roles.some(role=>role==='admin'||role==='moderator'))throw forbidden();
      const existing=await q.one<{target_id:string}>(
        'select target_id from reviews where id=$1',[reviewId]);
      if(!existing)throw bad('not_found');
      await q.one('select id from users where id=$1 for update',[existing.target_id]);
      const changed=await q.one<{target_id:string}>(
        'update reviews set disputed=coalesce($2,disputed),hidden=coalesce($3,hidden) '+
        'where id=$1 and target_id=$4 returning target_id',
        [reviewId,p.disputed??null,p.hidden??null,existing.target_id]);
      if(!changed)throw conflict('review_changed','Отзыв был изменён');
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id,'review.moderate',reviewId,p]);
      return this.recompute(changed.target_id,q);
    });
  }
}
