/** Coordinate-only ordering. Verified GPS inputs; no road routing or ETA. */
export type CourierGeo={lat:number;lng:number};
export type CourierPoint=CourierGeo&{id:string};
export type CourierRoutePlan={
 orderedIds:string[];planning:'coordinate_heuristic'|'manual_coordinates_missing';
 directKm:number|null
};
export const validCourierGeo=(p:CourierGeo|null|undefined):p is CourierGeo=>
 Boolean(p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=-90&&
 p.lat<=90&&p.lng>=-180&&p.lng<=180);
export function greatCircleKm(a:CourierGeo,b:CourierGeo):number{
 const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r;
 const h=Math.sin(dLat/2)**2+
 Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
function length(start:CourierGeo,route:CourierPoint[]):number{
 return route.reduce((s,x,i)=>s+greatCircleKm(i?route[i-1]:start,x),0);
}
export function planCourierRoute(start:CourierGeo|null,stops:CourierPoint[]):CourierRoutePlan{
 const ids=stops.map(x=>x.id);
 if(new Set(ids).size!==ids.length)throw Error('duplicate courier stop ids');
 if(!validCourierGeo(start)||stops.some(x=>!validCourierGeo(x)))
  return {orderedIds:ids,planning:'manual_coordinates_missing',directKm:null};
 const pending=[...stops],route:CourierPoint[]=[];
 let current:CourierGeo=start;
 while(pending.length){
  let choice=0,best=Infinity;
  for(let i=0;i<pending.length;i++){
   const d=greatCircleKm(current,pending[i]);
   if(d<best-1e-8){best=d;choice=i}
  }
  const next=pending.splice(choice,1)[0];route.push(next);current=next;
 }
 // Bounded 2-opt refinement on *straight-line* distances, not roads.
 for(let pass=0;pass<3;pass++){
  let improved=false;
  for(let i=0;i<route.length-1;i++){
   for(let j=i+1;j<route.length;j++){
    const prev=i?route[i-1]:start,a=route[i],b=route[j],next=route[j+1];
    const old=greatCircleKm(prev,a)+(next?greatCircleKm(b,next):0);
    const candidate=greatCircleKm(prev,b)+(next?greatCircleKm(a,next):0);
    if(candidate<old-1e-7){
     route.splice(i,j-i+1,...route.slice(i,j+1).reverse());improved=true;
    }
   }
  }
  if(!improved)break;
 }
 return {orderedIds:route.map(x=>x.id),planning:'coordinate_heuristic',
  directKm:Math.round(length(start,route)*10)/10};
}
