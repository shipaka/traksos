import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSandboxPeerHealth, SANDBOX_HANDOFF_PROTOCOL } from '../src/services/sandboxCompatibility.ts';

const prod = 'a'.repeat(40);
const newestSandbox = 'b'.repeat(40);
const healthy = { ok: true, db: true, sandbox: true,
  sandboxHandoffVersion: SANDBOX_HANDOFF_PROTOCOL, buildRevision: prod };

test('admin handoff accepts a healthy sandbox using the same protocol and build', () => {
  assert.deepEqual(assessSandboxPeerHealth(healthy, prod), {
    enabled: true, buildRevision: prod, sandboxRevision: prod, versionsMatch: true,
  });
});

test('admin handoff accepts a newer sandbox while production stays on an older safe build', () => {
  assert.deepEqual(assessSandboxPeerHealth({...healthy, buildRevision: newestSandbox}, prod), {
    enabled: true, buildRevision: prod, sandboxRevision: newestSandbox, versionsMatch: false,
  });
});

test('admin handoff fails closed for unsupported or missing protocol', () => {
  for (const value of [undefined, 0, 2, '1']) {
    const result = assessSandboxPeerHealth({...healthy, sandboxHandoffVersion: value}, prod);
    assert.equal(result.enabled, false);
  }
});

test('admin handoff fails closed for absent sandbox, database outage or unknown build', () => {
  const cases = [
    null,
    {},
    {...healthy, ok: false},
    {...healthy, db: false},
    {...healthy, sandbox: false},
    {...healthy, buildRevision: 'unknown'},
    {...healthy, buildRevision: ''},
    {...healthy, buildRevision: null},
  ];
  for (const peer of cases) assert.equal(assessSandboxPeerHealth(peer, prod).enabled, false);
});
