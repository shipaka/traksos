import type { Queryable } from '../db/index.ts';
import { forbidden, type AuthUser } from '../http/router.ts';

export function hasStaffTechAccess(actor:AuthUser){
 return actor.status==='active'&&actor.roles.some(r=>r==='admin'||r==='moderator');
}
export async function verifiedRepairPerformer(db:Queryable,actor:AuthUser){
 if(actor.status!=='active'||!actor.roles.some(r=>r==='master'||r==='service'))return false;
 const p=await db.one<{verification:string}>('select verification from performer_profiles where user_id=$1',[actor.id]);
 return p?.verification==='approved';
}
export async function verifiedWorkshop(db:Queryable,actor:AuthUser){
 if(actor.status!=='active'||!actor.roles.includes('service'))return false;
 const c=await db.one<{verification:string}>('select verification from service_centers where owner_id=$1',[actor.id]);
 return c?.verification==='approved';
}
export async function professionalTechAccess(db:Queryable,actor:AuthUser){
 return hasStaffTechAccess(actor)||await verifiedRepairPerformer(db,actor)||await verifiedWorkshop(db,actor);
}
export async function requireProfessionalTechAccess(db:Queryable,actor:AuthUser){
 if(!await professionalTechAccess(db,actor))throw forbidden('ТехБаза доступна подтверждённым мастерам, СТО, администраторам и модераторам');
}
export async function effectiveTechRoles(db:Queryable,actor:AuthUser){
 if(actor.status!=='active')return [];
 if(await professionalTechAccess(db,actor))return actor.roles;
 return actor.roles.filter(r=>r!=='master'&&r!=='service');
}
