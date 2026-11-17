import type {Db} from '../db/index.ts';
import type {AuthUser} from '../http/router.ts';
import {forbidden} from '../http/router.ts';

// PostgreSQL predicate shared by room publication, direct messages and live
// recipients. Call only with a trusted *literal* table alias (never user input).
export function driverAirSql(alias:'u'|'a'|'b'):string {
  return `('driver'=any(${alias}.roles) or
    ('client'=any(${alias}.roles) and exists (
      select 1 from community_driver_optins cai
      where cai.user_id=${alias}.id and cai.enabled=true
    )))`;
}
export async function canUseDriverAir(db:Db,user:AuthUser):Promise<boolean>{
  const row=await db.one<{allowed:boolean}>(`select (${driverAirSql('u')}) as allowed
    from users u where u.id=$1 and u.status='active' and u.deleted_at is null`,[user.id]);
  return row?.allowed===true;
}
export async function requireDriverAir(db:Db,user:AuthUser):Promise<void>{
  if(!await canUseDriverAir(db,user))
    throw forbidden('Водительский Эфир доступен водителям и владельцам, включившим участие');
}
