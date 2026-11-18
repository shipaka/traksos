import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup,ok } from './helpers.ts';

test('road marker travels from request to order and can be continued as tow without losing it',async()=>{
  const t=await setup();
  try {
    const customer=await t.login('+79991112221');
    const road={highway:'М-10',km:87.5,direction:'в сторону Санкт-Петербурга',side:'right'};
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',regionId:'lo',zoneId:'gat',address:'М-10, 87-й км',
      description:'Автомобиль заглох на трассе',site:{place:'road',road}
    },customer.token));
    const data=ok(await t.api('GET','/api/orders/'+created.order.id,undefined,customer.token));
    assert.deepEqual(data.site.road,road);
    assert.equal(data.site.place,'road');
    const invalid=await t.api('POST','/api/orders',{
      service:'electric',regionId:'lo',zoneId:'gat',address:'М-10, 87-й км',
      description:'Помощь',site:{road:{highway:'М-10',km:99_999}},
    },customer.token);
    assert.equal(invalid.status,400);
  }finally{await t.close();}
});
