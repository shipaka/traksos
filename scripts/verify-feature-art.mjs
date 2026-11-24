// Source integrity for the five canonical TrakSOS illustrated services.
// No image codec dependency: sha256 hashes and manifest dimensions are checked
// on raw binary files. Actual crop, readability and branding are reviewed
// separately in screenshot tests on the current PR commit.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const manifest=JSON.parse(await readFile('web/public/feature-art/manifest.json','utf8'));
const keys=['tech','ecu','parts','insurance','inspection'];
const variants=['master','desktop','mobile','android'];
const dimensions={master:[512,512],desktop:[512,300],mobile:[360,210],android:[256,150]};
if(manifest.version!=='2026-11-22-v1') throw Error('Unexpected artwork version');
if(Object.keys(manifest.features).sort().join('|')!==keys.slice().sort().join('|'))
  throw Error('Feature keys changed — update every platform together');
for(const key of keys){
  const item=manifest.features[key];
  if(Object.keys(item.variants).sort().join('|')!==variants.slice().sort().join('|'))
    throw Error(key+': one of four artwork variants is missing');
  for(const variant of variants){
    const f=item.variants[variant];
    const exact=`/feature-art/traksos-feature-${key}-${variant}-20261122.webp`;
    if(f.url!==exact) throw Error(key+': variant URL differs from shared artwork contract');
    if(f.width!==dimensions[variant][0]||f.height!==dimensions[variant][1])
      throw Error(key+': unexpected resolution in '+variant);
    const raw=await readFile('web/public'+f.url);
    if(raw.byteLength!==f.bytes)throw Error(key+': unexpected size in '+variant);
    const hash=createHash('sha256').update(raw).digest('hex');
    if(hash!==f.sha256)throw Error(key+': integrity hash mismatch in '+variant);
  }
}
const component=await readFile('web/src/featureArtwork20261122.tsx','utf8');
const landing=await readFile('web/src/screens/ownerDesktopHome20261120.tsx','utf8');
const cabinet=await readFile('web/src/screens/approvedPcCabinets20261120.tsx','utf8');
const visual=await readFile('web/src/ownerVisualFixes20261122.css','utf8');
if(!component.includes('const compact=native.isApp?image.android:image.mobile')||
   !component.includes('src=native.isApp?image.android:image.desktop'))
  throw Error('Mobile, Android and desktop no longer share master variant registry');
if(!landing.includes('<FeatureArtwork kind={key} />')||
   !cabinet.includes('artKey={inspection?\'inspection\':\'insurance\'}'))
  throw Error('Shared feature art was replaced by local unrelated pictures');
if(!visual.includes('.owner20-feature .traksos-feature-art')||
   !visual.includes('object-fit:cover'))
  throw Error('Full-bleed photo layout missing');
console.log('PASS: five canonical feature masters and 15 responsive variants, complete shared scene identity.');
