// Public link health, never a copyright or mechanical applicability approval.
// It reads committed source metadata only, does not access users/production DB,
// does not mirror OEM PDFs, and never silently deactivates sources.
// node scripts/audit-techbase-links.mjs
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {URL} from 'node:url';

const files=['server/migrations/133_knowledge_open_reference_seed.sql',
  'server/migrations/140_techbase_ebs_manufacturer_portals.sql'];
const sql=(await Promise.all(files.map(path=>readFile(path,'utf8')))).join('\n');
const records=sql.split('\n').map(s=>s.trim()).filter(s=>s.startsWith("('"));
const items=records.map(row=>{
  const slug=row.match(/^\('([^']+)'/u)?.[1];
  const source=[...row.matchAll(/'(https:\/\/[^']+)'/g)].map(m=>m[1])[0];
  const license=row.match(/'(CC-[A-Za-z0-9.-]+|PUBLIC_DOMAIN|LINK_ONLY)'/)?.[1];
  if(!slug||!source||!license)throw new Error('Incomplete source metadata: '+row.slice(0,90));
  const url=new URL(source);
  const hosts=['commons.wikimedia.org','bodybuilder.scania.com',
    'bodybuilder.renault-trucks.com','www.volvotrucks.ca','www.man.eu',
    'rmi.daf.com','www.zf.com','truckservices.knorr-bremse.com','www.haldex.com'];
  if(url.protocol!=='https:'||!hosts.includes(url.hostname)||
     url.username||url.password)
    throw new Error('Unapproved remote host or embedded credentials: '+slug);
  return {slug,sourceUrl:source,license};
});
if(items.length!==20||new Set(items.map(i=>i.slug)).size!==20)
  throw new Error('Expected exactly 20 uniquely identified source records');

const timeout=8000;
async function probe(url,method){
  const response=await fetch(url,{
    method,
    redirect:'follow',
    signal:AbortSignal.timeout(timeout),
    headers:{
      'User-Agent':'TrackSOS-PublicReference-LinkAudit/1.0',
      ...(method==='GET'?{'Range':'bytes=0-0'}:{})
    }
  });
  await response.body?.cancel().catch(()=>{});
  return {statusCode:response.status,
    finalHost:new URL(response.url).hostname,
    redirected:response.redirected};
}
function state(code){
  if(code>=200&&code<400)return 'reachable';
  if(code===401||code===403)return 'authentication_or_restriction';
  if(code===404||code===410)return 'not_found';
  if(code===429)return 'rate_limited';
  return 'uncertain';
}
async function audit(item){
  try{
    let result=await probe(item.sourceUrl,'HEAD');
    if([403,405,501].includes(result.statusCode)){
      try{result=await probe(item.sourceUrl,'GET')}catch{/* keep HEAD finding */}
    }
    return {...item,...result,health:state(result.statusCode)};
  }catch(e){
    return {...item,statusCode:null,health:'network_unavailable',
      error:e instanceof Error?e.name:'network_error'};
  }
}
const out=[];
let next=0;
async function worker(){
  while(next<items.length){
    const id=next++;out[id]=await audit(items[id]);
  }
}
await Promise.all([worker(),worker(),worker()]);
const summary=Object.fromEntries(
  [...new Set(out.map(x=>x.health))].map(k=>[k,out.filter(x=>x.health===k).length]));
const report={
  auditType:'public_metadata_url_reachability_only',
  checkedAt:new Date().toISOString(),count:out.length,
  licenseVerified:false,vehicleApplicabilityVerified:false,
  automaticallyWithdrawn:0,
  warning:'Access restrictions, 403 and transient errors need human review. Never copy source files or disable based on HTTP alone.',
  summary,sources:out
};
await mkdir('test-results',{recursive:true});
await writeFile('test-results/techbase-sources-health.json',JSON.stringify(report,null,2));
console.log('TECHBASE LINK HEALTH (not content/license approval): '+JSON.stringify(summary));
for(const r of out)console.log(r.slug+' '+r.health+' '+(r.statusCode??'network'));
if(out.some(r=>r.health==='not_found')){
  console.error('One or more original pages need human source review; no records were changed');
  process.exitCode=1;
}
