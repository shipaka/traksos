import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeText} from '../src/services/communityProfessionalCases.ts';

test('professional club technical text rejects exact customer street/building details',()=>{
  for(const sensitive of [
    'ЭБУ периодически отключается, место осмотра: ул. Ленина, д. 10; проверили питание',
    'Проверили модуль на проспект Мира, дом 24 и уточнили контакты',
    'Ремонт выполнялся на шоссе Энтузиастов, д. 4; код EBS остаётся',
    'Адрес: парковка клиента, ворота 5, блок неисправен'
  ]){
    assert.throws(()=>safeText(sensitive),(error:any)=>
      error?.status===400&&error?.code==='sensitive_technical_text',
      'club message must not carry the client location');
  }
});

test('anonymization preserves useful non-identifying fault descriptions',()=>{
  for(const normal of [
    'На трассе периодически пропадает связь с электронным блоком EBS',
    'Ошибка P0401 после прогрева двигателя, масса и питание проверены',
    'Проверили проводку, напряжение на контактах и состояние CAN-шины'
  ]){
    assert.equal(safeText(normal),normal);
  }
});
