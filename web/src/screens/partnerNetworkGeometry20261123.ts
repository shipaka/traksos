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
