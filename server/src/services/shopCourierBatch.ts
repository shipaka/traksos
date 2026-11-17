import {z} from 'zod';
import type {Db,Queryable} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {bad,conflict,parse} from '../http/router.ts';
import {sha256} from '../util.ts';
import {addressDeclaredInSpb} from './shopRegion.ts';
import {greatCircleKm,planCourierRoute,type CourierGeo} from './shopCourierRoute.ts';

/**
 * Admin-reviewed batch dispatch. Preview never reserves customers or promises
 * arrival. Creation is atomic, still only a DRAFT: every run subsequently needs
 * real warehouse, supplier and financial approval before a courier can see it.
 */
const uuid=z.string().uuid();
const requestSchema=z.object({
  courierIds:z.array(uuid).min(1).max(20),
  pickupAddress:z.string().trim().min(10).max(300),
  pickupLat:z.number().min(-90).max(90),
  pickupLng:z.number().min(-180).max(180),
  maxStops:z.number().int().min(1).max(50).default(50)
});
const createSchema=requestSchema.extend({expectedSignature:z.string().regex(/^[a-f0-9]{64}$/),
  capacityConfirmed:z.literal(true)});
type Request=z.infer<typeof requestSchema>;
type Ready={
 id:string;number:number;address:string;lat:number;lng:number;
 reviewed_at:Date;created_at:Date
};
type Courier={user_id:string;display_name:string;active:boolean;busy:boolean};
type Batch={
 courierId:string;courierName:string;orderIds:string[];orderNumbers:number[];
 directKm:number|null
};
const activeStatuses="('planned','accepted','collecting','delivering','returning')";

async function eligibleOrders(q:Queryable,lock:boolean):Promise<Ready[]>{
  // The scan is capped. No stale, unverified, assigned, supplier-cancelled or
  // disputed parcel gets into automatic planning. Missing GPS is NOT geocoded.
  const sql=
   "select so.id,so.number,so.address,ac.lat,ac.lng,ac.reviewed_at,so.created_at "+
   "from shop_orders so "+
   "join shop_delivery_address_checks ac on ac.shop_order_id=so.id "+
   "where so.delivery='delivery' and so.status='ready' "+
   "and ac.city_code='spb' and ac.lat is not null and ac.lng is not null "+
   "and not exists(select 1 from shop_courier_stops st where st.shop_order_id=so.id) "+
   "and not exists(select 1 from shop_supplier_order_issues i "+
   "  where i.shop_order_id=so.id and i.needs_review=true) "+
   "and coalesce((select e.status from shop_supplier_order_events e "+
   "  where e.shop_order_id=so.id order by e.event_time desc,e.id desc limit 1),'')<>'cancelled' "+
   "order by so.created_at,so.id limit 1001"+
   (lock?" for update of so":"");
  const rows=await q.query<Ready>(sql);
  return rows.filter(x=>addressDeclaredInSpb(x.address));
}
async function selectedCouriers(q:Queryable,ids:string[]):Promise<Courier[]>{
  const profiles=await q.query<Courier>(
   "select c.user_id,c.display_name,c.active,exists(select 1 from shop_courier_runs r "+
   "where r.courier_id=c.user_id and r.status in "+activeStatuses+") as busy "+
   "from shop_couriers c join users u on u.id=c.user_id "+
   "where u.status='active' and c.user_id=any($1::uuid[])",[ids]);
  const byId=new Map(profiles.map(x=>[x.user_id,x]));
  const sorted=ids.map(x=>byId.get(x));
  if(sorted.some(x=>!x||!x.active||x.busy))
    throw conflict('courier_unavailable',
      'Выберите только активных свободных курьеров без незакрытых рейсов');
  return sorted as Courier[];
}
function assertInput(b:Request){
  if(new Set(b.courierIds).size!==b.courierIds.length)
    throw bad('duplicate_courier','Курьер выбран несколько раз');
  if(!addressDeclaredInSpb(b.pickupAddress))
    throw conflict('warehouse_outside_region','Склад должен находиться в Санкт-Петербурге');
}
function previewPlan(b:Request,couriers:Courier[],rows:Ready[]){
  const candidates=rows.slice(0,1000);
  const maximum=b.courierIds.length*b.maxStops;
  const pending=[...candidates.slice(0,maximum)];
  const origin:CourierGeo={lat:b.pickupLat,lng:b.pickupLng};
  const byId=new Map(candidates.map(x=>[x.id,x]));
  const batches:Batch[]=[];
  for(const c of couriers){
    if(!pending.length)break;
    // Select a geographical neighbourhood for each run, then refine order
    // within that run. We do NOT model road length, service windows or capacity.
    let current:CourierGeo=origin;
    const picked:Ready[]=[];
    while(pending.length&&picked.length<b.maxStops){
      let idx=0,best=Infinity;
      for(let i=0;i<pending.length;i++){
        const d=greatCircleKm(current,pending[i]);
        if(d<best-1e-8){best=d;idx=i}
      }
      const chosen=pending.splice(idx,1)[0];
      picked.push(chosen);current=chosen;
    }
    const planned=planCourierRoute(origin,picked.map(x=>({
      id:x.id,lat:x.lat,lng:x.lng
    })));
    batches.push({
      courierId:c.user_id,courierName:c.display_name,
      orderIds:planned.orderedIds,
      orderNumbers:planned.orderedIds.map(id=>byId.get(id)!.number),
      directKm:planned.directKm
    });
  }
  const signature=sha256(JSON.stringify({
    request:b,
    couriers:couriers.map(c=>[c.user_id,c.active,c.busy]),
    queue:rows.map(o=>[o.id,o.number,o.address,o.lat,o.lng,o.reviewed_at])
  }));
  return {
    signature,
    batches,
    plannedOrders:batches.reduce((n,x)=>n+x.orderIds.length,0),
    eligibleScanned:candidates.length,
    eligibleRemaining:Math.max(0,candidates.length-maximum),
    queueTruncated:rows.length>1000,
    requiresApproval:true,
    warehouseCheckRequired:true,
    supplierReceiptRequired:true,
    autoDispatched:false,
    warning:'Это только проекты рейсов. Оператор проверяет автомобиль, вместимость, склад, первичные документы, прибыльность и маршрут. Курьер ничего не получает до утверждения сметы. Расстояния рассчитаны по прямой без ETA.'
  };
}
export function registerShopCourierBatchRoutes(r:Router,db:Db){
  r.post('/api/admin/shop/courier-dispatch/preview',['admin'],async(c:AuthedCtx)=>{
    const b=parse(requestSchema,c.body);
    assertInput(b);
    const couriers=await selectedCouriers(db,b.courierIds);
    const rows=await eligibleOrders(db,false);
    return previewPlan(b,couriers,rows);
  });
  r.post('/api/admin/shop/courier-dispatch/create',['admin'],async(c:AuthedCtx)=>{
    const b=parse(createSchema,c.body);
    const {expectedSignature,capacityConfirmed,...params}=b;
    assertInput(params);
    try{
      return await db.tx(async q=>{
        // One planning transaction per region, and the same per-courier
        // advisory locks used by the existing manual route creation path.
        await q.query("select pg_advisory_xact_lock(hashtext($1))",
          ['shop-courier-batch-spb']);
        for(const courierId of [...params.courierIds].sort())
          await q.query("select pg_advisory_xact_lock(hashtext($1))",
            ['shop-courier:'+courierId]);
        const couriers=await selectedCouriers(q,params.courierIds);
        const rows=await eligibleOrders(q,true);
        const current=previewPlan(params,couriers,rows);
        if(current.signature!==expectedSignature)
          throw conflict('dispatch_preview_stale',
            'Очередь или адреса изменились. Обновите предварительный план');
        if(!current.batches.length)
          throw conflict('dispatch_queue_empty','Нет свободных проверенных заказов');
        const routes=[];
        for(const batch of current.batches){
          const run=await q.one<{id:string}>(
            "insert into shop_courier_runs(courier_id,created_by,pickup_address,"+
            "pickup_lat,pickup_lng,route_planning,route_direct_km,"+
            "packing_required,traceability_required,supplier_receipt_required) "+
            "values($1,$2,$3,$4,$5,'coordinate_heuristic',$6,true,false,true) returning id",
            [batch.courierId,c.user.id,params.pickupAddress,params.pickupLat,
              params.pickupLng,batch.directKm]);
          if(!run)throw new Error('Batch route was not created');
          await q.query(
            "insert into shop_courier_stops(run_id,shop_order_id,seq) "+
            "select $1,v.id,v.ord::int from unnest($2::uuid[]) with ordinality as v(id,ord)",
            [run.id,batch.orderIds]);
          await q.query(
            "insert into shop_delivery_events(shop_order_id,run_id,status,actor_id) "+
            "select shop_order_id,run_id,'planned',$2 from shop_courier_stops "+
            "where run_id=$1",[run.id,c.user.id]);
          await q.query(
            "insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)",
            [c.user.id,'shop.courier_auto_draft_created',run.id,{
              stopCount:batch.orderIds.length,plannedDirectKm:batch.directKm,
              strictWarehouseCheck:true,strictSupplierReceipt:true
            }]);
          routes.push({id:run.id,courierId:batch.courierId,stops:batch.orderIds.length});
        }
        return {
          created:true,draftRuns:routes,plannedOrders:current.plannedOrders,
          requiresManualFinancialApproval:true,
          courierNotified:false,
          message:'Рейсы подготовлены. Курьерам они станут видны только после складской проверки и утверждения администратором.'
        };
      });
    }catch(e:any){
      if(e?.code==='23505'||e?.code==='23503')
        throw conflict('dispatch_race','Заказ или курьер уже занят. Пересчитайте план');
      throw e;
    }
  });
}
