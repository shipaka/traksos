// Offline operator tool: no TrakSOS API or database writes, no public geocoding service.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';

const rowSchema=z.object({id:z.string().regex(/^directory:[a-z0-9-]+$/).max(120),revision:z.number().int().positive(),address:z.string().min(5).max(400)}).strict();
type Row=z.infer<typeof rowSchema>;
type Result=Row&{matchedAddress:string;lat:number;lng:number;accuracy:'building';source:string;reuseAllowed:true};
type Attempt={row:Row;result:Result|null;reason:string};
const queueSchema=z.array(rowSchema).max(10000);
const normalize=(v:string)=>v.toLowerCase().replace(/ё/g,'е').replace(/[\p{P}\p{Z}]+/gu,' ').trim();
const compact=(v:string)=>normalize(v).replace(/ /g,'');
const street=(v:string)=>normalize(v).replace(/^(?:улица|ул|проспект|просп|переулок|пер|шоссе|проезд|набережная|наб|бульвар|бул)\s+/,'').replace(/\s+(?:улица|ул|проспект|просп|переулок|пер|шоссе|проезд|набережная|наб|бульвар|бул)$/,'');
const locality=(v:string)=>normalize(v).replace(/^(?:город|г|поселок|пос|пгт|деревня|д|село|с|станица|ст)\s+/,'');
const normHouse=(v:string)=>compact(v.replace(/^(?:дом|д\.)\s*/i,''));
const stringValue=(v:unknown)=>typeof v==='string'?v:'';
const housePattern=/^(?:дом\s*|д\.\s*)?\d+[а-яa-z]?(?:[/-]\d+[а-яa-z]?)?$/i;

export function matchAddress(row:Row,raw:unknown):Attempt{
 const fail=(reason:string):Attempt=>({row,result:null,reason});
 if(!Array.isArray(raw))return fail('invalid_response');
 // Intentionally accept only explicit simple street/house addresses.
 // Kilometre markers, building/corpus qualifiers, rural or ambiguous layouts require human review.
 const parts=row.address.split(',').map(p=>p.trim()).filter(Boolean);
 if(parts.length<4||!housePattern.test(parts.at(-1)!))return fail('complex_address');
 const house=normHouse(parts.at(-1)!);
 const road=street(parts.at(-2)!);
 const region=normalize(parts[0]);
 const towns=parts.slice(1,-2).map(locality).filter(Boolean);
 if(!road||!region||!towns.length)return fail('complex_address');
 const matches=new Map<string,Result>();
 for(const p of raw){
  if(!p||typeof p!=='object'||!p.address||typeof p.address!=='object')continue;
  const a=p.address;
  if(a.country_code!=='ru'||normHouse(stringValue(a.house_number))!==house)continue;
  if(![a.road,a.pedestrian,a.residential,a.living_street,a.service].some(v=>street(stringValue(v))===road))continue;
  if(![a.state,a.region,a.city,a.county].some(v=>normalize(stringValue(v))===region))continue;
  if(![a.city,a.town,a.village,a.hamlet,a.municipality,a.suburb,a.city_district].some(v=>towns.includes(locality(stringValue(v)))))continue;
  if(!['house','building'].includes(p.addresstype)&&p.category!=='building')continue;
  const lat=Number(p.lat),lng=Number(p.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<40||lat>82||Math.abs(lng)>180||(lng>0&&lng<19))continue;
  const osmType=p.osm_type,osmId=String(p.osm_id??'');
  if(!['node','way','relation'].includes(osmType)||!/^[1-9]\d*$/.test(osmId))continue;
  const matchedAddress=stringValue(p.display_name).trim();
  if(matchedAddress.length<5||matchedAddress.length>400)continue;
  const key=osmType+'/'+osmId;
  matches.set(key,{...row,matchedAddress,lat,lng,accuracy:'building',source:'https://www.openstreetmap.org/'+key,reuseAllowed:true});
 }
 if(matches.size!==1)return fail(matches.size?'ambiguous_building':'no_exact_building');
 return {row,result:[...matches.values()][0],reason:'candidate_needs_review'};
}

export function endpoint(value:string){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)
  throw Error('Only a local, operator-controlled Nominatim endpoint is allowed. Public services are forbidden.');
 url.pathname=url.pathname.replace(/\/+$/,'')+'/search';
 return url;
}
const atomic=async(path:string,data:unknown)=>{const temp=path+'.tmp';await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temp,path);};
const same=(a:Row,b:Row)=>a.id===b.id&&a.revision===b.revision&&a.address===b.address;
async function main(){
 const [input,prefix,...flags]=process.argv.slice(2);
 if(!input||!prefix||!flags.includes('--confirm-reuse')||flags.some(f=>f!=='--confirm-reuse'))throw Error('Usage: npm -w server run geocode:sto -- queue.json output-prefix --confirm-reuse');
 const base=endpoint(process.env.STO_NOMINATIM_URL??'');
 const rows=queueSchema.parse(JSON.parse(await readFile(input,'utf8')));
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate ID in queue');
 const path=prefix+'.checkpoint.json';
 let previous:Attempt[]=[];
 try{const saved=JSON.parse(await readFile(path,'utf8'));if(saved.schema!=='sto-geocode-v1'||saved.endpoint!==base.href||!Array.isArray(saved.attempts))throw Error('Checkpoint does not match endpoint/schema');previous=saved.attempts;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const attempts=new Map<string,Attempt>();
 for(const p of previous){if(rows.some(r=>same(r,p.row)))attempts.set(p.row.id,p);}
 const persist=async()=>{
  const ordered=rows.map(r=>attempts.get(r.id)).filter((x):x is Attempt=>!!x);
  await atomic(path,{schema:'sto-geocode-v1',endpoint:base.href,attempts:ordered});
  await atomic(prefix+'.results.json',ordered.flatMap(x=>x.result?[x.result]:[]));
  await atomic(prefix+'.review.json',ordered.map(x=>({id:x.row.id,address:x.row.address,revision:x.row.revision,reason:x.reason,candidate:x.result})));
 };
 await persist();
 for(const row of rows){
  if(attempts.has(row.id))continue;
  const url=new URL(base);
  for(const [k,v] of Object.entries({q:row.address+', Россия',format:'jsonv2',addressdetails:'1',countrycodes:'ru',limit:'10','accept-language':'ru'}))url.searchParams.set(k,v);
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'TrakSOS-operator-geocode/1.0'}});
  if(!response.ok)throw Error('Geocoder HTTP '+response.status+'; checkpoint saved, retry with same arguments.');
  const data=await response.json();
  if(!Array.isArray(data))throw Error('Invalid geocoder response; checkpoint retained');
  attempts.set(row.id,matchAddress(row,data));
  await persist();
  await new Promise(resolve=>setTimeout(resolve,350));
 }
 const candidates=[...attempts.values()].filter(a=>a.result).length;
 console.log(JSON.stringify({processed:attempts.size,candidates,manualReview:attempts.size-candidates,published:0}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;});
