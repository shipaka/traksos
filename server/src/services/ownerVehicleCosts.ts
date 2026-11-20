import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthUser,AuthedCtx} from '../http/router.ts';
import {forbidden,notFound,bad,parse} from '../http/router.ts';

const uid=z.string().uuid();
const kind=z.enum(['fuel','maintenance','tyres','tolls','insurance','other']);
const form=z.object({
 kind,amountKopeks:z.number().int().min(1).max(100_000_000_000),
 incurredOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 note:z.string().trim().max(500).default('')
});
export function registerOwnerVehicleCostsRoutes(r:Router,db:Db){
 async function ownerOnly(user:AuthUser,vehicleId:string){
  if(!user.roles.includes('client')||user.roles.includes('driver')||user.owner_id)
   throw forbidden('Расходы по транспорту доступны только владельцу');
  const v=await db.one('select id from vehicles where id=$1 and owner_id=$2',
    [vehicleId,user.id]);
  if(!v)throw notFound('Машина не найдена в вашем гараже');
 }
 r.get('/api/vehicles/:id/costs',true,async(c:AuthedCtx)=>{
  const id=parse(uid,c.params.id);await ownerOnly(c.user,id);
  const [rows,totals]=await Promise.all([
   db.query(`select id,kind,amount_kopeks::text as amount_kopeks,incurred_on::text as incurred_on,note,created_at
      from vehicle_owner_expenses where owner_id=$1 and vehicle_id=$2
      order by incurred_on desc,created_at desc limit 250`,[c.user.id,id]),
   db.query<{kind:string;amount_kopeks:string}>(`select kind,sum(amount_kopeks)::text as amount_kopeks
      from vehicle_owner_expenses where owner_id=$1 and vehicle_id=$2 group by kind`,
     [c.user.id,id])
  ]);
  const total=totals.reduce((sum,x)=>sum+Number(x.amount_kopeks),0);
  return {entries:rows,totals,totalKopeks:total,
   scope:'owner_only',separateFromPlatformPayments:true,
   note:'Личный список затрат владельца. Суммы не являются счетами, налоговым учётом или подтверждением оплаты через TrakSOS.'};
 });
 r.post('/api/vehicles/:id/costs',true,async(c:AuthedCtx)=>{
  const id=parse(uid,c.params.id);await ownerOnly(c.user,id);
  const b=parse(form,c.body);
  const date=new Date(b.incurredOn+'T12:00:00Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==b.incurredOn||
     date.getTime()>Date.now()+86400_000||date.getUTCFullYear()<2000)
    throw bad('invalid_expense_date','Укажите фактическую дату расхода');
  const e=await db.one(`insert into vehicle_owner_expenses(owner_id,vehicle_id,kind,amount_kopeks,incurred_on,note)
    values($1,$2,$3,$4,$5,$6) returning id,kind,amount_kopeks::text as amount_kopeks,
    incurred_on::text as incurred_on,note`,[c.user.id,id,b.kind,b.amountKopeks,b.incurredOn,b.note]);
  return {entry:e};
 });
 r.delete('/api/vehicles/:id/costs/:expense',true,async(c:AuthedCtx)=>{
  const id=parse(uid,c.params.id),expense=parse(uid,c.params.expense);
  await ownerOnly(c.user,id);
  const deleted=await db.query('delete from vehicle_owner_expenses where id=$1 and vehicle_id=$2 and owner_id=$3 returning id',
    [expense,id,c.user.id]);
  if(!deleted.length)throw notFound('Расход не найден');return {deleted:true};
 });
}
