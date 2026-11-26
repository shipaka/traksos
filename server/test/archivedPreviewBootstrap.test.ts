import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const deploy=fileURLToPath(new URL('../../deploy/',import.meta.url));

test('archived owner preview bootstrap refuses before Docker or configuration',()=>{
  const dir=mkdtempSync(join(tmpdir(),'traksos-preview-archive-'));
  try{
    const marker=join(dir,'docker-invoked');
    // A fake Docker command records any invocation without touching a server.
    writeFileSync(join(dir,'docker'),'#!/bin/sh\nprintf invoked > "$TRAKSOS_TEST_MARKER"\nexit 0\n',{mode:0o700});
    const result=spawnSync('bash',[join(deploy,'provision-preview-admin.sh')],{
      cwd:dir,encoding:'utf8',timeout:5000,
      env:{...process.env,PATH:dir+':'+process.env.PATH,TRAKSOS_TEST_MARKER:marker},
    });
    assert.ifError(result.error);
    assert.equal(result.status,1);
    assert.match(result.stderr,/ARCHIVED.*2026-11-13 21:00 UTC/);
    assert.equal(existsSync(marker),false,'archived command must not contact Docker');
    assert.equal(result.stdout,'');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('both deployment guides distinguish archived preview from existing login and sandbox',()=>{
  const guide=readFileSync(join(deploy,'ADMIN-PREVIEW-ACCESS.md'),'utf8');
  const demo=readFileSync(join(deploy,'TEMPORARY-DEMO-ACCESS.md'),'utf8');
  assert.match(guide,/ARCHIVED/);
  assert.match(guide,/13 ноября 2026/);
  assert.match(guide,/12 ролями/);
  assert.match(guide,/Открыть тест-центр/);
  assert.match(guide,/RELEASE-GATES\.md/);
  assert.match(demo,/архивная.*13 ноября 2026/);
  assert.doesNotMatch(guide,/ближайшей полуночи|bash deploy\/provision-preview-admin\.sh/);
  assert.doesNotMatch(demo,/отдельная первоначальная инициализация администратора/);
});
