import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {vehicleReferencePhoto,vehicleFamilyReferencePhoto,vehiclePhotoCoverage} from '../../web/src/vehiclePhotoCatalog.ts';

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
    // R440 2010 is only a pending licensed source: never substitute R520.
    ['Scania','R 440',2010],
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
  // Source manifest also contains one not-yet-processed 2010 R440 candidate.
  // Until a plate-redacted WebP is reviewed and actually shipped, it MUST
  // not be counted as a published photo or treated as an R520 substitute.
  const published=sources.items.filter((item:any)=>
    vehiclePhotoCoverage.some(x=>x.src.endsWith('/'+item.id+'.webp')));
  const pending=sources.items.filter((item:any)=>!published.includes(item));
  assert.deepEqual(pending.map((item:any)=>item.id),['scania-r440-2010']);
  assert.equal(published.length,vehiclePhotoCoverage.length);
  for(const item of published){
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


test('generic Scania R cards may use an explicitly labelled family example only in the known generation',()=>{
  assert.equal(vehicleReferencePhoto('Scania','R',2020),null,'strict selector must not become a variant guess');
  const example=vehicleFamilyReferencePhoto('СКАНИЯ','R',2020);
  assert.equal(example?.src,'/vehicles/models/scania-r520-2016.webp');
  assert.match(example?.description??'',/пример семейства.*не точная модификация/);
  for(const [brand,model,year] of [
    ['Scania','R440',2020],['Scania','R450',2020],['Scania','S',2020],['Scania','R',2015],
    ['Scania','R',2026],['Scania','R',null],['Scania','R',2019.5],['Volvo','R',2020],['Scania','R520',2020]
  ] as const) assert.equal(vehicleFamilyReferencePhoto(brand,model,year),null);
});

test('supplied malformed model years never masquerade as absent or valid years',()=>{
  const malformed=[0,1899,2101,2010.5,NaN,Infinity,'unknown','2010.0','2.01e3','0x7da','2010xyz','201','02010'] as const;
  for(const year of malformed){
    for(const [brand,model] of [['Renault','Premium'],['DAF','XF105'],['MAN','TGX']] as const)
      assert.equal(vehicleReferencePhoto(brand,model,year),null,brand+' '+model+' invalid year '+year);
  }
  for(const year of [undefined,null,'','  '] as const){
    assert.ok(vehicleReferencePhoto('Renault','Premium',year));
    assert.ok(vehicleReferencePhoto('DAF','XF105',year));
    assert.equal(vehicleReferencePhoto('MAN','TGX',year),null);
  }
  assert.ok(vehicleReferencePhoto('Renault','Premium',' 2010 '));
  assert.ok(vehicleReferencePhoto('MAN','TGX','2014'));
});

test('family examples require a canonical four-digit year, not a numeric coercion',()=>{
  for(const year of ['2.02e3','0x7e4','2020.0','02020','+2020','2020xyz',2020.5,NaN,Infinity,'',null] as const)
    assert.equal(vehicleFamilyReferencePhoto('Scania','R',year),null,'invalid family year '+year);
  assert.ok(vehicleFamilyReferencePhoto('Scania','R',' 2020 '));
  assert.ok(vehicleFamilyReferencePhoto('Scania','R',2016));
  assert.ok(vehicleFamilyReferencePhoto('Scania','R',2025));
});
