// Bot UI unit test: 30 expressions, safe classification, server/desktop/mobile shared component.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
  assert(html.includes('Trak') && html.includes('SOS'), r.id + ': missing approved truck cap mark');
  assert(html.includes('aria-hidden="true"'), r.id + ': illustration must stay decorative');
}
console.log('TrakBot: all 30 technician reactions, classification and SVG rendering OK');
