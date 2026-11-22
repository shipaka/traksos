/**
 * Shared TrakSOS truck banners must be manufacturer-/carrier-neutral.
 * Approved 22 Nov 2026. This guard is intentionally RED until the actual
 * brandless photographic asset is present and all shared references migrate.
 *
 * Do not weaken this check to hide a failing draft: the owner prefers
 * a blocked release over a new branded banner.
 */
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const required='web/public/traksos-unbranded-truck-20261122.avif';
const sharedSources=[
  'web/src/approvedVisuals.ts',
  'web/src/screens/client.tsx',
  'web/src/screens/ownerDesktopHome20261120.css',
  'web/src/approvedPublicInner20261120.css',
  'web/src/screens/guestExplore.tsx',
  'web/src/screens/ownerDesktopHome20261120.tsx',
];
const forbidden=[
  'tracksos-approved-hero-owner-20261119.webp',
  'owner20-photo-background-approved.webp',
  'owner20-artwork-sprite.webp',
];
const failures=[];
if(!existsSync(path.join(root,required))){
  failures.push('Missing real, local, reviewed brandless truck banner asset: '+required);
}
for(const file of sharedSources){
  if(!existsSync(path.join(root,file)))continue;
  const source=readFileSync(path.join(root,file),'utf8');
  for(const asset of forbidden){
    if(source.includes(asset)){
      failures.push(file+' still references common-banner asset containing a named truck: '+asset);
    }
  }
  // Model photos are permitted ONLY within the authenticated user's actual
  // vehicle/garage/history pages or the factual vehicle photo catalog.
  if(file!=='web/src/screens/client.tsx'&&source.includes('/vehicles/models/')){
    failures.push(file+' uses a model catalog photo on a shared banner');
  }
}
if(failures.length){
  console.error('\nBRANDLESS BANNER RELEASE GATE FAILED ('+failures.length+' issues):');
  for(const issue of failures)console.error('  - '+issue);
  console.error('Keep PR Draft and do not deploy until the reviewed assets replace these sources.');
  process.exitCode=1;
}else{
  console.log('Shared truck banners reference only locally bundled neutral assets.');
}
