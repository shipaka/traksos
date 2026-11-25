import type { Queryable } from '../db/index.ts';
import { forbidden, type AuthUser } from '../http/router.ts';

type LiveTechState={roles:string[];repair_approved:boolean;workshop_approved:boolean};
async function liveTechState(db:Queryable,actor:AuthUser):Promise<LiveTechState|null>{
 if(actor.status!=='active')return null;
 // One statement observes the current account and both independent approval paths.
 // Never grant a newly assigned role to an older request snapshot.
 const state=await db.one<LiveTechState>(`select u.roles,
   exists(select 1 from performer_profiles p where p.user_id=u.id
     and p.kind in ('master','ecu') and p.verification='approved') as repair_approved,
   exists(select 1 from service_centers c where c.owner_id=u.id
     and c.verification='approved') as workshop_approved
   from users u where u.id=$1 and u.status='active' and u.deleted_at is null`,[actor.id]);
 if(!state)return null;
 return {...state,roles:actor.roles.filter(r=>state.roles.includes(r))};
}
function staff(state:LiveTechState|null){return !!state?.roles.some(r=>r==='admin'||r==='moderator');}
function repair(state:LiveTechState|null){return !!state?.roles.includes('master')&&state.repair_approved;}
function workshop(state:LiveTechState|null){return !!state?.roles.includes('service')&&state.workshop_approved;}
export async function verifiedRepairPerformer(db:Queryable,actor:AuthUser){
 return repair(await liveTechState(db,actor));
}
export async function verifiedWorkshop(db:Queryable,actor:AuthUser){
 return workshop(await liveTechState(db,actor));
}
export async function professionalTechAccess(db:Queryable,actor:AuthUser){
 const state=await liveTechState(db,actor);
 return staff(state)||repair(state)||workshop(state);
}
export async function requireProfessionalTechAccess(db:Queryable,actor:AuthUser){
 if(!await professionalTechAccess(db,actor))throw forbidden('ТехБаза доступна подтверждённым мастерам, СТО, администраторам и модераторам');
}
export async function effectiveTechRoles(db:Queryable,actor:AuthUser){
 const state=await liveTechState(db,actor);
 if(!state)return [];
 return state.roles.filter(r=>(r!=='master'||repair(state))&&(r!=='service'||workshop(state)));
}
