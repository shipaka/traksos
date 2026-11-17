import { readFile } from 'node:fs/promises';
import type { Db } from '../db/index.ts';
import { forbidden, type AuthUser } from '../http/router.ts';

type Portal = { id: string; title: string; make: string | null; subsystem: string; kind: string; url: string;
  region: string; scope: string; rights: 'LINK_ONLY' };
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

  async professional(actor: AuthUser, filter: { make?:string; subsystem?:string; q?:string } = {}) {
    if (!actor || actor.status !== 'active') throw forbidden();
    // UNION OF REAL ROLES, not an account-specific exception:
    // if the same account is both admin and master, it retains the full
    // professional and administrative view regardless of the currently
    // selected frontend mode. No phone-number or public profile bypass.
    if (!actor.roles.includes('admin')) {
      if (!actor.roles.some((role)=>['master','tow','service'].includes(role)))
        throw forbidden('Профессиональные материалы доступны только специалистам');
      const performer = await this.db.one<{verification:string}>(
        "select verification from performer_profiles where user_id=$1", [actor.id]);
      if (performer?.verification!=='approved')
        throw forbidden('ТехБаза требует подтверждённый профиль специалиста');
    }
    const d = await readSources();
    const make = filter.make?.trim().toLowerCase().slice(0,60);
    const subsystem = filter.subsystem?.trim().toLowerCase().slice(0,60);
    const q = filter.q?.trim().toLowerCase().slice(0,80);
    const items = d.professional.filter((v)=>
      (!make || !v.make || v.make===make) &&
      (!subsystem || v.subsystem===subsystem) &&
      (!q || (v.title+' '+v.scope+' '+v.subsystem).toLowerCase().includes(q)));
    await this.db.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
      [actor.id,'vehicle_tech.professional_index_viewed',actor.id,{make,subsystem,count:items.length}]);
    return { audience:'professional',version:d.version,license:'LINK_ONLY',
      message:'Оригиналы остаются на сайте правообладателя. Сверяйте VIN, рынок, модель, год и редакцию документа.',
      links:items, sourceNotice:d.sourceNotice };
  }
}
