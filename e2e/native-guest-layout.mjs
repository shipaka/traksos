// Native TrakSOS welcome. A PHONE is not a scaled-down PC page.
// Browser tests use an Android-like bridge, touch, and real local routes only.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Android guest proof may only target an isolated local CI server');
await mkdir('e2e/shots/android-guest',{recursive:true});
const browser=await chromium.launch();
try {
  for(const width of [320,360,390,900,960,1200]){
    const height=width===320?640:width===360?800:844;
    const ctx=await browser.newContext({viewport:{width,height},isMobile:true,
      hasTouch:true,deviceScaleFactor:1,locale:'ru-RU'});
    try {
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
      const welcome=page.locator('main.tr-native-welcome.public-landing');
      await welcome.waitFor({state:'visible',timeout:15000});
      const hero=await page.evaluate(async()=>{
        const img=document.querySelector('.tr-native-welcome-photo img');
        if(img&&!img.complete)await img.decode().catch(()=>{});
        const photo=img?.getBoundingClientRect();
        const title=document.querySelector('.tr-native-welcome-stage h1')?.getBoundingClientRect();
        return {
          native:document.documentElement.classList.contains('traksos-native'),
          viewport:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
          natural:img?.naturalWidth,source:img?.getAttribute('src'),
          fit:img?getComputedStyle(img).objectFit:null,
          centered:img?getComputedStyle(img).objectPosition:null,
          photo:photo&&{x:photo.x,y:photo.y,w:photo.width,h:photo.height},
          title: title&&{y:title.y,w:title.width}
        };
      });
      if(!hero.native||hero.scroll>hero.viewport+3||!hero.natural||
        !hero.source?.includes('tracksos-approved-hero-owner-20261119-retouched')||
        hero.fit!=='contain'||hero.centered!=='50% 50%'||
        !hero.photo||!hero.title||hero.photo.w<140||hero.photo.h<110||
        hero.photo.y+hero.photo.h>hero.title.y+2)
        throw Error(width+'px native truck clipped or overlaps title: '+JSON.stringify(hero));
      if(await page.locator('.owner20-home, .public-hero-carousel, .public-demo-map').count())
        throw Error(width+'px Android guest leaks a PC or old marketing page');
      const login=welcome.getByRole('link',{name:'Войти',exact:true});
      const register=welcome.getByRole('link',{name:'Зарегистрироваться',exact:true});
      if(!await login.isVisible()||!await register.isVisible())
        throw Error(width+'px Android has no first-screen authentication actions');
      const controls=await Promise.all([login,register].map(x=>x.evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {w:rect.width,h:rect.height};
      })));
      if(controls.some(x=>x.w<90||x.h<48))
        throw Error(width+'px login/register are not finger-friendly: '+JSON.stringify(controls));
      const services=welcome.locator('details.tr-native-welcome-services');
      if(await services.evaluate(e=>e.open))
        throw Error(width+'px native services must be collapsed by default');
      if(await services.locator('a.public-service-tile').count()!==6)
        throw Error(width+'px lost six existing server-backed guest actions');
      await page.screenshot({path:'e2e/shots/android-guest/native-'+width+'-viewport.png'});
      await services.locator('summary').click();
      if(!await services.evaluate(e=>e.open) ||
        !await services.getByRole('navigation',{name:'Услуги TrakSOS'}).isVisible())
        throw Error(width+'px native service drawer did not open');
      const touch=await services.locator('a.public-service-tile').first().evaluate(el=>{
        const r=el.getBoundingClientRect();
        return {w:r.width,h:r.height};
      });
      if(touch.h<48||touch.w<100)
        throw Error(width+'px services not touchable '+JSON.stringify(touch));
      await page.screenshot({path:'e2e/shots/android-guest/native-'+width+'-full.png',fullPage:true});
      if(errors.length)throw Error(width+'px Android guest JS errors '+errors.join('; '));
      await login.click();
      await page.waitForURL('**/#/login');
      await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();
      await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
      await page.locator('.tr-native-welcome-register').click();
      await page.waitForURL('**/#/register');
      await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
      await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
      await page.locator('.tr-native-welcome-partner').click();
      await page.waitForURL('**/#/join');
      await page.getByRole('heading',{name:'Работать с TrakSOS'}).waitFor();
      console.log('PASS Android welcome '+width+'px: entire approved truck, touch targets, real auth, no fake desktop');
    } finally {await ctx.close();}
  }
} finally {await browser.close();}
