import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupportService } from '../src/services/support.ts';

function fixture(liveRoles?:string[]) {
  const sqlLog: string[] = [];
  const ticket = { id:'ticket-1', number:9, topic:'Вопрос по операции',
    status:'open', user_id:'owner-1', ledger_entry_id:41, order_id:null,
    created_at:new Date(), sla_deadline_at:null, first_staff_reply_at:null, sla_overdue_at:null };
  let actor:any=null;
  let inTx=false;
  const db: any = {
    tx: async (fn:any) => {
      assert.equal(inTx,false);
      inTx=true;
      try{return await fn(db);}finally{inTx=false;}
    },
    one: async (sql:string,params?:unknown[]) => {
      assert.equal(inTx,true,'private reads must share the transaction');
      sqlLog.push(sql);
      if (sql.includes('from support_tickets')&&sql.includes('for share')) return ticket;
      if (sql.includes('from users')&&sql.includes('for share')) {
        const id=String(params?.[0]);
        assert.equal(id,actor.id);
        return {...actor,roles:liveRoles??actor.roles,status:'active',owner_id:null};
      }
      if (sql.startsWith('select id, name, phone from users'))
        return {id:'owner-1',name:'Владелец',phone:'+79990000000'};
      if (sql.includes('from ledger_entries'))
        return {id:41,kind:'earning',amount:900000,account:'performer',note:'private'};
      throw Error('Unexpected SQL: '+sql);
    },
    query: async (sql:string) => {
      assert.equal(inTx,true,'private reads must share the transaction');
      sqlLog.push(sql);
      if (sql.includes('from support_messages')) return [];
      throw Error('Unexpected query: '+sql);
    },
  };
  const service=new SupportService(db,{} as any,{} as any,()=>new Date());
  return {service:{thread:(u:any,id:string)=>{actor=u;return service.thread(u,id);}},sqlLog};
}
const user=(id:string,roles:string[])=>({id,roles}) as any;
const ledgerReads=(sqlLog:string[])=>sqlLog.filter(s=>s.includes('from ledger_entries')).length;

test('moderator can answer an external support case but cannot read its private ledger',async()=>{
  const {service,sqlLog}=fixture();
  const t=await service.thread(user('mod-1',['moderator']),'ticket-1');
  assert.equal(t.id,'ticket-1');
  assert.equal(t.author?.id,'owner-1');
  assert.equal(t.entry,null);
  assert.equal(ledgerReads(sqlLog),0);
});
test('admin can read ledger of supported ticket',async()=>{
  const {service,sqlLog}=fixture();
  const t=await service.thread(user('admin-1',['admin']),'ticket-1');
  assert.equal(t.entry?.id,41);
  assert.equal(ledgerReads(sqlLog),1);
});
test('ticket owner can read own linked financial operation',async()=>{
  const {service,sqlLog}=fixture();
  const t=await service.thread(user('owner-1',['master']),'ticket-1');
  assert.equal(t.entry?.id,41);
  assert.equal(ledgerReads(sqlLog),1);
});
test('moderator owner can read own ticket ledger but not others',async()=>{
  const {service,sqlLog}=fixture();
  const t=await service.thread(user('owner-1',['moderator']),'ticket-1');
  assert.equal(t.entry?.id,41);
  assert.equal(ledgerReads(sqlLog),1);
});
test('outsider cannot read someone else support ticket or ledger',async()=>{
  const {service,sqlLog}=fixture();
  await assert.rejects(service.thread(user('outsider',['client']),'ticket-1'),(e:any)=>e?.status===403);
  assert.equal(ledgerReads(sqlLog),0);
});

 test('revoked administrator cannot read private ticket or ledger from stale roles',async()=>{
  const {service,sqlLog}=fixture(['client']);
  await assert.rejects(service.thread(user('admin-1',['admin']),'ticket-1'),(e:any)=>e?.status===403);
  assert.equal(ledgerReads(sqlLog),0);
});
