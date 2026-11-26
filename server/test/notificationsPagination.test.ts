import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let a:{id:string;token:string},b:{id:string;token:string};
before(async()=>{
  t=await setup();
  a=await t.login('+79997809311');
  b=await t.login('+79997809312');
});
after(()=>t.close());

test('notification cursor reaches old rows without duplicates, preserves unread and isolates accounts',async()=>{
  const insert=async(userId:string,title:string)=>{
    const row=await t.db.one<{id:number}>(
      "insert into notifications(user_id,kind,title,body,data) values ($1,'order',$2,'Текст','{}'::jsonb) returning id",
      [userId,title]);
    assert.ok(row);
    return Number(row.id);
  };
  const own:number[]=[];
  for(let i=0;i<105;i++){
    own.push(await insert(a.id,'Уведомление '+i));
    if(i===50) await insert(b.id,'Чужое');
  }
  const foreign=await insert(b.id,'Чужое последнее');
  const route='/api/me/notifications';
  const get=async(suffix:string,token=a.token)=>ok(await t.api('GET',route+suffix,undefined,token));
  const ids=(page:any)=>page.items.map((item:any)=>Number(item.id));
  const first=await get('');
  assert.equal(first.unread,105);
  assert.deepEqual(ids(first),own.slice(5).reverse());
  assert.equal(first.nextBefore,own[5]);
  const newer=await insert(a.id,'Новое после первой страницы');
  const second=await get('?before='+first.nextBefore);
  assert.deepEqual(ids(second),own.slice(0,5).reverse());
  assert.equal(second.nextBefore,null);
  assert.equal(second.unread,106);
  assert.equal(new Set([...ids(first),...ids(second)]).size,105);
  const fresh=await get('?limit=2');
  assert.deepEqual(ids(fresh),[newer,own[104]]);
  assert.equal(fresh.nextBefore,own[104]);
  const other=await get('?limit=100',b.token);
  assert.equal(other.unread,2);
  assert.equal(other.items.length,2);
  assert.equal(ids(other)[0],foreign);
  assert.ok(ids(other).every((id:number)=>!own.includes(id)&&id!==newer));
  const foreignBoundary=await get('?before='+foreign,b.token);
  assert.equal(foreignBoundary.items.length,1);
  const old=own[0];
  assert.equal((await t.api('POST',route+'/'+old+'/read',{},b.token)).status,404);
  assert.equal(ok(await t.api('POST',route+'/'+old+'/read',{},a.token)).ok,true);
  const oldest=await get('?before='+own[1]);
  assert.deepEqual(ids(oldest),[old]);
  assert.ok(oldest.items[0].read_at);
  assert.equal(oldest.unread,105);
  assert.equal((await get('?before='+old)).nextBefore,null);
  assert.deepEqual(ids(await get('?before='+old)),[]);
  for(const suffix of ['?before=0','?before=-1','?before=1.5','?before=','?before=2147483648','?before=abc','?limit=0','?limit=101','?limit=1.5','?limit=','?limit=NaN']){
    assert.equal((await t.api('GET',route+suffix,undefined,a.token)).status,400,suffix);
  }
  assert.equal((await t.api('GET',route+'?limit=2')).status,401);
});
