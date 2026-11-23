import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagnosticsQuery, diagnosticCsvCell, type DiagnosticFilters }
  from '../../web/src/screens/adminDiagnosticsFilters20261124.ts';
import { checkedSandboxEntryUrl }
  from '../../web/src/screens/adminSandboxEntry20261124.ts';
import { setup,ok } from './helpers.ts';

const blank: DiagnosticFilters={category:'',status:'',since:'',until:'',requestId:''};
const filters=(update:Partial<DiagnosticFilters>):DiagnosticFilters=>({...blank,...update});

test('admin diagnostics: only narrow, valid real server filters; no accidental unrestricted response',()=>{
  assert.equal(diagnosticsQuery(blank),'limit=1000');
  assert.match(diagnosticsQuery(filters({category:'http_server_error',status:'503'})),/category=http_server_error/);
  assert.match(diagnosticsQuery(filters({status:'503'})),/status=503/);
  assert.throws(()=>diagnosticsQuery(filters({status:'0'})),/400 до 599/);
  assert.throws(()=>diagnosticsQuery(filters({status:'600'})),/400 до 599/);
  assert.throws(()=>diagnosticsQuery(filters({status:'4e2'})),/400 до 599/);
  assert.throws(()=>diagnosticsQuery(filters({category:'unknown'})),/категория/);
  assert.throws(()=>diagnosticsQuery(filters({since:'invalid'})),/дата/i);
  assert.throws(()=>diagnosticsQuery(filters({since:'2026-11-24T12:00',
    until:'2026-11-24T11:00'})),/позже/);
  assert.throws(()=>diagnosticsQuery(filters({requestId:'example'})),/UUID/);
  assert.throws(()=>diagnosticsQuery(filters({requestId:'00000000-0000-0000-0000-000000000000 OR 1=1'})),/UUID/);
  const id='12345678-1234-5678-9012-1234567890ab';
  const query=diagnosticsQuery(filters({
    since:'2026-11-24T10:00',until:'2026-11-24T11:00',requestId:' '+id+' '
  }));
  const parsed=new URLSearchParams(query);
  assert.equal(parsed.get('requestId'),id);
  assert.ok(new Date(parsed.get('since')!).getTime() <= new Date(parsed.get('until')!).getTime());
});

test('admin CSV: quoted rows, doubled embedded quotes and formula injection protection',()=>{
  assert.equal(diagnosticCsvCell('normal'),'"normal"');
  assert.equal(diagnosticCsvCell('a,"b"'),'"a,""b"""');
  for(const value of ['=1+1','+SUM(A1:A5)','-3+5','@SUM(1,2)','  =HYPERLINK("http://evil")']){
    const cell=diagnosticCsvCell(value);
    assert.ok(cell.startsWith('"\''), 'spreadsheet must not evaluate formula: '+value);
    assert.ok(cell.endsWith('"'));
  }
  assert.equal(diagnosticCsvCell('line 1\r\nline 2'),'"line 1\r\nline 2"');
});

test('sandbox handoff: only signed-ticket route shape from separate HTTPS origin',()=>{
  const ticket='A'.repeat(64)+'.'+'B'.repeat(43);
  const url='https://sandbox.example.test/#/sandbox-enter?ticket='+ticket;
  assert.equal(checkedSandboxEntryUrl(url,'master','master','https://traksos.example.test'),url);
  assert.throws(()=>checkedSandboxEntryUrl(url,'master','admin','https://traksos.example.test'),/другой роли/);
  assert.throws(()=>checkedSandboxEntryUrl(url.replace('https:','http:'),'master','master','https://traksos.example.test'),/маршруту/);
  assert.throws(()=>checkedSandboxEntryUrl(url.replace('/#/','/evil#/'),'master','master','https://traksos.example.test'),/маршруту/);
  assert.throws(()=>checkedSandboxEntryUrl(url.replace('sandbox.example.test','traksos.example.test'),'master','master','https://traksos.example.test'),/маршруту/);
  assert.throws(()=>checkedSandboxEntryUrl(url+'&role=admin','master','master','https://traksos.example.test'),/неожиданные/);
  assert.throws(()=>checkedSandboxEntryUrl(url.replace('A'.repeat(64),'bad!'), 'master','master','https://traksos.example.test'),/формат/);
  assert.throws(()=>checkedSandboxEntryUrl('https://user:secret@sandbox.example.test/#/sandbox-enter?ticket='+ticket,'master','master','https://traksos.example.test'),/маршруту/);
});

test('real diagnostics HTTP route stays private to an authenticated administrator',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79997774561','client');
    const url='/api/admin/diagnostics?'+diagnosticsQuery(filters({status:'503'}));
    assert.equal((await t.api('GET',url)).status,401);
    assert.equal((await t.api('GET',url,undefined,client.token)).status,403);
    const data=ok(await t.api('GET',url,undefined,admin.token));
    assert.ok(Array.isArray(data.rows));
    assert.equal(data.retentionDays,30);
  }finally{await t.close();}
});

test('real UI uses scoped diagnostics and hides stale financial data after API failures',()=>{
  const src=(path:string)=>readFileSync(new URL('../../web/src/screens/'+path,import.meta.url),'utf8');
  const diagnostics=src('adminDiagnostics.tsx');
  const summary=src('adminSummary.tsx');
  const launcher=src('adminTestCenter.tsx');
  assert.match(diagnostics,/diagnosticsQuery\(filters\)/);
  assert.match(diagnostics,/generation\.current/);
  assert.match(diagnostics,/result\.filterKey === filterKey/);
  assert.match(diagnostics,/result\.ownerId === me\?\.id/);
  assert.match(diagnostics,/disabled=\{!loaded \|\| loading \|\| !rows\.length\}/);
  assert.match(summary,/s\.data\?\.ownerId === me\?\.id/);
  assert.match(summary,/\[me\?\.id\]/);
  assert.match(summary,/Повторить загрузку сводки/);
  assert.match(summary,/Повторить загрузку живых заявок/);
  assert.match(launcher,/checkedSandboxEntryUrl/);
  assert.match(launcher,/Повторить подключение к тестовому серверу/);
});
