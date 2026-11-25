import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('API bearer must be in Authorization header; URL token is never an HTTP login', async () => {
  const t = await setup();
  try {
    const user = await t.login('+79991231151');
    const token = encodeURIComponent(user.token);
    const urlOnly = await t.api('GET', '/api/me?token=' + token);
    assert.equal(urlOnly.status, 401);
    assert.equal(urlOnly.body.error, 'unauthorized');

    const ticketUrlOnly = await t.api('POST', '/api/auth/realtime-ticket?token=' + token, {});
    assert.equal(ticketUrlOnly.status, 401);
    assert.equal(ticketUrlOnly.body.error, 'unauthorized');

    const headerOnly = ok(await t.api('GET', '/api/me', undefined, user.token));
    const headerAndIgnoredUrl = ok(await t.api('GET', '/api/me?token=incorrect-or-expired', undefined, user.token));
    assert.equal(headerAndIgnoredUrl.id, headerOnly.id);
    assert.equal(headerOnly.id, user.id);
  } finally {
    await t.close();
  }
});
