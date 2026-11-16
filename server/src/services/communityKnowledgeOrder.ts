import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx } from '../http/router.ts';
import { parse, forbidden, notFound } from '../http/router.ts';

/** Professional-only context; cannot be used by a customer to enumerate private manuals. */
export function registerKnowledgeOrderRoutes(r:Router,db:Db) {
  r.get('/api/community/knowledge/for-order/:id',true,async(c:AuthedCtx)=>{
    const orderId=parse(z.string().uuid(),c.params.id);
    const staff=c.user.roles.includes('admin')||c.user.roles.includes('moderator');
    const p=await db.one<{verification:string;specialties:string[]}>(
      'select verification,specialties from performer_profiles where user_id=$1',[c.user.id]);
    if(!staff && (!c.user.roles.some(x=>['master','tow','service'].includes(x))||p?.verification!=='approved'))
      throw forbidden('Справочник предназначен для подтверждённых исполнителей');
    // Deliberately omit VIN, license plate, customer address, phone and coordinates.
    const order=await db.one<{performer_id:string|null;service:string;vehicle_brand:string|null;model:string|null;year:number|null}>(
      'select o.performer_id,o.service,coalesce(v.brand,o.brand) as vehicle_brand,v.model,v.year from orders o '+
      'left join vehicles v on v.id=o.vehicle_id where o.id=$1',[orderId]);
    if(!order || (!staff && order.performer_id!==c.user.id))throw notFound('Заявка не найдена');
    const make=order.vehicle_brand?.trim()??'';
    const model=order.model?.trim()??'';
    const year=order.year??null;
    const selectedSystem=c.query.get('subsystem')?.slice(0,70)??null;
    if(!make)return {
      context:{brand:null,model:null,year:null,initialSystem:order.service},
      articles:[],matchStatus:'vehicle_not_identified',
      warning:'Уточните марку и модификацию автомобиля до поиска схем'
    };
    const articles=await db.query(
      "select id,title,make,model,model_year,subsystem,source_url,created_at from community_knowledge "+
      "where rights_review='approved' and technical_review='approved' and lower(make)=lower($1) "+
      "and (model is null or ($2<>'' and lower(model)=lower($2))) "+
      "and (model_year is null or model_year=$3) "+
      "and ($4::text is null or lower(subsystem)=lower($4)) "+
      "order by case when lower(subsystem)=lower($5) then 0 else 1 end, "+
      "case when model_year=$3 then 0 else 1 end,created_at desc limit 100",
      [make,model,year,selectedSystem,order.service]);
    return {context:{brand:make,model:model||null,year,initialSystem:order.service},
      articles,matchStatus:'catalog_matches',
      warning:'Сверьте VIN, двигатель, комплектацию и версию документа: совпадение марки и года не подтверждает применимость схемы'};
  });
}
