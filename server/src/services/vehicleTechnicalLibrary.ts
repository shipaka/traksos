import { readFile } from 'node:fs/promises';
import type { Db } from '../db/index.ts';
import { forbidden, type AuthUser } from '../http/router.ts';

type Portal = { id: string; title: string; make: string | null; subsystem: string; kind: string; url: string;
 region:string;scope:string;rights:'LINK_ONLY'|'PUBLIC_DOMAIN'|'CC-BY-3.0'|'CC-BY-SA-4.0';
 author?:string;licenseUrl?:string;origin?:string;owner?:string;requiresLogin?:string;
 checkedOn?:string;sourceStatus?:'link_verified'|'license_verified'|'hold_upstream';
 vehicleClasses?:Array<'truck'|'trailer'>;changeStatus?:string;reviewNote?:string;
 modelFamilyKeywords?:string[];documentSections?:string[];confirmedFitment?:boolean;accessCost?:string;
 vehicleYearFrom?:number|null;vehicleYearTo?:number|null; };
type Tip = { id:string;title:string;category:string;tags:string[];body:string;priority:string;professionalDetail:false };
type Sources = { version:string;policy:string;professional:Portal[];driverTips:Tip[];sourceNotice:string };
let cache: Promise<Sources> | undefined;
async function readSources() {
  cache ??= readFile(new URL('../../data/vehicle_technical_sources.json',import.meta.url),'utf8')
    .then((raw)=>JSON.parse(raw) as Sources).catch((e)=>{cache=undefined;throw e;});
  return cache;
}
export class VehicleTechnicalLibrary {
  constructor(private readonly db: Db) {}

  async tips(actor: AuthUser, q = '', category = '') {
    if (!actor || actor.status !== 'active') throw forbidden();
    const data = await readSources();
    const term = q.trim().toLowerCase().slice(0,80);
    return { audience: 'driver',version:data.version,
      message: 'Памятки для безопасности. Здесь нет распиновок, опасных инструкций и заводских схем.',
      items: data.driverTips.filter((item)=>
        (!category || item.category===category) &&
        (!term || [item.title,item.body,...item.tags].some((t)=>t.toLowerCase().includes(term))))
        .map(({id,title,category,tags,body,priority})=>({id,title,category,tags,body,priority})) };
  }

  async professional(actor: AuthUser, filter: {make?:string;subsystem?:string;q?:string;category?:'truck'|'trailer'|'passenger'} = {}) {
    if(filter.category && filter.category!=='truck'&&filter.category!=='trailer')
      throw forbidden('Профессиональная ТехБаза содержит материалы только грузового транспорта и прицепов');
    if (!actor || actor.status !== 'active') throw forbidden();
    // UNION OF REAL ROLES, not an account-specific exception:
    // if the same account is both admin and master, it retains the full
    // professional and administrative view regardless of the currently
    // selected frontend mode. No phone-number or public profile bypass.
    if (!actor.roles.some(role=>role==='master'||role==='service'))
      throw forbidden('Профессиональные материалы доступны только мастерам и СТО');
    const performer = await this.db.one<{verification:string}>(
      "select verification from performer_profiles where user_id=$1", [actor.id]);
    if (performer?.verification!=='approved')
      throw forbidden('ТехБаза требует подтверждённый профиль мастера или СТО');
    const d = await readSources();
    const make = filter.make?.trim().toLowerCase().slice(0,60);
    const subsystem = filter.subsystem?.trim().toLowerCase().slice(0,60);
    const q = filter.q?.trim().toLowerCase().slice(0,80);
    const items = d.professional.filter((v)=>
      v.sourceStatus!=='hold_upstream' &&
      v.vehicleClasses?.some(c=>c==='truck'||c==='trailer') &&
      (!filter.category||v.vehicleClasses?.includes(filter.category as 'truck'|'trailer')) &&
      (!make || !v.make || v.make===make) &&
      (!subsystem || v.subsystem===subsystem) &&
      (!q || (v.title+' '+v.scope+' '+v.subsystem+' '+(v.modelFamilyKeywords??[]).join(' ')+' '+(v.documentSections??[]).join(' ')).toLowerCase().includes(q)));
    await this.db.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
      [actor.id,'vehicle_tech.professional_index_viewed',actor.id,{make,subsystem,count:items.length}]);
    return { audience:'professional',categories:['truck','trailer'],version:d.version,rightsPolicy:'per_file',
      message:'Оригиналы остаются на сайте правообладателя. Сверяйте VIN, рынок, модель, год и редакцию документа.',
      links:items, sourceNotice:d.sourceNotice };
  }
}
