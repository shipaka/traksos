// Real authenticated Android layout evidence from synthetic local CI accounts only.
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const output='e2e/shots/android-approved-real';
await mkdir(output,{recursive:true});
async function post(path,body,token){
  const r=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
  return data;
}
async function get(path,token){
  const r=await fetch(BASE+path,{headers:{authorization:'Bearer '+token}});
  if(!r.ok)throw Error(path+' HTTP '+r.status);
  return await r.json();
}
const browser=await chromium.launch();
try{
  for(const [role,phone,mode,route,selector] of [
    ['owner','+79990000981','client','#/','.and19-client'],
    ['master','+79990000982','performer','#/work','.and19-performer']
  ]){
    const code=await post('/api/auth/code',{phone});
    if(!/^\d{4,6}$/.test(code?.devCode??''))throw Error('Synthetic local SMS only');
    const v=await post('/api/auth/verify',{phone,code:code.devCode,accountType:role,password:'Test-Only-Visual-2026!'});
    if(!v?.token)throw Error(role+': no token');
    if(role==='master'&&!await get('/api/performer/profile',v.token)){
      const p=await fetch(BASE+'/api/performer/profile',{method:'PUT',headers:{authorization:'Bearer '+v.token,'content-type':'application/json'},body:JSON.stringify({kind:'master',specialties:[],brands:{},tier:'eco'})});
      if(!p.ok)throw Error('Synthetic master profile HTTP '+p.status);
    }
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',deviceScaleFactor:2});
    const page=await ctx.newPage();
    const errors=[];page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(({token,mode})=>{
      Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
        isApp:()=>true,setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
        appLockEnabled:()=>false,setAppLockEnabled:()=>false
      }});
      localStorage.setItem('traksos.token',token);
      localStorage.setItem('traksos.mode',mode);
    },{token:v.token,mode});
    try{
      await page.goto(BASE+'/'+route,{waitUntil:'domcontentloaded'});
      await page.locator('.app').waitFor({timeout:20000});
      const offers=await get('/api/me/offers',v.token);
      for(const offer of offers.filter(o=>o.current&&!o.accepted)){
        const modal=page.getByRole('dialog',{name:offer.name});
        await modal.waitFor({state:'visible',timeout:15000});
        await modal.locator('input[type=checkbox]').check();
        await modal.getByRole('button',{name:'Принимаю'}).click();
        await modal.waitFor({state:'detached',timeout:15000});
      }
      await page.locator(selector).waitFor({state:'visible',timeout:20000});
      if(role==='master')await page.locator('.and19-line button').waitFor();
      else await page.locator('.and19-services').waitFor();
      await page.waitForTimeout(650);
      const brand=await page.locator('.top .tr-approved-brand-logo img').evaluate(img=>{
        const rect=img.getBoundingClientRect();
        return {src:img.getAttribute('src'),
          loaded:img.complete&&img.naturalWidth===274&&img.naturalHeight===46,
          naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
          renderedWidth:rect.width,renderedHeight:rect.height};
      });
      if(brand.src!=='/traksos-brand-logo-approved-618.png'||!brand.loaded||
         brand.renderedWidth>brand.naturalWidth+1||brand.renderedHeight>brand.naturalHeight+1)
        throw Error(role+': approved logo missing, distorted, or upscaled beyond original pixels: '+JSON.stringify(brand));
      if(Math.abs(brand.renderedWidth/brand.renderedHeight-brand.naturalWidth/brand.naturalHeight)>.08)
        throw Error(role+': approved logo aspect ratio distorted: '+JSON.stringify(brand));
      // Source is a literal crop from approved 618.png. On 2x displays it
      // may be pixel-density limited; report truthfully rather than upscale
      // or create an unauthorized replacement image.
      console.log(role+' original approved logo nominal retina pixel coverage: '+(brand.naturalWidth/(brand.renderedWidth*2)).toFixed(2)+'x');
      if(role==='owner'){
        const art=await page.locator('.and19-services > a').evaluateAll(cards=>cards.map(card=>{
          const illustration=card.querySelector('.tr-service-illustration');
          const label=card.querySelector('.and19-service-label');
          if(!illustration||!label)return {missing:true};
          const visual=getComputedStyle(illustration);
          const textStyle=getComputedStyle(label);
          return {
            image:visual.backgroundImage,
            position:visual.backgroundPosition,
            size:visual.backgroundSize,
            opacity:Number(visual.opacity),
            label:label.textContent,
            labelFont:textStyle.fontSize,
            labelVisible:textStyle.visibility!=='hidden'&&textStyle.display!=='none',
            width:illustration.getBoundingClientRect().width,
            height:illustration.getBoundingClientRect().height,
            transform:visual.transform
          };
        }));
        const expected=[
          ['Выездной мастер','0px 0px'],
          ['Эвакуатор','-88px 0px'],
          ['СТО','-176px 0px'],
          ['Консультация','-264px 0px'],
        ];
        if(art.length!==4 || art.some((a,i)=>
          a.missing||a.label!==expected[i][0]||a.position!==expected[i][1]||
          a.size!=='352px 52.5px'||!a.image.includes('traksos-service-scenes-shared.webp')||
          a.opacity<.45||!a.labelVisible||a.labelFont!=='10px'||
          a.transform!=='none'||Math.abs(a.width-88)>.5||Math.abs(a.height-52.5)>.5))
          throw Error('Android four tiles must share desktop atlas and use direct-size raster painting: '+JSON.stringify(art));
      }
      const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      if(size.scroll>size.client+3)throw Error(role+' horizontal overflow '+JSON.stringify(size));
      if(errors.length)throw Error(role+' JS errors: '+errors.join('; '));
      await page.screenshot({path:output+'/'+role+'-android-390.png',fullPage:true,scale:'css'});
      await page.screenshot({path:output+'/'+role+'-android-390-retina2x.png',fullPage:true,scale:'device'});
      console.log('Captured real Android native-bridge browser workspace at CSS 390px + physical 2x: '+role);
      // After accepting the role's desktop, verify the WHOLE native app:
      // bottom Menu opens role-specific sections, not only the Profile screen.
      const menuTab=page.locator('.tabbar a[href="#/menu"]');
      if(await menuTab.count()!==1)throw Error(role+': Android bottom Menu is missing');
      await menuTab.click();
      const menu=page.locator('main.tr-mobile-menu-page');
      await menu.waitFor({state:'visible',timeout:15000});
      const info=await menu.evaluate(el=>({
        title:el.querySelector('h1')?.textContent,
        groups:el.querySelectorAll('.tr-mobile-menu-section').length,
        realLinks:Array.from(el.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')),
        visual:getComputedStyle(el.querySelector('.tr-mobile-menu-section')).backgroundImage,
        animation:getComputedStyle(el).animationName,
        scrollWidth:document.documentElement.scrollWidth,
        clientWidth:document.documentElement.clientWidth
      }));
      if(info.title!=='Меню и разделы'||info.groups<3||info.realLinks.length<9||
         info.realLinks.some(h=>!h?.startsWith('#/'))||
         !info.visual.includes('gradient')||!info.animation.includes('trAndroidInnerEnter')||
         info.scrollWidth>info.clientWidth+3)
        throw Error(role+': menu visuals or role routes broken '+JSON.stringify(info));
      if(role==='owner' && !info.realLinks.includes('#/air'))
        throw Error('Owner lost approved driver Ether');
      if(role==='master' && (!info.realLinks.includes('#/work/filter')||info.realLinks.includes('#/admin')))
        throw Error('Master lost job filters or sees admin-only links');
      if(await page.locator('.tabbar a[href="#/menu"].on').count()!==1)
        throw Error(role+': selected Menu tab does not reflect its route');
      await page.screenshot({path:output+'/'+role+'-menu-android-390.png',fullPage:true,scale:'css'});
      const helpDetails=page.locator('details.tr-mobile-menu-section').last();
      if(await helpDetails.getAttribute('open')!==null)
        throw Error(role+': help and documents must be collapsed until explicitly requested');
      await helpDetails.locator('summary').click();
      if(!await helpDetails.locator('a[href="#/help"]').isVisible())
        throw Error(role+': help menu failed to expand to the real section');
      await page.screenshot({path:output+'/'+role+'-menu-help-android-390.png',fullPage:true,scale:'css'});
      await page.locator('.tr-mobile-menu-account a[href="#/profile"]').click();
      await page.waitForURL(url => url.hash === '#/profile', {timeout:10000});
      await page.locator('main.account-profile-page').waitFor({state:'visible',timeout:15000});
      if(await page.locator('main.tr-mobile-menu-page').count())
        throw Error(role+': Profile shortcut did not navigate to real settings');
      if(await page.locator('.tabbar a[href="#/menu"]').count()!==1)
        throw Error(role+': bottom Menu vanished inside profile/settings');
      if(role==='master') {
        await page.goto(BASE+'/#/work/docs',{waitUntil:'domcontentloaded'});
        await page.locator('.tabbar a[href="#/menu"]').waitFor({state:'visible'});
      }
      // Test an accessible small Android phone, without changing baseline 390px screenshots.
      await page.goto(BASE+'/#/menu',{waitUntil:'domcontentloaded'});
      await menu.waitFor({state:'visible'});
      await page.setViewportSize({width:320,height:740});
      await page.waitForTimeout(120);
      const narrow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      if(narrow>3)throw Error(role+': menu horizontal overflow on 320px: '+narrow);
      await page.screenshot({path:output+'/'+role+'-menu-android-320.png',fullPage:true,scale:'css'});
      if(errors.length)throw Error(role+': menu JavaScript error(s) '+errors.join('; '));
      // Important user-facing sections must be visually checked too; a
      // polished desktop must not hide unfinished empty Android subpages.
      const destinations = role==='owner'
        ? [['orders','#/orders'],['vehicles','#/garage'],['parts','#/shop'],['account','#/profile']]
        : [['orders','#/work/jobs'],['chats','#/work/chats'],
           ['schedule','#/work/me/schedule'],['finance','#/work/me/money'],
           ['account','#/profile']];
      await page.setViewportSize({width:390,height:844});
      for(const [section,target] of destinations){
        await page.goto(BASE+'/'+target,{waitUntil:'domcontentloaded'});
        await page.locator('.desktop-content > main').first().waitFor({state:'visible',timeout:15000});
        await page.waitForTimeout(450);
        const view=await page.evaluate(()=>({
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          hasMenu:!!document.querySelector('.tabbar a[href="#/menu"]'),
          chrome:(()=>{
            const el=document.querySelector('.desktop-content>.tr-native-section-path');
            return el ? {
              title:el.querySelector('.tr-native-section-current strong')?.textContent?.trim(),
              home:el.querySelector('.tr-native-section-home')?.getAttribute('href'),
              menu:el.querySelector('.tr-native-section-menu')?.getAttribute('href'),
              visible:el.getBoundingClientRect().height>=40
            } : null;
          })(),
          invalid:document.body.textContent?.includes('Такой страницы нет')
        }));
        const expectedHome = role==='owner' ? '#/' : '#/work';
        if(view.overflow>3||!view.hasMenu||view.invalid ||
           view.chrome?.home!==expectedHome ||
           view.chrome?.menu!=='#/menu' || !view.chrome?.visible ||
           !view.chrome?.title)
          throw Error(role+': section '+section+' is not a reachable styled Android page: '+JSON.stringify(view));
        await page.screenshot({path:output+'/'+role+'-'+section+'-android-390.png',fullPage:true,scale:'css'});
      }
    }finally{await ctx.close()}
  }
}finally{await browser.close()}
