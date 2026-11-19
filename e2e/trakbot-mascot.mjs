// Bot UI unit test: 30 expressions, safe classification, server/desktop/mobile shared component.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const result = await build({
  entryPoints: ['web/src/trakbotMascot.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
});
const code = result.outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
const { BOT_REACTIONS, TrakBotMascot, botReactionFor } = mod.exports;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

assert.equal(BOT_REACTIONS.length, 30, 'there must be exactly 30 approved reaction variants');
assert.equal(new Set(BOT_REACTIONS.map((r) => r.id)).size, 30, 'reaction IDs must be unique');
assert(BOT_REACTIONS.every((r) => r.label && r.mark && r.face), 'all variants have a visible character pose');
assert.equal(botReactionFor('Немедленно остановитесь! Тормоза неисправны.'), 'stop');
assert.equal(botReactionFor('К сожалению, вы не записаны, запись не подтверждена.'), 'thinking');
assert.notEqual(botReactionFor('Работа не выполнена.'), 'done', 'negative status must not look successful');
assert.equal(botReactionFor('Привет! Что с машиной?'), 'hello');
assert.equal(botReactionFor('Ошибка P0420: нужна проверка'), 'diagnostic');
assert.equal(botReactionFor('Спасибо, очень помогли'), 'thanks');
assert.equal(botReactionFor('Все готово!'), 'done');

for (const r of BOT_REACTIONS) {
  const html = renderToStaticMarkup(React.createElement(TrakBotMascot, { reaction: r.id, size: 'small' }));
  assert(html.includes('trakbot-mascot-truck'), r.id + ': missing common mascot');
  assert(html.includes('data-reaction="' + r.id + '"'), r.id + ': wrong approved reaction frame');
  assert(html.includes('background-position:'), r.id + ': missing sprite frame coordinates');
  assert(html.includes('aria-hidden="true"'), r.id + ': illustration must stay decorative');
}
const sprite = await readFile('web/public/trakbot-approved-30.webp');
assert.equal(sprite.length, 5018, 'approved sprite file size changed');
assert.equal(createHash('sha256').update(sprite).digest('hex'),
  'b60f010983f80fd5845e1b32c1ee4c5d9ab6be8e22a78e47a2117648c0288c55',
  'approved sprite must remain the exact owner-selected 30-pose variant, no redraw');
console.log('TrakBot: all 30 genuine owner-approved frames and reactions OK');
