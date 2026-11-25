import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('courier pages and full counts are scoped, stable and independent of old 100-row limit', {timeout:120000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const buyer=await t.login('+79997810521');
    const courier=await t.login('+79997810522');
    const foreign=await t.login('+79997810523');
    await t.db.query("update users set roles=array['courier']::text[] where id=any($1::uuid[])",[[courier.id,foreign.id]]);
    // Synthetic bulk fixture deliberately creates tied timestamps.
    // No actual stock, customer deliveries, SMS or payment.
    const seed=async(id:string,n:number,status:string)=>{
      await t.db.query(`with orders as (
        insert into shop_orders(client_id,created_by,items,goods_total,delivery,delivery_price,total,address,payment,status)
        select $1,$1,'[{"productId":"fixture","name":"Учебная деталь","qty":2}]'::jsonb,100,'delivery',0,100,'Учебный адрес','on_receipt',
          case when $5='cancelled' then 'cancelled' else 'ready' end
          from generate_series(1,$4::int)
        returning id
      ) insert into shop_courier_deliveries(shop_order_id,courier_id,assigned_by,status,updated_at)
        select id,$2,$3,$5,'2026-11-25T12:00:00Z'::timestamptz from orders`,
        [buyer.id,id,admin.id,n,status]);
    };
    await seed(courier.id,105,'assigned');
    await seed(courier.id,103,'cancelled');
    await seed(foreign.id,2,'assigned');
    const base='/api/courier/jobs';
    const page=async(scope:string,before?:string)=>ok(await t.api('GET',base+'?scope='+scope+'&limit=30'+(before?'&before='+before:''),undefined,courier.token));
    assert.equal(ok(await t.api('GET',base,undefined,courier.token)).length,100,'old installed client contract');
    const allIds=new Set<string>();
    for(const [scope,expected] of [['active',105],['history',103]] as const){
      let cursor:string|undefined;
      let count=0;
      do{
        const x=await page(scope,cursor);
        assert.equal(x.scope,scope);
        assert.equal(x.activeCount,105);
        assert.equal(x.historyCount,103);
        assert.equal(x.activePackages,210);
        assert.ok(x.items.length<=30);
        for(const item of x.items){
          assert.ok(!allIds.has(item.id),'duplicate or crossed scope');
          allIds.add(item.id);count++;
          assert.equal(item.status,scope==='active'?'assigned':'cancelled');
          assert.equal('code_nonce' in item,false);
        }
        cursor=x.nextBefore??undefined;
      }while(cursor);
      assert.equal(count,expected);
    }
    const foreignPage=ok(await t.api('GET',base+'?scope=active',undefined,foreign.token));
    assert.equal(foreignPage.activeCount,2);
    assert.equal(foreignPage.historyCount,0);
    assert.equal((await t.api('GET',base+'?scope=active&before='+foreignPage.items[0].id,undefined,courier.token)).status,400);
    const history=await page('history');
    assert.equal((await t.api('GET',base+'?scope=active&before='+history.items[0].id,undefined,courier.token)).status,400);
    for(const query of ['?scope=all','?scope=active&limit=101','?scope=active&before=invalid','?limit=1'])
      assert.equal((await t.api('GET',base+query,undefined,courier.token)).status,400);
    assert.equal((await t.api('GET',base+'?scope=active',undefined,buyer.token)).status,403);
  }finally{await t.close();}
});
