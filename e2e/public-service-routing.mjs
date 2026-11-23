// Owner-approved 617 PC / 618 mobile browser public entry routing.
// Real Chromium clicks. Do not reintroduce the retired guest bottom tabs,
// duplicate ECU, guest tours, or public access to protected services.
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const browser=await chromium.launch();
const fail=(message)=>{throw new Error(message)};
const check=(condition,message)=>{if(!condition)fail(message)};
const target=(key)=>'#/explore/'+key;

async function guestAuth(page,key,selector,landing) {
  await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
  const link=page.locator(selector).first();
  await link.waitFor({state:'visible'});
  await link.click();
  await page.waitForURL('**/'+target(key));
  const modal=page.getByRole('dialog',{name:'Вход по номеру телефона'});
  await modal.waitFor({state:'visible'});
  check(await page.locator(landing).isVisible(),
    key+': approved landing replaced with old guest page');
  check(await page.locator('.guest-explore-hero:visible').count()===0,
    key+': obsolete guest tour appeared');
  check(await modal.getByText('Вы выбрали:',{exact:false}).isVisible(),
    key+': selected service context not preserved');
}

try {
  for(const [width,height] of [[390,844],[1440,900]]) {
    const ctx=await browser.newContext({viewport:{width,height},locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    const desktop=width>=900;
    const landing=desktop?'.owner20-home':'.public-landing';
    await page.locator(landing).waitFor({state:'visible'});
    const publicGlyphs={};
    const glyphSelectors=desktop?[
      ['master','.owner20-quick a[href="#/explore/van"] svg'],
      ['tow','.owner20-quick a[href="#/explore/tow"] svg'],
      ['service','.owner20-quick a[href="#/explore/sto"] svg'],
      ['insurer','.owner20-feature-insurance svg'],
    ]:[
      ['service','.public-service-sto .public-service-icon svg'],
      ['insurer','.public-service-insurance .public-service-icon svg'],
    ];
    for(const [key,selector] of glyphSelectors){
      publicGlyphs[key]=await page.locator(selector).first().evaluate(el=>el.innerHTML);
    }

    if(desktop){
      check(await page.locator('.owner20-quick>a').count()===5,
        'PC must retain five quick service tiles');
      check(await page.locator('.owner20-features>a').count()===5,
        'PC must retain five illustrated feature tiles');
      check(await page.locator('.owner20-quick>a').filter({hasText:'ЭБУ'}).count()===0,
        'ECU is duplicated in quick service tiles');
      check(await page.locator('.owner20-feature-ecu').count()===1,
        'Single illustrated specialists ECU card missing');
      check(await page.locator('.owner20-quick-trakbot').count()===1,
        'Fifth TrakBot tile missing');
      // The new fifth tile opens the ONE existing assistant without navigating.
      await page.locator('.owner20-quick-trakbot').click();
      await page.getByRole('dialog',{name:'TrakBot — личный помощник'}).waitFor();
      check(await page.locator('.trakbot-dock-panel').count()===1,
        'Fifth quick tile spawned more than one TrakBot');
      check(page.url().endsWith('/#/'),'TrakBot navigated away from main page');
      await page.locator('.trakbot-dock-close').click();
      check(await page.locator('.trakbot-dock-panel').count()===0,
        'TrakBot did not close');

      for(const key of ['van','tow','sto','consult']){
        await guestAuth(page,key,'.owner20-quick>a[href="'+target(key)+'"]',landing);
      }
      for(const key of ['tech','ecu','parts','insurance','inspection']){
        await guestAuth(page,key,'.owner20-feature-'+key,landing);
      }
      for(const key of ['air','club']){
        await guestAuth(page,key,'.owner20-bottom-'+key,landing);
      }

      await page.goto(BASE+'/#/');
      const top=page.locator('.owner20-topnav');
      const menus=top.locator('details');
      const summary=menus.nth(0).locator('summary');
      await summary.click();
      check(await menus.nth(0).evaluate(el=>el.open),'Platform dropdown failed');
      await page.mouse.move(0,0);
      check(!await menus.nth(0).evaluate(el=>el.open),'Platform dropdown did not close on mouse leave');
      await summary.click();
      const platformLinks=await menus.nth(0).locator('a').allTextContents();
      check(platformLinks.length===1&&platformLinks[0].trim()==='О нас',
        'Platform menu still exposes fees/tours/terms as public actions');
      await menus.nth(1).locator('summary').click();
      check(!await menus.nth(0).evaluate(el=>el.open),
        'Two desktop menus overlap');
      // Physically move the mouse through the disclosure-to-popup gap.
      // A premature mouseleave must not make its own links unreachable.
      const serviceHeader=await menus.nth(1).locator('summary').boundingBox();
      const serviceLink=menus.nth(1).locator('a[href="#/explore/van"]');
      const serviceBox=await serviceLink.boundingBox();
      check(!!serviceHeader&&!!serviceBox,'Services popup has no geometry');
      await page.mouse.move(serviceHeader.x+serviceHeader.width/2,serviceHeader.y+serviceHeader.height/2);
      await page.mouse.move(serviceBox.x+serviceBox.width/2,serviceBox.y+serviceBox.height/2,{steps:20});
      check(await menus.nth(1).evaluate(el=>el.open),'Services dropdown closed while moving to its own link');
      check(await serviceLink.isVisible(),'Services link vanished before mouse could reach it');
      await menus.nth(1).locator('summary').press('Escape');
      check(!await menus.nth(1).evaluate(el=>el.open),
        'Escape did not close the dropdown');
      await page.locator('.owner20-region>summary').click();
      check(await page.locator('.owner20-region-menu').isVisible(),
        'Region disclosure does not open');
      check(await page.locator('.owner20-region-menu').getByText('TrakSOS — вся Россия').count()===1,
        'Region panel wrongly limits TrakSOS to SPb');
      await page.mouse.move(0,0);
      check(!await page.locator('.owner20-region').evaluate(el=>el.open),
        'Region menu did not close on mouse leave');
      check(await page.locator('.owner20-region-menu a[href="#/login"]').count()===1,
        'Region availability should open sign-in');
      check(await page.locator('.owner20-map a[href="#/login"]').count()===1,
        'Coverage details should open sign-in');
      check(await top.locator(':scope > a[href="#/join"]').count()===0,
        'Partner action must be inside submenu, not a second top-level link');
      await page.locator('.owner20-topnav details').nth(3).locator('summary').click();
      check(await page.locator('.owner20-topnav details').nth(3).locator('a[href="#/join"]').count()===1,
        'Partner CTA does not lead to partner signup');
      await page.locator('.owner20-topnav details').nth(3).locator('a[href="#/join"]').click();
    } else {
      // Approved mobile 618 already has first-screen auth and a real
      // "Возможности" menu: the old 4-link bottom tabbar is NOT allowed.
      check(await page.locator('.track-guest-tabbar').count()===0,
        'Retired unstyled guest tabbar returned below the legal footer');
      check(await page.locator('.public-landing-region').getByText('TrakSOS — вся Россия').count()===1,
        'Mobile landing incorrectly claims SPb-only platform');
      check(await page.locator('.guest-header-actions a[href="#/login"]').count()===1,
        'Mobile first-screen sign-in is missing');
      check(await page.locator('.guest-header-actions a[href="#/register"]').count()===1,
        'Mobile first-screen registration is missing');
      for(const key of ['sos','air','sto','ecu','parts','insurance']){
        await guestAuth(page,key,'.public-service-tile.public-service-'+key,landing);
      }
      for(const [key,selector] of [
        ['parts','.public-track-parts'],['inspection','.public-track-inspection'],
        ['tech','.public-track-techbase']
      ]) {
        await guestAuth(page,key,selector,landing);
      }

      // The second hero action now opens login rather than an old public guide.
      await page.goto(BASE+'/#/');
      const signin=page.locator('.public-actions a.public-button-outline');
      check(await signin.count()===1 &&
        await signin.getAttribute('href')==='#/login',
        'Second hero CTA must lead to sign-in, not a guide');
      await signin.click();
      await page.waitForURL('**/#/login');
      await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();

      await page.goto(BASE+'/#/');
      const menu=page.locator('.guest-mobile-catalog');
      await menu.locator('summary').click();
      const links=menu.getByRole('navigation',{name:'Возможности TrakSOS'});
      for(const key of ['van','tow','sto','ecu','consult','parts','insurance'])
        check(await links.locator('a[href="'+target(key)+'"]').count()===1,
          'Mobile catalogue missing '+key);
      check(await links.locator('a[href="#/company"]').count()===1,
        'Mobile About link missing');
      check(await links.locator('a[href="#/join"]').count()===1,
        'Mobile partner registration missing');
      check(await links.locator('a[href="#/login"]').count()===1,
        'Mobile support must lead to login');
      await links.locator('a[href="#/join"]').click();
    }

    await page.waitForURL('**/#/join');
    await page.getByRole('heading',{name:'Работать с TrakSOS'}).waitFor();
    const roles=page.locator('.guest-partner-role');
    check(await roles.count()===4,'Public signup must show 4 approved partner choices');
    for(const [key,title] of [
      ['master','Мастер'],['tow','Эвакуаторщик'],
      ['service','СТО'],['insurer','Страховой агент']
    ]){
      const role=page.getByRole('button',{name:title,exact:true});
      await role.click();
      check(await role.getAttribute('aria-pressed')==='true',
        'Partner signup role not selectable: '+key);
      const btn=page.locator('.guest-partner-role-'+key);
      const symbol=btn.locator('.guest-partner-role-label svg');
      check(await symbol.count()===1,
        key+': partner choice lacks canonical vector service symbol');
      if(publicGlyphs[key]) {
        const glyph=await symbol.evaluate(el=>el.innerHTML);
        check(glyph===publicGlyphs[key],
          key+': partner icon no longer matches exact '+(desktop?'PC':'mobile/Android')+' public service pictogram');
      }
      if(width===390) {
        if(key==='tow'){
          const label=await btn.locator('.guest-partner-role-label b').evaluate(el=>({
            text:el.textContent.trim(),whiteSpace:getComputedStyle(el).whiteSpace,
            width:el.clientWidth,scrollWidth:el.scrollWidth,
          }));
          check(label.text==='Эвакуаторщик'&&label.whiteSpace==='nowrap'&&
            label.scrollWidth<=label.width+2,
            'Mobile tow partner label wrapped or clipped: '+JSON.stringify(label));
        }
        const image=await btn.evaluate(el=>({
          before:getComputedStyle(el,'::before').backgroundImage,
          position:getComputedStyle(el,'::before').backgroundPosition,
          after:getComputedStyle(el,'::after').backgroundImage,
        }));
        if(key!=='insurer'){
          check(image.before.includes('traksos-service-scenes-desktop-hq.webp'),
            key+': photography hidden behind obsolete gradient: '+JSON.stringify(image));
          const expected={master:0,tow:33.3333,service:66.6667}[key];
          check(Math.abs(parseFloat(image.position)-expected)<0.5,
            key+': wrong approved photo crop '+image.position);
        }else check(image.after.includes('owner20-artwork-sprite-retouched.webp'),
          'Insurer illustration missing');
      }
    }
    await page.getByRole('button',{name:'Мастер',exact:true}).click();
    for(const name of ['Электрик','Автономщик']){
      const specialty=page.getByRole('button',{name,exact:true});
      await specialty.waitFor();
      await specialty.click();
      check(await specialty.getAttribute('aria-pressed')==='true',
        'Multi-specialty option not retained: '+name);
    }

    // Published legal documents and About remain public. The old guide/help
    // routes must never return old pink/white pages for anonymous visitors.
    const legalShots='e2e/shots/public-documents';
    await mkdir(legalShots,{recursive:true});
    for(const [route,heading] of [
      ['company','Компания TrakSOS'],['offers','Оферты и документы'],
      ['rules','Правила площадки'],['offer/privacy',null],
      ['offer/client',null],['offer/performer',null]
    ]){
      await page.goto(BASE+'/#/'+(route.startsWith('offer/')?'offers':''));
      const links=route.startsWith('offer/')?page.locator('.guest-info-grid'):page.locator('.site-footer');
      const link=links.locator('a[href="#/'+route+'"]');
      const selectedTitle=route.startsWith('offer/')?await link.locator('b').innerText():null;
      await link.click();
      await page.waitForURL('**/#/'+route);
      if(heading) await page.getByRole('heading',{name:heading,exact:true}).waitFor();
      else {
        const document=page.locator('main.public-offer-page');
        await document.locator('.offer-text, .offer-unpublished').waitFor();
        check(!await document.getByRole('alert').count(),route+': legal document request failed');
        if(await document.locator('.offer-unpublished').count())
          await document.getByRole('heading',{name:selectedTitle,exact:true}).waitFor();
      }
      if(route==='offers' && width<900){
        // Captured 390px legal page previously had TrakBot covering the note.
        // Use actual glyph-line rectangles, not the note element's entire box.
        const footnote=await page.evaluate(()=>{
          const note=document.querySelector('.guest-info-offers > .guest-info-note');
          const bot=document.querySelector('.trakbot-dock-launcher');
          if(!note||!bot)return {missing:true};
          const range=document.createRange();range.selectNodeContents(note);
          const b=bot.getBoundingClientRect();
          const textRects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
          return {missing:false,lines:textRects.length,
            overlap:textRects.some(r=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top),
            noteWidth:note.getBoundingClientRect().width,
            bot:[b.left,b.top,b.right,b.bottom]};
        });
        check(!footnote.missing&&footnote.lines>0&&footnote.noteWidth>170&&!footnote.overlap,
          'Mobile legal footnote hidden under floating TrakBot: '+JSON.stringify(footnote));
      }
      if(width<900){
        // Secondary legal/info pages must use the approved 618 non-floating dock:
        // a fixed mascot covered a Rules accordion, the cookie notice and
        // the Offers footnote despite the old screenshot-only gate passing.
        const legalBot=await page.evaluate(()=>{
          const dock=document.querySelector('.guest-app:not(.guest-home) > .trakbot-dock');
          const launcher=dock?.querySelector('.trakbot-dock-launcher');
          if(!dock||!launcher)return {missing:true};
          const b=launcher.getBoundingClientRect();
          const targets=['.guest-info-note','.site-footer .banner[role="note"] > .note',
            '.tr-rules-public button[aria-expanded]'];
          const overlaps=[];
          for(const selector of targets){
            for(const el of document.querySelectorAll(selector)){
              const range=document.createRange();range.selectNodeContents(el);
              if([...range.getClientRects()].some(r=>r.width>0&&r.height>0&&
                r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top))
                overlaps.push(selector);
            }
          }
          return {position:getComputedStyle(dock).position,overlaps,
            hasLauncher:launcher.getBoundingClientRect().width>=44};
        });
        check(!legalBot.missing&&legalBot.position==='relative'&&legalBot.hasLauncher&&
          legalBot.overlaps.length===0,
          route+': TrakBot must follow mobile legal content instead of covering it: '+JSON.stringify(legalBot));
      }
      await page.screenshot({path:legalShots+'/'+route.replace('/','-')+'-'+width+'.png',animations:'disabled'});
    }
    for(const route of ['help','explore/guide','explore/pricing']){
      await page.goto(BASE+'/#/'+route);
      check(await page.locator('.guest-explore-hero:visible').count()===0,
        route+': old public tour leaked');
      check(await page.getByRole('dialog',{name:'Вход по номеру телефона'}).count()===1 ||
        await page.getByRole('heading',{name:'Вход по номеру телефона'}).count()===1,
        route+': protected route did not lead to sign-in');
    }
    check(errors.length===0,
      width+'px: JS errors '+errors.join('; '));
    const widths=await page.evaluate(()=>({
      viewport:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth
    }));
    check(widths.scroll<=widths.viewport+3,
      width+'px: horizontal overflow '+JSON.stringify(widths));
    await ctx.close();
  }
}finally{await browser.close();}
console.log('PASS: owner-approved 617/618 routes, five quick services, unified TrakBot, guest gates, four partner roles and public docs');
