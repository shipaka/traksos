import test from 'node:test';
import assert from 'node:assert/strict';
import type { Queryable } from '../src/db/index.ts';
import type { AuthUser } from '../src/http/router.ts';
import { professionalTechAccess,effectiveTechRoles,verifiedRepairPerformer,verifiedWorkshop,requireProfessionalTechAccess } from '../src/domain/techbaseAccess.ts';
import {bindingsForCard,discoverCard,bindingEvidenceComplete,type TechBinding} from '../src/domain/techbaseApplicability.ts';
const actor=(roles:string[],status='active'):AuthUser=>({id:'x',phone:'',name:null,roles,status,owner_id:null});
function db(verification:string){return {one:async()=>({roles:['admin','moderator','master','service','client','driver','tow','insurer'],repair_approved:verification==='approved',workshop_approved:verification==='approved'}),query:async()=>[]} as unknown as Queryable}
test('staff read access is independent of performer approval; ordinary specialists must be verified',async()=>{
 for(const roles of [['admin'],['moderator'],['admin','master'],['moderator','master']]){
  assert.equal(await professionalTechAccess(db('pending'),actor(roles)),true);
  assert.deepEqual(await effectiveTechRoles(db('pending'),actor(roles)),roles.filter(r=>r!=='master'));
  assert.equal(await verifiedRepairPerformer(db('pending'),actor(roles)),false);
  assert.equal(await professionalTechAccess(db('approved'),actor(roles,'blocked')),false);
 }
 for(const role of ['master','service']){
  assert.equal(await professionalTechAccess(db('approved'),actor([role])),true);
  assert.equal(await professionalTechAccess(db('pending'),actor([role])),false);
 }
 for(const role of ['client','driver','tow','insurer']){
  await assert.rejects(requireProfessionalTechAccess(db('approved'),actor([role])));
 }
 assert.deepEqual(await effectiveTechRoles(db('pending'),actor(['client','master'])),['client']);
});
test('one canonical image is discoverable through multiple independently evidenced vehicle bindings',()=>{
 const c={id:'test-only',make:null,models:[],url:'https://example.org/test'};
 // Synthetic fixture only: no assertion about real-world installation.
 const a:TechBinding={make:'Fixture A',model:'A1',generation:'g1',yearFrom:2000,yearTo:2005,variant:'v1',manufacturer:'Fixture',article:'001',revision:'r1',source:c.url,status:'verified_component'};
 const b:TechBinding={...a,make:'Fixture B',model:'B1',yearFrom:2003,yearTo:2008};
 const bindings=bindingsForCard(c,[a,b,a]);
 assert.equal(bindings.length,2);
 assert.ok(bindings.every(bindingEvidenceComplete));
 assert.equal(discoverCard(c,bindings,{make:'Fixture A',model:'A1',year:2004}),true);
 assert.equal(discoverCard(c,bindings,{make:'Fixture B',model:'B1',year:2008}),true);
 assert.equal(discoverCard(c,bindings,{make:'Fixture A',model:'A1',year:2010}),false);
 assert.equal(discoverCard(c,bindings,{make:'Fixture C'}),false);
 assert.equal(discoverCard(c,[],{make:'Fixture C'},true),true);
 assert.equal(discoverCard(c,[],{make:'Fixture C'},false),false);
 assert.equal(bindingEvidenceComplete({...a,revision:undefined}),false);
});

test('verified workshop can read without a mobile performer profile, but a pending or blocked center cannot',async()=>{
 const fixture=(status:string)=>({one:async()=>({roles:['service'],repair_approved:false,workshop_approved:status==='approved'})}) as unknown as Queryable;
 assert.equal(await verifiedRepairPerformer(fixture('approved'),actor(['service'])),false);
 assert.equal(await verifiedWorkshop(fixture('approved'),actor(['service'])),true);
 assert.equal(await professionalTechAccess(fixture('approved'),actor(['service'])),true);
 assert.equal(await professionalTechAccess(fixture('pending'),actor(['service'])),false);
 assert.equal(await professionalTechAccess(fixture('approved'),actor(['service'],'blocked')),false);
 assert.equal(await professionalTechAccess(fixture('approved'),actor(['client'])),false);
});

test('live role revocation, independent approvals and deleted accounts fail closed',async()=>{
 const fixture=(roles:string[],repair_approved:boolean,workshop_approved:boolean)=>({
  one:async()=>({roles,repair_approved,workshop_approved})
 }) as unknown as Queryable;
 const hybrid=actor(['master','service']);
 const oldMaster=actor(['master']);
 assert.equal(await professionalTechAccess(fixture(['service'],true,false),hybrid),false);
 assert.equal(await verifiedRepairPerformer(fixture(['service'],true,true),hybrid),false);
 assert.equal(await professionalTechAccess(fixture(['service'],true,true),hybrid),true);
 assert.deepEqual(await effectiveTechRoles(fixture(['service'],true,true),hybrid),['service']);
 assert.equal(await professionalTechAccess(fixture(['master'],false,true),hybrid),false);
 assert.equal(await professionalTechAccess(fixture(['master','service'],false,true),oldMaster),false);
 assert.equal(await professionalTechAccess(fixture(['client'],true,true),actor(['admin'])),false);
 assert.equal(await professionalTechAccess({one:async()=>null} as unknown as Queryable,hybrid),false);
});
