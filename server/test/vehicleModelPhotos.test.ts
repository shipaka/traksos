import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {vehicleReferencePhoto,vehiclePhotoCoverage} from '../../web/src/vehiclePhotoCatalog.ts';

test('six licensed model photos match strictly by brand, model and generation',()=>{
  const known=[
    ['Renault','Premium 450 DXi',2010,'renault-premium-2006.webp'],
    ['DAF','XF 105.460',2012,'daf-xf105.webp'],
    ['MAN','TGX 18.400',2014,'man-tgx-2007.webp'],
    ['Mercedes-Benz','Actros',2019,'mercedes-actros-2019.webp'],
    ['Volvo','FH 500',2015,'volvo-fh-2013.webp'],
    ['Scania','R 520 V8',2020,'scania-r520-2016.webp'],
  ] as const;
  for(const [brand,model,year,file] of known){
    const photo=vehicleReferencePhoto(brand,model,year);
    assert.ok(photo, 'expected photo for '+brand+' '+model);
    assert.equal(photo?.src,'/vehicles/models/'+file);
    assert.ok(photo?.author && photo.license && photo.sourcePage);
  }
});

test('no random fallback: unknown/ambiguous/different generation gets no picture',()=>{
  const bad=[
    ['КАМАЗ','54901',2024],
    ['MAN','TGS',2014],
    ['MAN','TGX',2023],
    ['Mercedes-Benz','Arocs',2019],
    ['Mercedes-Benz','Actros',2025],
    ['Renault','Magnum',2010],
    ['Volvo','FH16',2015],
    ['Volvo','FH',2025],
    ['Scania','R 520',2014],
    ['Scania','S 520',2020],
    ['DAF','XF106',2014],
    ['Renault','Premium',1999],
    ['SCANIA',null,2021],
    [null,'R520',2020],
    ['Volvo','FH',null],
    ['MAN','TGX',null],
    ['Scania','R520',null],
    ['Mercedes-Benz','Actros',null],
  ] as const;
  for(const [brand,model,year] of bad){
    assert.equal(vehicleReferencePhoto(brand,model,year),null,
      'wrong photograph must not be used for '+brand+' '+model+' '+year);
  }
});

test('Cyrillic manufacturer aliases select the exact listed vehicle',()=>{
  assert.ok(vehicleReferencePhoto('ДАФ','XF105',2010)?.src.endsWith('/daf-xf105.webp'));
  assert.ok(vehicleReferencePhoto('МАН','TGX',2014)?.src.endsWith('/man-tgx-2007.webp'));
  assert.ok(vehicleReferencePhoto('СКАНИЯ','R520',2020)?.src.endsWith('/scania-r520-2016.webp'));
  assert.ok(vehicleReferencePhoto('Мерседес','Actros',2019)?.src.endsWith('/mercedes-actros-2019.webp'));
  assert.ok(vehicleReferencePhoto('Рено','Premium',2010)?.src.endsWith('/renault-premium-2006.webp'));
  assert.ok(vehicleReferencePhoto('Вольво','FH',2014)?.src.endsWith('/volvo-fh-2013.webp'));
});

test('all published model assets are local WebP under 150 KiB and source metadata retained',()=>{
  const sources=JSON.parse(readFileSync(new URL('../../scripts/vehiclePhotoSources.json',import.meta.url),'utf8'));
  assert.equal(vehiclePhotoCoverage.length,6);
  assert.equal(sources.items.length,vehiclePhotoCoverage.length);
  for(const item of sources.items){
    const indexed=vehiclePhotoCoverage.find(x=>x.src.endsWith('/'+item.id+'.webp'));
    assert.ok(indexed, 'missing photo catalogue entry '+item.id);
    assert.equal(indexed?.author,item.author);
    assert.equal(indexed?.license,item.license);
    assert.equal(indexed?.sourcePage,item.sourcePage);
    assert.equal(indexed?.yearMin,item.yearMin);
    assert.equal(indexed?.yearMax,item.yearMax);
    assert.ok(item.redact.length>0, 'all selected photographs need manual plate-redaction check');
    const asset=new URL('../../web/public/vehicles/models/'+item.id+'.webp',import.meta.url);
    const bytes=readFileSync(asset);
    assert.ok(statSync(asset).size>5000 && bytes.length<150000, 'photo must be mobile-sized');
    assert.equal(bytes.subarray(0,4).toString('ascii'),'RIFF');
    assert.equal(bytes.subarray(8,12).toString('ascii'),'WEBP');
  }
});

test('model credit page is accessible to users and lists every licensed photo',()=>{
  const html=readFileSync(new URL('../../web/public/vehicle-photo-credits.html',import.meta.url),'utf8');
  for(const p of vehiclePhotoCoverage){
    assert.ok(html.includes(p.author));
    assert.ok(html.includes(p.sourcePage.replace(/&/g,'&amp;')) ||
      html.includes(p.sourcePage.replace(/&/g,'&amp;').replace(/"/g,'&quot;')));
  }
  assert.match(html,/размытие регистрационных знаков/);
});
