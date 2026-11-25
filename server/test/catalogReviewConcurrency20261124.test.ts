// Real HTTP + PostgreSQL regression: licensed parts reference rows must never
// become approved with stale review data after concurrent source re-import.
// Uses only the disposable CI database; no supplier API or real part inventory.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let admin:{token:string;id:string};
before(async()=>{t=await setup();admin=await t.login('+79990000001')});
after(async()=>{await t?.close()});
const path='/api/admin/shop/catalog';
const row=(suffix:string,name:string)=>({
  brand:'Scania',article:'CI-CATALOG-'+suffix,name,
  category:'engine',searchTerms:'насос диагностика',
});
const batch=(rows:any[],dryRun=false)=>({
  sourceNote:'Синтетические данные регрессионного теста, разрешение CI',
  rightsConfirmed:true,dryRun,rows,
});
async function find(article:string,token:string){
  const items=ok(await t.api('GET',path+'?state=all&q='+encodeURIComponent(article),undefined,token)).items;
  const entry=items.find((v:any)=>v.article===article);
  assert.ok(entry,article+' must exist in the actual catalog');
  return entry;
}
const approval=(v:any,reviewed:boolean)=>({
  reviewed,expectedUpdatedAt:v.updatedAt,
  expectedName:v.name,expectedSourceNote:v.sourceNote,
  expectedBrand:v.brand,expectedArticle:v.article,expectedCategory:v.category,
  expectedSearchTerms:v.searchTerms,
});

test('admin catalog: dry-run cannot publish, fresh review succeeds and duplicate approval is a no-op',async()=>{
  const outsider=await t.login('+79993337771');
  const part=row('REVIEW-01','Гидравлический насос CI');
  const blocked=await t.api('POST',path+'/import',batch([part]),outsider.token);
  assert.equal(blocked.status,403);
  const deniedRights=await t.api('POST',path+'/import',{
    ...batch([part]),rightsConfirmed:false,
  },admin.token);
  assert.ok(deniedRights.status>=400);
  const trial=ok(await t.api('POST',path+'/import',batch([part],true),admin.token));
  assert.equal(trial.processed,1);
  assert.equal(trial.published,0);
  assert.equal((await t.db.query('select id from shop_catalog_entries where article=$1',[part.article])).length,0);
  const imported=ok(await t.api('POST',path+'/import',batch([part]),admin.token));
  assert.equal(imported.published,0);
  const entry=await find(part.article,admin.token);
  assert.equal(entry.reviewed,false);
  const before=(await t.db.one<{n:number}>(
    "select count(*)::int as n from audit_log where action='shop.catalog_review'"))!.n;
  ok(await t.api('POST',path+'/'+entry.id+'/review',approval(entry,true),admin.token));
  const again=await find(part.article,admin.token);
  assert.equal(again.reviewed,true);
  // Repeated approval with the CURRENT version is safe, not another audit.
  const repeated=ok(await t.api('POST',path+'/'+again.id+'/review',approval(again,true),admin.token));
  assert.equal(repeated.unchanged,true);
  const after=(await t.db.one<{n:number}>(
    "select count(*)::int as n from audit_log where action='shop.catalog_review'"))!.n;
  assert.equal(after,before+1);
  // Identical repeat import must preserve approved provenance and version.
  ok(await t.api('POST',path+'/import',batch([part]),admin.token));
  assert.equal((await find(part.article,admin.token)).reviewed,true);
});

test('re-import invalidates visible proof; stale confirmation cannot approve replaced text',async()=>{
  const original=row('REVIEW-02','Тормозной диск CI исходный');
  ok(await t.api('POST',path+'/import',batch([original]),admin.token));
  const seen=await find(original.article,admin.token);
  const replaced={...original,name:'Тормозной диск CI новая редакция'};
  ok(await t.api('POST',path+'/import',batch([replaced]),admin.token));
  const stale=await t.api('POST',path+'/'+seen.id+'/review',approval(seen,true),admin.token);
  assert.equal(stale.status,400);
  assert.equal(stale.body.error,'catalog_entry_changed');
  const after=await find(original.article,admin.token);
  assert.equal(after.name,replaced.name);
  assert.equal(after.reviewed,false);
  ok(await t.api('POST',path+'/'+after.id+'/review',approval(after,true),admin.token));
  assert.equal((await find(original.article,admin.token)).reviewed,true);
});

test('concurrent review and changed import never leave an unreviewed replacement approved',async()=>{
  const original=row('REVIEW-03','Тестовый датчик давления CI один');
  ok(await t.api('POST',path+'/import',batch([original]),admin.token));
  const visible=await find(original.article,admin.token);
  const changed={...original,name:'Тестовый датчик давления CI два'};
  const [review,imported]=await Promise.all([
    t.api('POST',path+'/'+visible.id+'/review',approval(visible,true),admin.token),
    t.api('POST',path+'/import',batch([changed]),admin.token),
  ]);
  assert.equal(imported.status,200);
  assert.ok(review.status===200||review.status===400);
  const saved=await find(original.article,admin.token);
  assert.equal(saved.name,changed.name);
  assert.equal(saved.reviewed,false,'a new re-import MUST return to unreviewed');
});

test('reviewed source is required even for old mobile admin clients without expected revision',async()=>{
  const item=row('REVIEW-04','Клапан тестовый CI');
  ok(await t.api('POST',path+'/import',batch([item]),admin.token));
  const entry=await find(item.article,admin.token);
  await t.db.query('update shop_catalog_entries set source_note=$2 where id=$1',[entry.id,'']);
  const result=await t.api('POST',path+'/'+entry.id+'/review',{reviewed:true},admin.token);
  assert.equal(result.status,400);
  assert.equal(result.body.error,'missing_provenance');
  assert.equal((await find(item.article,admin.token)).reviewed,false);
});

test('same-millisecond category mutation cannot bypass visible review snapshot',async()=>{
  const entry=row('REVIEW-05','Новый тестовый датчик CI');
  ok(await t.api('POST',path+'/import',batch([entry]),admin.token));
  const visible=await find(entry.article,admin.token);
  await t.db.query(
    "update shop_catalog_entries set category='sensors', updated_at=$2::timestamptz where id=$1",
    [visible.id,visible.updatedAt]);
  const denied=await t.api('POST',path+'/'+visible.id+'/review',approval(visible,true),admin.token);
  assert.equal(denied.status,400);
  assert.equal(denied.body.error,'catalog_entry_changed');
  assert.equal((await find(entry.article,admin.token)).reviewed,false);
});


test('opposite-order overlapping imports both finish and preserve a single identity per part',async()=>{
  const first=row('ORDER-01','Тестовый насос первый');
  const second=row('ORDER-02','Тестовый насос второй');
  const variants=[first,second].map(p=>({...p,name:p.name+' обновлённый'}));
  const replies=await Promise.all([
    t.api('POST',path+'/import',batch([first,second]),admin.token),
    t.api('POST',path+'/import',batch([...variants].reverse()),admin.token),
  ]);
  for(const reply of replies) assert.equal(reply.status,200,JSON.stringify(reply.body));
  const saved=await t.db.query<{article:string;name:string;reviewed:boolean}>(
    'select article,name,reviewed from shop_catalog_entries where article=any($1::text[]) order by article',
    [[first.article,second.article]]);
  assert.equal(saved.length,2);
  assert.equal(saved.every(p=>!p.reviewed),true);
  assert.ok(saved.every((p,i)=>p.name===[first,second][i].name) ||
    saved.every((p,i)=>p.name===variants[i].name));
});

test('reference manifest and paginated deltas include parallel approvals and subsequent tombstone',async()=>{
  await t.app.settings.set('shop',{enabled:true},admin.id);
  const endpoint='/api/shop/catalog/index';
  try {
    const start=ok(await t.api('GET',endpoint+'/manifest',undefined,admin.token));
    assert.equal(start.enabled,true);
    const parts=[row('DELTA-01','Тестовый фильтр первый'),row('DELTA-02','Тестовый фильтр второй')];
    ok(await t.api('POST',path+'/import',batch(parts),admin.token));
    const entries=await Promise.all(parts.map(p=>find(p.article,admin.token)));
    const results=await Promise.all(entries.map(e=>t.api('POST',path+'/'+e.id+'/review',approval(e,true),admin.token)));
    for(const reply of results) assert.equal(reply.status,200,JSON.stringify(reply.body));
    const end=ok(await t.api('GET',endpoint+'/manifest',undefined,admin.token));
    assert.equal(end.count,start.count+2);
    assert.ok(BigInt(end.revision)>BigInt(start.revision));
    let cursor=start.revision;
    const seen=new Set<string>();
    for(let i=0;i<10;i++){
      const page=ok(await t.api('GET',endpoint+'/changes?after='+cursor+'&limit=1',undefined,admin.token));
      assert.equal(page.revision,end.revision);
      for(const item of page.rows){
        assert.ok(BigInt(item[0])>BigInt(cursor));
        if(item.length>2)seen.add(item[1]);
      }
      if(!page.next)break;
      cursor=page.next;
    }
    assert.ok(entries.every(e=>seen.has(e.id)));
    const empty=ok(await t.api('GET',endpoint+'/changes?after='+end.revision,undefined,admin.token));
    assert.deepEqual(empty.rows,[]);
    assert.equal(empty.next,null);
    assert.equal(empty.revision,end.revision);
    const current=await find(parts[0].article,admin.token);
    ok(await t.api('POST',path+'/'+current.id+'/review',approval(current,false),admin.token));
    const delta=ok(await t.api('GET',endpoint+'/changes?after='+end.revision,undefined,admin.token));
    assert.ok(delta.rows.some((item:any[])=>item.length===2&&item[1]===current.id));
    const final=ok(await t.api('GET',endpoint+'/manifest',undefined,admin.token));
    assert.equal(final.count,end.count-1);
    assert.equal(final.revision,delta.revision);
  } finally {
    await t.app.settings.set('shop',{enabled:false},admin.id);
  }
});
