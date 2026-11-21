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
  for(const width of [320,360,390,900,960,1200]){
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
        home:!!document.querySelector('.guest-app.guest-home'),
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
    if(!g.native||!g.home||g.browser||g.scroll>g.viewport+3||g.services!==6||g.login!==2)
      throw Error(width+'px Android public shell invalid: '+JSON.stringify(g));
    if(await page.locator('.owner20-home').count())
      throw Error(width+'px native guest accidentally switched to 617 desktop home');
    const accent=await page.locator('.public-brand-hero h1 em').evaluate(el=>getComputedStyle(el).color);
    if(accent!=='rgb(255, 106, 19)')
      throw Error(width+'px obsolete magenta guest headline returned: '+accent);
    if(!await page.locator('.guest-header-actions a[href="#/login"]').isVisible() ||
       !await page.locator('.guest-header-actions a[href="#/register"]').isVisible())
      throw Error(width+'px guest requires visible login and registration buttons');
    if(width>=900 && (!g.hero||!g.photo||!g.copy||g.fit!=='contain'||
       g.photo.bottom>g.copy.top+8||g.photo.width>g.hero.width+3))
      throw Error(width+'px wide Android guest image covers copy instead of preceding it: '+JSON.stringify(g));
    if(width<900 && (!g.hero||!g.photo||!g.copy||!g.arrows||g.fit!=='contain'||
       g.photo.height<100||g.photo.width>g.hero.width+3||
       g.photo.bottom>g.copy.top+8||g.arrows.top<g.copy.top-3))
      throw Error(width+'px Android guest still overlays text/caption on truck: '+JSON.stringify(g));
    if(!g.background.includes('tracksos-approved-hero-owner-20261119')||
       /tracksos-approved-(?:scenic-hero|scania-r520|truck)\.webp/.test(g.background))
      throw Error(width+'px Android guest uses retired artwork: '+g.background);
    if(errors.length)throw Error(width+'px Android guest JS error: '+errors.join('; '));
    await page.screenshot({path:'e2e/shots/android-guest/native-'+width+'-viewport.png'});
    await page.screenshot({path:'e2e/shots/android-guest/native-'+width+'-full.png',fullPage:true});
    // The two first-screen header controls must open actual authentication
    // forms, not an obsolete second guest homepage or inactive buttons.
    await page.locator('.guest-header-actions a[href="#/login"]').click();
    await page.waitForURL('**/#/login');
    await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    await page.locator('.guest-header-actions a[href="#/register"]').click();
    await page.waitForURL('**/#/register');
    await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    await page.locator('.public-landing').waitFor();
    if(await page.locator('.owner20-home').count())
      throw Error(width+'px guest returned to PC shell after auth navigation');
    await page.getByRole('button',{name:'Хотим работать',exact:true}).click();
    await page.waitForURL('**/#/join');
    await page.getByRole('heading',{name:'Работать с TrakSOS'}).waitFor();
    await ctx.close();
    console.log('PASS Android-bridge guest '+width+'px: approved landing, orange headline, login and registration, no old desktop fallback or overflow');
  }
} finally {await browser.close();}
