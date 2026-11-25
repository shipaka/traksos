import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('courier presence sends a private refresh hint only after commit',async()=>{
  const t=await setup();
  try{
    const courier=await t.login('+79997810521');
    const other=await t.login('+79997810522');
    await t.db.query("update users set roles=array['courier']::text[] where id=any($1::uuid[])",[[courier.id,other.id]]);
    const first:any[]=[],second:any[]=[],foreign:any[]=[];
    const socket=(events:any[])=>({readyState:1,send:(data:string)=>events.push(JSON.parse(data))});
    const a=socket(first),b=socket(second),c=socket(foreign);
    t.app.hub.add(courier.id,a);t.app.hub.add(courier.id,b);t.app.hub.add(other.id,c);
    const hints=(events:any[])=>events.filter(e=>e.type==='courier_presence_changed');
    const check=(n:number)=>{
      assert.deepEqual(hints(first),Array.from({length:n},()=>({type:'courier_presence_changed'})));
      assert.deepEqual(hints(second),hints(first));
      assert.deepEqual(hints(foreign),[]);
    };
    const read=async()=>ok(await t.api('GET','/api/courier/presence',undefined,courier.token)).online;
    assert.equal(await read(),false);check(0);
    ok(await t.api('PUT','/api/courier/presence',{online:true},courier.token));
    assert.equal(await read(),true);check(1);
    // Invalid input and rolled-back writes must never publish a success hint.
    assert.ok((await t.api('PUT','/api/courier/presence',{online:'false'},courier.token)).status>=400);
    check(1);
    await t.db.exec(`
      create function reject_test_courier_audit() returns trigger language plpgsql as $$
      begin
        if new.action='courier.availability' then raise exception 'synthetic audit failure'; end if;
        return new;
      end; $$;
      create trigger reject_test_courier_audit before insert on audit_log
      for each row execute function reject_test_courier_audit();
    `);
    try{
      assert.ok((await t.api('PUT','/api/courier/presence',{online:false},courier.token)).status>=400);
      assert.equal(await read(),true);check(1);
    }finally{
      await t.db.exec('drop trigger reject_test_courier_audit on audit_log; drop function reject_test_courier_audit()');
    }
    ok(await t.api('PUT','/api/courier/presence',{online:false},courier.token));
    assert.equal(await read(),false);check(2);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[courier.id]);
    assert.ok((await t.api('PUT','/api/courier/presence',{online:true},courier.token)).status>=400);
    check(2);
    assert.equal((await t.db.one<{online:boolean}>('select online from shop_courier_presence where courier_id=$1',[courier.id]))?.online,false);
  }finally{await t.close();}
});
