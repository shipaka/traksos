import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthUser } from '../src/http/router.ts';
import { setup } from './helpers.ts';
import { ShopAgencyLedger } from '../src/services/shopAgencyLedger.ts';
import { ShopAgencyBankReconciliation } from '../src/services/shopAgencyBankReconciliation.ts';

test('isolated agency services enforce live ACL, preserve document bytes and reject duplicate bank evidence',async()=>{
  const t=await setup();
  try {
    const adminLogin=await t.login('+79990000001');
    const clientLogin=await t.login('+79990000591');
    const getActor=async(id:string)=>{
      const actor=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[id]);
      assert.ok(actor);return actor;
    };
    const admin=await getActor(adminLogin.id),client=await getActor(clientLogin.id);
    const ledger=new ShopAgencyLedger(t.db),bank=new ShopAgencyBankReconciliation(t.db);
    const pdf=Buffer.from('%PDF-1.4\nSynthetic test fixture\n%%EOF');
    const input={kind:'purchase' as const,supplierName:'Synthetic supplier',reference:'TEST-DOC',
      issuedAt:'2026-11-01T00:00:00Z',amount:100,vatAmount:0,quantity:1,
      mime:'application/pdf' as const,base64:pdf.toString('base64')};
    await assert.rejects(ledger.addDocument(client,input),/администратор/);
    await assert.rejects(ledger.addDocument({...client,roles:['admin']},input),/администратор/);
    const doc=await ledger.addDocument(admin,input);
    assert.equal(doc.duplicate,false);
    assert.equal((await ledger.addDocument(admin,input)).duplicate,true);
    const retrieved=await ledger.documentFile(admin,doc.id);
    assert.deepEqual(retrieved.bytes,pdf);
    assert.equal(retrieved.sha256,doc.sha256);
    await assert.rejects(ledger.documentFile(client,doc.id),/администратор/);
    await assert.rejects(ledger.addDocument(admin,{...input,amount:101}),/реквизит|подмен/);
    const csv='transaction_ref;occurred_at;direction;amount_kopecks;note\nTEST-BANK-1;2026-11-02T10:00:00Z;in;100;synthetic\n';
    const statement={bankName:'Synthetic bank',accountRef:'TEST-ACCOUNT',filename:'test.csv',base64:Buffer.from(csv).toString('base64')};
    await assert.rejects(bank.importStatement(client,statement),/администратор/);
    const imported=await bank.importStatement(admin,statement);
    assert.equal(imported.duplicate,false);
    assert.equal(imported.source,'manual_unverified');
    assert.equal((await bank.importStatement(admin,statement)).duplicate,true);
    const rows=await bank.statementRows(admin,imported.id);
    assert.equal(rows.matched,0);
    assert.equal(rows.unmatched,1);
    await assert.rejects(bank.statementRows(client,imported.id),/администратор/);
    // On the disposable fixture only: revoke the live role without changing the
    // actor object. A stale administrator claim must not expose original bytes.
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[admin.id]);
    await assert.rejects(ledger.documentFile(admin,doc.id),/администратор/);
    await assert.rejects(bank.statements(admin),/администратор/);
    await assert.rejects(bank.importStatement(admin,statement),/администратор/);
  }finally{await t.close();}
});
