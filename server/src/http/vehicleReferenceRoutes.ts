import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { bad, forbidden, type AuthedCtx, type AuthUser, Raw, parse, type Router } from './router.ts';
import type { SettingsService } from '../services/settings.ts';
import { PublicVehicleDirectory, type CatalogPurpose } from '../services/publicVehicleDirectory.ts';
import { VehicleMissingQueue } from '../services/vehicleMissingQueue.ts';
import { VehicleTechnicalLibrary } from '../services/vehicleTechnicalLibrary.ts';
import { VehicleHelpAvailability } from '../services/vehicleHelpAvailability.ts';
import { publicVehicleCard } from '../services/vehicleOwnerShelf.ts';

const purpose = z.enum(['garage','master','tow','service','insurance','parts','admin']);
const category = z.enum(['passenger','truck','trailer','van','bus']);
const service = z.enum(['electric','diag','air','autonomy','tyre','ecu','tow','consult']);
const optionalYear = z.number().int().min(1960).max(2100).nullish();
const dir = new PublicVehicleDirectory();

export function registerVehicleReferenceRoutes(
  r: Router, db: Db, settings: SettingsService, now: () => Date,
) {
  const missing = new VehicleMissingQueue(db);
  const tech = new VehicleTechnicalLibrary(db);
  const nearby = new VehicleHelpAvailability(db,settings,now);
  const readPurpose = (c:AuthedCtx) => parse(purpose,c.query.get('purpose') || 'garage');
  const getCategory = (c:AuthedCtx) => parse(category,c.query.get('category'));

  r.get('/api/vehicle-reference/meta',false,()=>dir.metadata());
  r.get('/api/vehicle-reference/attribution',false,async ()=>
    new Raw('text/plain; charset=utf-8',Buffer.from(
      await readFile(new URL('../../data/vehiclesdb_ATTRIBUTION.md',import.meta.url),'utf8'))));
  r.get('/api/vehicle-reference/makes',true,(c:AuthedCtx)=>
    dir.makes(c.user,readPurpose(c),c.query.get('q')??'',c.query.get('includeHeavy')==='true',
      c.query.has('category')?getCategory(c):undefined));
  r.get('/api/vehicle-reference/models',true,(c:AuthedCtx)=>
    dir.models(c.user,readPurpose(c),getCategory(c),c.query.get('brandKey')??'',
      c.query.get('q')??'',c.query.get('includeHeavy')==='true'));
  r.get('/api/vehicle-reference/truck-evidence',true,(c:AuthedCtx)=>
    dir.truckEvidence(c.user,readPurpose(c),c.query.get('brandKey')??'',
      c.query.get('modelKey')??''));

  r.get('/api/vehicle-reference/public-card',true,async(c:AuthedCtx)=>{
    const cat=parse(category,c.query.get('category'));
    const brandKey=parse(z.string().min(2).max(64),c.query.get('brandKey'));
    const modelKey=parse(z.string().min(2).max(64),c.query.get('modelKey'));
    await dir.resolve(cat,brandKey,modelKey); // Do not display wrong manual/image for unknown keys.
    return publicVehicleCard(cat,brandKey,modelKey);
  });

  // Strict new vehicle creation path: the backend, never an editable text field,
  // resolves exact model/make from the pinned, licensed dataset.
  r.post('/api/vehicle-reference/vehicles',true,async(c:AuthedCtx)=>{
    if(c.user.owner_id||!c.user.roles.includes('client')||c.user.roles.includes('driver'))
      throw forbidden('Машины добавляет владелец автопарка');
    const data=parse(z.object({
      category: z.enum(['truck','trailer','van','bus']),
      brandKey:z.string().min(2).max(64),
      modelKey:z.string().min(2).max(64),
      year:optionalYear,
      plate:z.string().trim().max(15).nullish(),
      trailerPlate:z.string().trim().max(15).nullish(),
    }),c.body);
    const record=await dir.resolve(data.category,data.brandKey,data.modelKey);
    return db.tx(async q=>{
      const row=await q.one<any>(
        'insert into vehicles(owner_id,brand,model,year,plate,trailer_plate,' +
        'catalog_category,catalog_brand_key,catalog_model_key,catalog_source_version) ' +
        'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',
        [c.user.id,record.brand,record.model,data.year??null,
          data.plate?.toUpperCase()||null,data.trailerPlate?.toUpperCase()||null,
          record.category,record.brandKey,record.modelKey,record.sourceVersion]);
      if(!row)throw bad('vehicle_not_created','Машина не добавлена');
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [c.user.id,'vehicle.catalog_added',row.id,{category:record.category,
          brandKey:record.brandKey,modelKey:record.modelKey,sourceVersion:record.sourceVersion}]);
      return row;
    });
  });

  r.post('/api/vehicle-reference/missing',true,async(c:AuthedCtx)=>{
    const item=parse(z.object({
      category:z.enum(['passenger','truck','van','bus','trailer']),
      purpose,
      make:z.string().min(2).max(100),
      model:z.string().min(2).max(120),
      year:optionalYear,
      note:z.string().max(1200).optional(),
    }),c.body);
    return missing.submit(c.user,item);
  });
  r.get('/api/vehicle-reference/missing/mine',true,(c:AuthedCtx)=>missing.mine(c.user));
  r.get('/api/admin/vehicle-reference/missing',['admin'],(c:AuthedCtx)=>{
    const status=parse(z.enum(['new','reviewing','accepted','rejected','all']),
      c.query.get('status')||'new');
    return missing.queue(c.user,status);
  });
  r.patch('/api/admin/vehicle-reference/missing/:id',['admin'],(c:AuthedCtx)=>{
    const b=parse(z.object({status:z.enum(['reviewing','accepted','rejected']),
      note:z.string().min(10).max(1200)}),c.body);
    return missing.review(c.user,c.params.id,b.status,b.note);
  });

  r.get('/api/vehicle-reference/tips',true,(c:AuthedCtx)=>
    tech.tips(c.user,c.query.get('q')??'',c.query.get('category')??''));
  r.get('/api/vehicle-reference/professional',true,(c:AuthedCtx)=>
    tech.professional(c.user,{make:c.query.get('make')??'',subsystem:c.query.get('subsystem')??'',q:c.query.get('q')??'',
      category:(c.query.get('category')??'truck') as 'truck'|'trailer'|'passenger'}));
  r.get('/api/vehicle-reference/nearby',true,(c:AuthedCtx)=>{
    const type=parse(service,c.query.get('service'));
    const lat=c.query.get('lat'),lng=c.query.get('lng');
    const parsed={service:type,lat:lat===null?undefined:Number(lat),lng:lng===null?undefined:Number(lng),
      brand:c.query.get('brand')??undefined};
    return nearby.nearby(c.user,parsed);
  });
}
