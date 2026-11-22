/**
 * Release gate for approved shared-banner photography.
 * The platform name TrakSOS on a trailer is ALLOWED; third-party truck
 * manufacturer emblems and carrier marks are not. The owner requires a
 * faithful local RETOUCH of the approved original photo, not a replacement.
 *
 * This gate deliberately fails until the faithful local retouch has been
 * bundled and switched into shared usages. It cannot alone certify an
 * invisible edit: reviewers must inspect exact before/after images, a
 * changed-pixel mask and the real browser/Android screenshot.
 */
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const approvedRetouch='web/public/tracksos-approved-hero-owner-20261119-retouched.webp';
const sharedSources=[
  'web/src/approvedVisuals.ts',
  'web/src/screens/client.tsx',
  'web/src/screens/ownerDesktopHome20261120.css',
  'web/src/approvedPublicInner20261120.css',
  'web/src/screens/guestExplore.tsx',
  'web/src/screens/ownerDesktopHome20261120.tsx'
];
// Existing source files are not safe for banners until the ORIGINAL scene is
// seamlessly retouched to remove third-party manufacturer/courier markings.
// TrakSOS lettering on a trailer does NOT itself make the photo disallowed.
const oldWithOtherMarks=[
  'tracksos-approved-hero-owner-20261119.webp',
  'owner20-photo-background-approved.webp',
  'owner20-artwork-sprite.webp'
];
const problems=[];
if(!existsSync(path.join(root,approvedRetouch))){
  problems.push('Reviewed seamless retouch of approved original is missing: '+approvedRetouch);
}
for(const file of sharedSources){
  if(!existsSync(path.join(root,file)))continue;
  const content=readFileSync(path.join(root,file),'utf8');
  for(const asset of oldWithOtherMarks){
    if(content.includes(asset)){
      problems.push(file+' still references an unretouched original with a manufacturer mark: '+asset);
    }
  }
  if(file!=='web/src/screens/client.tsx' && content.includes('/vehicles/models/')){
    problems.push(file+' references manufacturer model-photo catalog on a shared banner');
  }
}
if(problems.length){
  console.error('\nAPPROVED TRUCK RETOUCH RELEASE GATE: '+problems.length+' blockers');
  problems.forEach(problem=>console.error(' - '+problem));
  console.error('Do not bypass this gate. Review original vs retouch at native size, 200-400%, and real screens.');
  process.exitCode=1;
}else{
  console.log('Shared references switched to locally retouched approved photography.');
  console.log('Visual approval of seamless retouch and real screenshot is STILL mandatory.');
}
