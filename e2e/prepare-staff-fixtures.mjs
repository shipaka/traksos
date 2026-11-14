// LOCAL CI ONLY: staff-security requires a synthetic account with both
// moderator and master roles. Never run against a production database.
import pg from 'pg';
const host = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:8080').hostname;
const url = process.env.CI_LOCAL_DB_URL ?? 'postgres://postgres@127.0.0.1:5432/traksos';
if (!['localhost','127.0.0.1'].includes(host) ||
    !['localhost','127.0.0.1'].includes(new URL(url).hostname))
  throw Error('Staff fixture preparation requires local HTTP and local PostgreSQL');
const db=new pg.Client({connectionString:url});
await db.connect();
try{
  const res=await db.query(
    "update users set roles=ARRAY['master','moderator']::text[] where phone=$1 and 'master'=any(roles) returning id",
    ['+79990000147']
  );
  if(res.rowCount!==1)throw Error('Local synthetic master fixture missing');
  console.log('Local moderator/master security fixture prepared');
}finally{await db.end();}
