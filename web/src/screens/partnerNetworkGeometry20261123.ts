/** Geographic centre of verified public stationary points. Longitude wraps at
 * ±180°, so Chukotka (+179 / -179) must centre on the dateline, not Greenwich.
 * The input contains only server-verified opted-in stationary locations.
 */
export type MapCoordinate={lat:number;lng:number};
export function geographicCenter(points:readonly MapCoordinate[]):MapCoordinate{
  if(points.length===0)throw new Error('Cannot centre an empty partner cluster');
  const base=points[0].lng;
  const lat=points.reduce((s,p)=>s+p.lat,0)/points.length;
  const lng=points.reduce((s,p)=>
    s+p.lng+360*Math.round((base-p.lng)/360),0)/points.length;
  return {lat,lng:((lng+540)%360+360)%360-180};
}
/** Pixel clustering cannot separate exact shared addresses; display a list
 * instead of offering an endless +2 zoom that changes nothing.
 */
export function mustExpandCluster(points:readonly MapCoordinate[],zoom:number,maxZoom:number){
  if(points.length<2)return false;
  if(zoom>=maxZoom)return true;
  const base=points[0];
  return points.every(p=>Math.abs(p.lat-base.lat)<1e-9 &&
    Math.abs(((p.lng-base.lng+540)%360+360)%360-180)<1e-9);
}

// Independent of React: cluster across neighbouring grid cells, not just
// within one arbitrary bucket. Sort first for deterministic assignment.
export type ScreenPoint<T>={x:number;y:number;point:T};
export function clusterScreenPoints<T>(points:readonly ScreenPoint<T>[],radius:number){
  if(!Number.isFinite(radius)||radius<=0)throw Error('Invalid cluster radius');
  type Group={key:string;x:number;y:number;members:T[];anchorX:number;anchorY:number};
  const groups:Group[]=[];
  const cells=new Map<string,Group[]>();
  const key=(x:number,y:number)=>x+':'+y;
  for(const p of [...points].sort((a,b)=>a.x-b.x||a.y-b.y)){
    const cx=Math.floor(p.x/radius),cy=Math.floor(p.y/radius);
    let best:Group|undefined,dist=radius*radius;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const candidate of cells.get(key(cx+dx,cy+dy))??[]){
        const dd=(candidate.anchorX-p.x)**2+(candidate.anchorY-p.y)**2;
        if(dd<=dist){best=candidate;dist=dd;}
      }
    }
    if(best){
      best.members.push(p.point);
      const n=best.members.length;
      best.x+=(p.x-best.x)/n;best.y+=(p.y-best.y)/n;
    }else{
      const group:Group={key:'group:'+groups.length,x:p.x,y:p.y,anchorX:p.x,anchorY:p.y,members:[p.point]};
      groups.push(group);
      const bucket=key(cx,cy);
      cells.set(bucket,[...(cells.get(bucket)??[]),group]);
    }
  }
  return groups.map(({key,x,y,members})=>({key,x,y,members}));
}
export function fitRussiaView(width:number,height:number){
  // Approximate federal extent, with the eastern end unwrapped at 190°.
  const mercator=(lat:number)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
  const top=mercator(82),bottom=mercator(41),middle=(top+bottom)/2;
  const lat=180/Math.PI*Math.atan(Math.sinh(Math.PI*(1-2*middle)));
  const scale=Math.min(Math.max(1,width-32)/(163/360),Math.max(1,height-32)/(bottom-top));
  return {lat,lng:108.5,zoom:Math.max(1,Math.min(3,Math.floor(Math.log2(scale/256))))};
}
