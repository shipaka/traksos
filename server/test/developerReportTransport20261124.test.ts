import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeveloperReportSender,type DeveloperReportNotice} from '../src/services/developerReportDelivery.ts';

const notice:DeveloperReportNotice={
  event:'traksos.developer_report.created',
  reportId:'test-report-id',
  category:'other',
  createdAt:'2026-11-24T00:00:00.000Z',
  adminUrl:'https://example.test/#/admin/section/access',
};
const secret='synthetic-secret-for-test-only';

test('developer webhook validates its endpoint and releases response streams on ACK and failure',async()=>{
  for(const url of ['http://example.test','https://user:pass@example.test','https://example.test?q=x','https://example.test#fragment']){
    assert.equal(createDeveloperReportSender(url,secret),null);
  }
  assert.equal(createDeveloperReportSender('https://example.test/hook','short'),null);
  const sender=createDeveloperReportSender('https://example.test/hook',secret);
  assert.ok(sender);
  const old=globalThis.fetch;
  try{
    for(const status of [200,503]){
      let cancelled=0,calls=0;
      globalThis.fetch=(async(input:unknown,init?:RequestInit)=>{
        calls++;
        assert.equal(String(input),'https://example.test/hook');
        assert.equal(init?.redirect,'error');
        assert.equal(new Headers(init?.headers).get('idempotency-key'),notice.reportId);
        assert.deepEqual(JSON.parse(String(init?.body)),notice);
        return new Response(new ReadableStream<Uint8Array>({
          cancel(){cancelled++;}
        }),{status});
      }) as typeof fetch;
      if(status===200)await sender(notice);
      else await assert.rejects(sender(notice),/delivery_failed/);
      assert.equal(calls,1);
      assert.equal(cancelled,1);
    }
    globalThis.fetch=(async()=>{throw new TypeError('redirect rejected');}) as typeof fetch;
    await assert.rejects(sender(notice),/redirect rejected/);
  }finally{globalThis.fetch=old;}
});
