// Pure CSV import regression. The production parser is transformed from its
// actual TS source; no backend calls and no fake prices/supplier credentials.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {transform} from 'esbuild';
const source=await readFile(new URL('../web/src/catalogCsv.ts',import.meta.url),'utf8');
const compiled=await transform(source,{loader:'ts',format:'esm',target:'es2022'});
const {parseCatalogCsv}=await import('data:text/javascript;base64,'+
  Buffer.from(compiled.code).toString('base64'));
const categories={engine:'Двигатель',brakes:'Тормозная система'};
const header='бренд;артикул;название;категория;синонимы';
const csv=items=>header+'\n'+items.join('\n')+'\n';
const good=parseCatalogCsv(csv([
  'Scania;12345;"Насос, топливный";Двигатель;diesel насос',
  'VOLVO;A-777;"Суппорт ""правый""";brakes;суппорт',
]),categories);
assert.equal(good.length,2);
assert.equal(good[0].category,'engine');
assert.equal(good[0].name,'Насос, топливный');
assert.equal(good[1].name,'Суппорт "правый"');
assert.equal(good[1].category,'brakes');

function invalid(value,pattern){
  assert.throws(()=>parseCatalogCsv(value,categories),pattern);
}
// These limits exactly match server src/app.ts import schema.
invalid(csv(['V'.repeat(81)+';AA;Название;engine;']),/80/);
invalid(csv(['Scania;'+ 'A'.repeat(101)+';Название;engine;']),/артикул|100|строка/i);
invalid(csv(['Scania;ABC;'+'Т'.repeat(121)+';engine;']),/120/);
invalid(csv(['Scania;ABC;Название;engine;'+'x'.repeat(401)]),/400/);
invalid(csv(['Scania;ABC;Название;unspecified;']),/неизвестная категория/);
invalid(csv(['Scania;ABC;Название;engine;',' scania ;ABC;Другая;engine;']),/повторяется/);
invalid(csv(['Scania;ABC;"Не закрыли;engine;']),/кавычки/);
invalid(csv(['Scania;ABC;Наименование;engine;bad\u0000value']),/управляющие символы/);
const many=Array.from({length:10_001},(_,i)=>'Scania;CI-'+i+';Название;engine;');
invalid(csv(many),/10 000 строк/);
assert.throws(()=>parseCatalogCsv('a'.repeat(2_000_001),categories),/2 МБ/);
console.log('PASS: catalog CSV bounds, quoting, category, duplicates, control chars, 10000 line cap');
