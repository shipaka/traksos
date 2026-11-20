// Real Chromium render with the same native JS bridge the Android APK exposes.
// Only local CI. Catches cases where mobile Chrome looks correct but APK guest
// hero reverts to the obsolete absolute overlay and clips the approved truck.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Native guest proof may only target an isolated local CI server');
await mkdir('e2e/shots/android-guest',{recursive:true});
const browser=await chromium.launch();
try {
  for(const width of [320,360,390]){
    const height=width===320?640:width===360?800:844;
    const ctx=await browser.newContext({viewport:{width,height},isMobile:true,
      hasTouch:true,deviceScaleFactor:1,locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
        isApp:()=>true,setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
        appLockEnabled:()=>false,setAppLockEnabled:()=>false
      }});
    });
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    await page.locator('.guest-app .public-landing').waitFor();
    await page.locator('.public-service-tile').first().waitFor();
    await page.evaluate(async()=>{await document.fonts.ready;const image=new Image();
      image.src='/tracksos-approved-hero-owner-20261119.webp';await image.decode();});
    const g=await page.evaluate(()=>{
      const rect=s=>document.querySelector(s)?.getBoundingClientRect();
      const hero=rect('.public-brand-hero');
      const photo=rect('.public-hero-visual');
      const copy=rect('.public-hero-copy');
      const arrows=rect('.public-hero-carousel');
      const style=getComputedStyle(document.querySelector('.public-hero-visual'));
      return {
        native:document.documentElement.classList.contains('traksos-native'),
        browser:document.documentElement.classList.contains('traksos-browser'),
        viewport:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth,
        services:document.querySelectorAll('.public-service-tile').length,
        login:document.querySelectorAll('.guest-header-actions a').length,
        hero:hero&&{top:hero.top,bottom:hero.bottom,width:hero.width},
        photo:photo&&{top:photo.top,bottom:photo.bottom,height:photo.height,width:photo.width},
        copy:copy&&{top:copy.top,bottom:copy.bottom,width:copy.width},
        arrows:arrows&&{top:arrows.top,bottom:arrows.bottom},
        fit:style.backgroundSize,background:style.backgroundImage,
      };
    });
    if(!g.native||g.browser||g.scroll>g.viewport+3||g.services!==6||g.login!==2)
      throw Error(width+'px Android public shell invalid: '+JSON.stringify(g));
    if(!g.hero||!g.photo||!g.copy||!g.arrows||g.fit!=='contain'||
       g.photo.height<100||g.photo.width>g.hero.width+3||
       g.photo.bottom>g.copy.top+8||g.arrows.top<g.copy.top-3)
      throw Error(width+'px Android guest still overlays text/caption on truck: '+JSON.stringify(g));
    if(!g.background.includes('tracksos-approved-hero-owner-20261119')||
       /tracksos-approved-(?:scenic-hero|scania-r520|truck)\.webp/.test(g.background))
      throw Error(width+'px Android guest uses retired artwork: '+g.background);
    if(errors.length)throw Error(width+'px Android guest JS error: '+errors.join('; '));
    await page.screenshot({path:'e2e/shots/android-guest/native-'+width+'-viewport.png'});
    await page.screenshot({path:'e2e/shots/android-guest/native-'+width+'-full.png',fullPage:true});
    await ctx.close();
    console.log('PASS real Android-bridge guest layout '+width+'px: photo above copy, six clickable services, no overflow');
  }
} finally {await browser.close();}
