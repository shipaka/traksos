import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLlmRequest, decodeLlmAnswer, providerReady, safeLocalLlmUrl } from '../src/services/trakbotProvider.ts';

const base = { enabled: true, model: 'demo-model', apiKey: '' };

test('AI is strictly disabled by default and a remote provider requires server-side key', () => {
  assert.equal(providerReady({ ...base, enabled: false, apiKey: 'private' }), false);
  assert.equal(providerReady({ ...base, transport: 'api' }), false);
  assert.equal(makeLlmRequest('rules', 'chat', 200, { ...base, transport: 'api' }), null);
  assert.equal(providerReady({ ...base, apiKey: 'private', transport: 'api' }), true);
  const external = makeLlmRequest('rules', 'chat', 200, { ...base, apiKey: 'private', transport: 'api' });
  assert.equal(external?.url, 'https://api.openai.com/v1/responses');
  assert.equal((external?.init.headers as Record<string, string>).authorization, 'Bearer private');
  const body = JSON.parse(String(external?.init.body));
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 200);
  assert.equal(body.input[0].content, 'chat');
  assert.equal(body.instructions, 'rules');
});

test('self-hosted provider works without external API key, and only accepts loopback endpoints', () => {
  const local = { ...base, transport: 'local' as const, localUrl: 'http://127.0.0.1:8000/v1/chat/completions' };
  assert.equal(providerReady(local), true);
  const req = makeLlmRequest('technical rules', 'question', 320, local);
  assert.equal(req?.url, local.localUrl);
  assert.equal((req?.init.headers as Record<string, string>).authorization, undefined);
  const body = JSON.parse(String(req?.init.body));
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'technical rules');
  assert.equal(body.messages[1].content, 'question');
  assert.equal(body.max_tokens, 320);
  assert.equal(body.store, undefined);
  for (const url of [
    'http://example.com:8000/v1/chat/completions',
    'https://127.0.0.1:8000/v1/chat/completions',
    'http://127.0.0.1:8000/private',
    'http://user:password@127.0.0.1:8000/v1/chat/completions',
    'http://127.0.0.1:8000/v1/chat/completions?target=example.com',
    'http://169.254.169.254:8000/v1/chat/completions',
  ]) {
    assert.equal(safeLocalLlmUrl(url), null, url);
    assert.equal(providerReady({ ...local, localUrl: url }), false);
  }
});

test('provider responses are decoded according to their actual protocol, never silently cross-read', () => {
  const text = { output: [{ content: [{ type: 'output_text', text: 'Давай разберёмся' }] }] };
  const local = { choices: [{ message: { content: 'Нужны замеры' } }] };
  assert.equal(decodeLlmAnswer(text, 'api'), 'Давай разберёмся');
  assert.equal(decodeLlmAnswer(local, 'local'), 'Нужны замеры');
  assert.equal(decodeLlmAnswer(text, 'local'), '');
  assert.equal(decodeLlmAnswer(local, 'api'), '');
  assert.equal(decodeLlmAnswer({ choices: [{ message: { content: [{ type:'text', text:'ignore' }] } }] }, 'local'), '');
});
