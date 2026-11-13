import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRoles} from '../src/domain/roles.ts';

test('inspection-only operator cannot add client, driver or repair roles',()=>{
  for(const role of ['client','driver','master','tow','service']){
    assert.throws(()=>validateRoles(['inspection_operator'],[role]),/отдельный аккаунт/);
  }
});

test('inspection operator and insurer may share a partner account',()=>{
  assert.deepEqual(validateRoles(['inspection_operator'],['insurer']),['inspection_operator','insurer']);
});
