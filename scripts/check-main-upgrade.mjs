// Upgrade-safety smoke test: recreate ONLY the current main migrations in an
// isolated disposable CI PostgreSQL, retain synthetic records, then apply the
// release candidate migrations. Never connect to a production database.
import {execFileSync} from 'node:child_process';

const url=process.env.TEST_DATABASE_URL;
if(process.env.CI!=='true'||!url||new URL(url).pathname!=='/traksos_test'){
  throw new Error('REFUSED: this migration smoke may run ONLY on the CI traksos_test database');
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024});
const base='FETCH_HEAD';
if(git('cat-file','-t',base).trim()!=='commit'){
  throw new Error('Missing fetched main commit; run git fetch --no-tags --depth=1 origin main');
}
const mainSha=git('rev-parse',base).trim();
const mainFiles=git('ls-tree','-r','--name-only',base,'--','server/migrations')
  .trim().split('\n').filter(f=>/^server\/migrations\/[a-zA-Z0-9_]+\.sql$/.test(f)).sort();
if(mainFiles.length<20)throw new Error('Missing main baseline migrations; refusing false-green upgrade test');

const {createDb}=await import('../server/src/db/index.ts');
const {migrate}=await import('../server/src/db/migrate.ts');
const db=await createDb(url);
try{
  // This database is created by the CI postgres service, never a user database.
  await db.exec('drop schema if exists public cascade; create schema public;');
  await db.exec("create table schema_migrations(name text primary key, applied_at timestamptz not null default now())");
  for(const file of mainFiles){
    const sql=git('show',base+':'+file);
    // Mirror the exact migrate.ts transaction semantics for the MAIN schema.
    const name=file.slice('server/migrations/'.length);
    await db.exec('begin;\n'+sql+'\ninsert into schema_migrations(name) values ('+
      "'"+name.replace(/'/g,"''")+"');\ncommit;");
  }

  // Seed ordinary synthetic records before upgrading, to prove data survives.
  const seed=await db.one(
    "insert into users(phone,name,roles) values($1,$2,ARRAY['client']) returning id",
    ['+79990000199','CI EXISTING USER (synthetic)']);
  if(!seed?.id)throw new Error('Cannot seed existing-main user');
  const vehicle=await db.one(
    'insert into vehicles(owner_id,brand,model,year) values($1,$2,$3,$4) returning id',
    [seed.id,'Scania','R-series',2012]);
  if(!vehicle?.id)throw new Error('Cannot seed main vehicle');
  const oldCount=mainFiles.length;
  const changes=await migrate(db);
  if(changes.length===0)throw new Error('No candidate migrations were applied');

  const saved=await db.one(
    'select u.id as user_id,u.phone,v.id as vehicle_id,v.brand,v.year '+
    'from users u join vehicles v on v.owner_id=u.id where u.id=$1 and v.id=$2',
    [seed.id,vehicle.id]);
  if(saved?.user_id!==seed.id || saved.vehicle_id!==vehicle.id ||
      saved.brand!=='Scania'||Number(saved.year)!==2012) {
    throw new Error('Existing main user/vehicle data changed during candidate upgrade');
  }
  const meta=await db.query(
    "select column_name from information_schema.columns "+
    "where table_schema='public' and table_name='orders' and "+
    "column_name in ('warranty_days','ecu_due_at','ecu_extensions_count')");
  if(meta.length!==3)throw new Error('Missing candidate warranty/ECU columns after upgrade');

  const applied=await db.query('select name from schema_migrations');
  if(applied.length!==oldCount+changes.length)throw new Error('Migration accounting mismatch');
  const second=await migrate(db);
  if(second.length)throw new Error('Repeat migration re-applied existing scripts');
  console.log(JSON.stringify({
    status:'PASS',mode:'disposable_CI_only',mainSha:mainSha.slice(0,12),
    mainMigrations:oldCount,addedMigrations:changes.length,
    oldUserAndVehiclePreserved:true,idempotent:true
  }));
}finally{
  await db.close();
}
