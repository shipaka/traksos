import type { Queryable } from '../db/index.ts';
import { forbidden, type AuthUser } from '../http/router.ts';

// Call only within the same transaction as the protected read/write.
// A current DB row and the authenticated role snapshot must both authorize it.
export async function requirePartActor(q:Queryable,user:AuthUser,role:'client'|'admin'){
 if(user.status!=='active'||!user.roles.includes(role)||(role==='client'&&user.owner_id))
  throw forbidden();
 const live=await q.one<{roles:string[];owner_id:string|null}>(
  "select roles,owner_id from users where id=$1 and status='active' and deleted_at is null for share",[user.id]);
 if(!live||!live.roles.includes(role)||(role==='client'&&live.owner_id))throw forbidden();
}

// Historical own recommendations stay readable. New sourcing/purchase must
// not proceed for a vehicle no longer owned by that customer.
export async function requirePartVehicle(q:Queryable,ownerId:string,vehicleId:string|null){
 if(vehicleId&&!await q.one('select id from vehicles where id=$1 and owner_id=$2 for share',[vehicleId,ownerId]))
  throw forbidden('Автомобиль больше не доступен владельцу');
}
