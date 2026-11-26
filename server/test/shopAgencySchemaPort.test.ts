import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { migrate } from '../src/db/migrate.ts';

test('agency evidence schema is installed in the disposable database and remains append-only',async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const tables=['cases','documents','allocations','events','reviews','report_snapshots','bank_statements','bank_rows','bank_matches','bank_match_retractions'];
    for(const table of tables){
      const row=await t.db.one<{name:string|null}>('select to_regclass($1)::text as name',['public.shop_agency_'+table]);
      assert.ok(row?.name,'missing agency table '+table);
    }
    assert.deepEqual(await migrate(t.db),[],'applied migrations must not run twice');
    const before=await t.db.one<{n:number}>('select count(*)::int as n from shop_orders');
    const doc=await t.db.one<{id:string}>(`insert into shop_agency_documents(kind,supplier_name,reference,issued_at,amount,mime,file_data,sha256,created_by)
      values('purchase','Synthetic supplier','TEST-ONLY',now(),100,'application/pdf',$1,$2,$3) returning id`,
      [Buffer.from('synthetic disposable test bytes'),'a'.repeat(64),admin.id]);
    assert.ok(doc);
    await assert.rejects(t.db.query("update shop_agency_documents set amount=200 where id=$1",[doc.id]),/immutable/);
    await assert.rejects(t.db.query("delete from shop_agency_documents where id=$1",[doc.id]),/immutable/);
    await t.db.query("update shop_agency_documents set source='manually_checked',review_note='Synthetic review only',verified_by=$2,verified_at=now() where id=$1",[doc.id,admin.id]);
    const reviewed=await t.db.one<{source:string;amount:string}>('select source,amount from shop_agency_documents where id=$1',[doc.id]);
    assert.equal(reviewed?.source,'manually_checked');
    assert.equal(Number(reviewed?.amount),100);
    await assert.rejects(t.db.query("update shop_agency_documents set review_note='Rewritten evidence' where id=$1",[doc.id]),/immutable/);
    const statement=await t.db.one<{id:string}>(`insert into shop_agency_bank_statements(bank_name,account_ref,filename,content_sha256,row_count,csv_data,created_by)
      values('Test bank','TEST-ONLY','test.csv',$1,1,$2,$3) returning id`,
      ['b'.repeat(64),Buffer.from('synthetic test data'),admin.id]);
    assert.ok(statement);
    await assert.rejects(t.db.query("delete from shop_agency_bank_statements where id=$1",[statement.id]),/immutable/);
    const columns=await t.db.query<{column_name:string}>(`select column_name from information_schema.columns where table_schema='public' and table_name='shop_agency_events' and column_name in ('reverses_event_id','correction_reason') order by column_name`);
    assert.deepEqual(columns.map(c=>c.column_name),['correction_reason','reverses_event_id']);
    assert.deepEqual(await t.db.one<{n:number}>('select count(*)::int as n from shop_orders'),before,'schema evidence test must not create real shop orders');
  } finally {await t.close();}
});
