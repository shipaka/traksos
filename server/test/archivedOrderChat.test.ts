import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { quickRepliesFor } from '../src/services/chat.ts';

test('quick replies never present arrival as a chat message, especially after closure', () => {
  for (const status of ['searching','accepted','en_route','arrived','working','awaiting_confirmation','completed','cancelled','no_performer']) {
    for (const service of ['electric','consult']) {
      for (const actor of ['client','performer','admin']) {
        const available = quickRepliesFor(service,status,actor);
        assert.ok(!available.includes('Я на месте'), service + '/' + status + '/' + actor);
        if (['completed','cancelled','no_performer'].includes(status)) {
          assert.deepEqual(available, [], 'archived status must not offer quick replies');
        }
      }
    }
  }
});

test('closed orders: every role sees immutable chat history; text/quick posts fail even under concurrency', {timeout:60000}, async () => {
  const t=await setup();
  try {
    const client=await t.login('+79993551001');
    const performer=await t.login('+79993551002','master');
    const admin=await t.login('+79990000001');
    const stranger=await t.login('+79993551003');
    for (const status of ['completed','cancelled','no_performer']) {
      const order=ok(await t.api('POST','/api/orders',{
        service:'electric',zoneId:'spb',
        description:'Проверка закрытого архива: '+status
      },client.token)).order;
      await t.app.orders.systemMessage(order.id,'Сумма подтверждена. Заявка архивирована.');
      // A terminal order must remain readable, irrespective of how the
      // preceding offer/payment workflow reached this terminal state.
      await t.db.query('update orders set status=$2, performer_id=$3 where id=$1',
        [order.id,status,performer.id]);
      const initial=await t.db.query<{id:number}>('select id from chat_messages where order_id=$1',[order.id]);
      assert.ok(initial.length >= 1);
      for (const user of [client,performer,admin]) {
        const history=ok(await t.api('GET',`/api/orders/${order.id}/messages`,undefined,user.token));
        assert.deepEqual(history.quickReplies,[]);
        assert.ok(history.messages.some((m:any)=>m.body==='Сумма подтверждена. Заявка архивирована.'));
        const responses=await Promise.all(Array.from({length:12},(_,index)=>
          t.api('POST',`/api/orders/${order.id}/messages`, {
            kind:index%2?'quick':'text',
            body:index%2?'Буду через 10 минут':'Отправка после закрытия'
          }, user.token)));
        assert.ok(responses.every(r=>r.status===409&&r.body.error==='chat_closed'),
          status+' denied for every role: '+JSON.stringify(responses.map(x=>[x.status,x.body?.error])));
      }
      const after=await t.db.query<{id:number}>('select id from chat_messages where order_id=$1',[order.id]);
      assert.deepEqual(after,initial,'closed chat must not accept even one concurrent post');
      const outsider=await t.api('GET',`/api/orders/${order.id}/messages`,undefined,stranger.token);
      assert.ok([403,404].includes(outsider.status),'foreign user cannot read archived messages');
      if (status==='completed') {
        const ticket=ok(await t.api('POST','/api/support',{
          topic:'Не согласен с суммой',orderId:order.id,
          text:'Хочу уточнить сумму по завершённому заказу'
        },client.token));
        assert.equal(ticket.order.id,order.id,'support remains available after completion');
      }
    }
  } finally { await t.close(); }
});
