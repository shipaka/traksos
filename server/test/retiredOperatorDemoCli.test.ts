// The obsolete direct CLI must fail even when the historical operator
// confirmation is supplied. No real configuration, DB or credentials.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

test('retired direct demo issuer refuses before configuration or DB access',()=>{
  const script=fileURLToPath(new URL('../src/ops/provisionOperatorDemo.ts',import.meta.url));
  const source=readFileSync(script,'utf8');
  assert.doesNotMatch(source,/^\s*import\b/m,'Retired CLI must not initialize any dependency');
  for(const confirmed of ['YES','NO']){
    const result=spawnSync(process.execPath,['--import','tsx',script],{
      cwd:fileURLToPath(new URL('..',import.meta.url)),
      env:{PATH:process.env.PATH,NODE_ENV:'production',
        OPERATOR_DEMO_CONFIRM:confirmed,DATABASE_URL:'invalid-retired-demo-fixture'},
      encoding:'utf8',timeout:10000
    });
    assert.ifError(result.error);
    assert.equal(result.status,1);
    assert.equal(result.stdout,'','Do not emit codes or credentials');
    assert.match(result.stderr,/Код не создан/);
    assert.match(result.stderr,/FULL_FIDELITY_SANDBOX\.md/);
  }
});
