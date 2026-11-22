// TrakSOS: smoke-test the public interface in an actual Chromium browser.
// This complements the code/design gate with working clicks and responsive layout.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  for (const width of [360, 390, 768, 1440, 1672]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1672 ? 941 : 844 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    if(width>=900){
      await page.locator('.owner20-home').waitFor({timeout:15000});
      assert(await page.locator('.app > header.top, .desktop-sidebar').count()===0,
        'Final PC must not render legacy guest header/sidebar');
      const footer=page.locator('.guest-home-standalone > .site-footer');
      assert(await footer.count()===1 && await footer.isVisible(),
        'The legal links must appear below approved 617, without a second header');
      const fgeom=await footer.evaluate(el=>({top:el.getBoundingClientRect().top,
        homeBottom:document.querySelector('.owner20-home')?.getBoundingClientRect().bottom??Infinity}));
      assert(fgeom.top>=fgeom.homeBottom-3,
        'The legal footer must not overlap any part of approved 617: '+JSON.stringify(fgeom));
      assert(await page.locator('header.owner20-top').count()===1,
        'Final PC should show exactly one approved header');
      assert(await page.locator('.owner20-quick>a').count()===5,'Owner 22 Nov: balanced five quick services');
      assert(await page.locator('.owner20-quick>a').filter({hasText:'ЭБУ'}).count()===0,
        'ECU must appear only in the illustrated specialist card');
      assert(await page.locator('.owner20-features>a').count()===5,'Final PC features row must have 5 links');
      assert(await page.locator('.owner20-bottom>.owner20-bottom-card').count()===4,'Final PC lower row must have 4 cards');
      // 617 cards: text on the left, source imagery on the right, continuous
      // dimming gradient, not a hard-masked half-image or text baked into CSS.
      const tiles=await page.locator('.owner20-feature').evaluateAll(items=>items.map(card=>{
        const pic=card.querySelector('.owner20-feature-illustration');
        const bounds=card.getBoundingClientRect(),art=pic?.getBoundingClientRect();
        return {title:card.querySelector('b')?.textContent,
          image:getComputedStyle(pic).backgroundImage,
          gradient:getComputedStyle(card,'::before').backgroundImage,
          artRight:art?.right,cardRight:bounds.right,
          mask:getComputedStyle(pic).maskImage,
        };
      }));
      assert(tiles.length===5&&tiles.every(t=>
        t.image?.includes('owner20-artwork-sprite-retouched.webp') &&
        t.gradient?.includes('linear-gradient') &&
        t.artRight <= t.cardRight+3 &&
        t.mask?.includes('linear-gradient')),

        width+'px: approved 617 right-image/left-copy card composition lost '+JSON.stringify(tiles));
      const crop=await page.locator('.owner20-feature-illustration').evaluateAll(items=>items.map(el=>{
        const r=el.getBoundingClientRect(),bg=getComputedStyle(el).backgroundPosition;
        return {w:Math.round(r.width),bg};
      }));
      assert(crop.length===5 && crop.every(x=>x.w<=112),
        width+'px: caption-bearing atlas region returned to feature cards '+JSON.stringify(crop));
      const botShortcut=page.locator('.owner20-quick-trakbot');
      assert(await botShortcut.count()===1,'TrakBot should occupy exactly the fifth quick tile');
      await botShortcut.click();
      await page.getByRole('dialog',{name:'TrakBot — личный помощник'}).waitFor();
      assert(await page.locator('.trakbot-dock-panel').count()===1,
        'Quick TrakBot entry must open one existing assistant');
      assert(page.url().endsWith('/#/'),'Quick TrakBot must preserve approved landing route');
      await page.locator('.trakbot-dock-close').click();
      assert(await page.locator('.trakbot-dock-panel').count()===0,'Quick TrakBot remained open');
      const bot=page.getByRole('button',{name:'Открыть TrakBot'});
      assert(await bot.isVisible(), 'Final PC TrakBot must be user-opened');
      assert(await bot.locator('.trakbot-mascot-original').count()===1,'Owner-approved truck mascot missing');
      const mascot=await bot.locator('.trakbot-mascot-original').evaluate(async el=>{
        const value=getComputedStyle(el).backgroundImage;
        const path='/trakbot-approved-hello.webp';
        if(!value.includes(path))return {ok:false,value};
        const response=await fetch(path);
        if(!response.ok||!response.headers.get('content-type')?.includes('image/'))return {ok:false,status:response.status,value};
        const bmp=await createImageBitmap(await response.blob()).catch(()=>null);
        return {ok:!!bmp&&bmp.width>20&&bmp.height>20,value,width:bmp?.width,height:bmp?.height};
      });
      assert(mascot.ok,'TrakBot must display the exact loaded approved mascot, not a blank tile: '+JSON.stringify(mascot));
      // The owner-approved desktop no longer shrinks the technician to a
      // 40px square with an exposed orange ring. Verify computed CSS, not
      // an obsolete static declaration overridden downstream.
      const botGeometry=await bot.evaluate(el=>{
        const r=el.getBoundingClientRect(), c=getComputedStyle(el);
        const mascot=el.querySelector('.trakbot-mascot-original');
        const frame=mascot?getComputedStyle(mascot):null;
        return {width:r.width,height:r.height,position:getComputedStyle(el.closest('.trakbot-dock')).position,
          border:c.borderTopWidth,background:c.backgroundColor,mask:frame?.maskImage||frame?.webkitMaskImage,
          art:frame?.backgroundImage};
      });
      assert(botGeometry.width >= (width < 1200 ? 75 : 90) &&
        botGeometry.height >= (width < 1200 ? 75 : 90) &&
        botGeometry.position==='fixed' && botGeometry.border==='0px' &&
        botGeometry.mask && botGeometry.mask!=='none',
        width+'px: desktop guest TrakBot reverted to tiny square/ring '+JSON.stringify(botGeometry));
      // The lower-right helper stays in place while the document scrolls.
      // Add test-only height so this assertion still works on tall desktop displays.
      const botBeforeScroll=await bot.boundingBox();
      await page.evaluate(()=>{document.documentElement.style.minHeight='200vh';window.scrollTo(0,300);});
      await page.waitForFunction(()=>window.scrollY>=250);
      const botAfterScroll=await bot.boundingBox();
      assert(botBeforeScroll&&botAfterScroll&&Math.abs(botAfterScroll.y-botBeforeScroll.y)<3,
        width+'px: TrakBot moved with the document instead of staying fixed');
      await page.evaluate(()=>{document.documentElement.style.minHeight='';window.scrollTo(0,0);});
      // Real pixel evidence of the collapsed mascot alongside the complete
      // 617 PC cards. Do not claim the CSS mask creates a new 3D asset.
      mkdirSync('e2e/shots/trakbot-proof',{recursive:true});
      await page.screenshot({path:'e2e/shots/trakbot-proof/guest-launcher-'+width+'.png',animations:'disabled'});
      assert(!await page.locator('.trakbot-dock-panel').count(),'TrakBot opened without a click');
      await bot.click();
      const invite=page.getByRole('dialog',{name:'TrakBot — личный помощник'});
      await invite.waitFor();
      assert(await invite.getByRole('link',{name:'Зарегистрироваться'}).isVisible(),'Guest bot invitation not accessible');
      await page.locator('.trakbot-dock-close').click();
      assert(!await page.locator('.trakbot-dock-panel').count(),'TrakBot remains open');
      const widths=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert(widths.scroll<=widths.client+3,'Final PC overflow '+JSON.stringify(widths));
      assert(!errors.length,'Final PC JS errors '+errors.join('; '));
      console.log('OK: approved Nov20 PC, '+width+'px, TrakBot opt-in, 5+5+4 and zero overflow');
      await context.close();
      continue;
    }
    await page.locator('.public-landing').waitFor({ timeout: 15000 });
    assert(await page.locator('.track-guest-tabbar').count() === 0,
      width + 'px: retired, unstyled guest menu returned below legal footer');
    assert(await page.locator('.guest-header-actions a[href="#/login"]').count() === 1 &&
      await page.locator('.guest-header-actions a[href="#/register"]').count() === 1,
      width + 'px: guest entry actions missing after bottom-nav cleanup');
    // TrakBot is opt-in and does not interrupt the public landing.
    const botLauncher = page.getByRole('button', { name: 'Открыть TrakBot' });
    assert(await botLauncher.isVisible(), width + 'px: TrakBot entry not visible');
    assert(await botLauncher.locator('.trakbot-mascot-truck').count() === 1,
      width + 'px: approved truck technician missing from launcher');
    const mascotMask = await botLauncher.locator('.trakbot-mascot-original')
      .evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
    assert(mascotMask?.includes('radial-gradient'),
      width + 'px: TrakBot still appears as a rectangular raster sticker: ' + mascotMask);
    assert(await page.locator('.trakbot-dock-panel').count() === 0,
      width + 'px: TrakBot opened automatically');
    await botLauncher.click();
    const botDialog = page.getByRole('dialog', { name: 'TrakBot — личный помощник' });
    await botDialog.waitFor();
    assert(await botDialog.locator('.trakbot-dock-guest-mascot .trakbot-mascot-truck').count() === 1,
      width + 'px: guest must see the same technician character');
    assert(await botDialog.getByRole('link', { name: 'Зарегистрироваться', exact: true }).count() === 1,
      width + 'px: mascot registration action is missing');
    assert(await botDialog.getByRole('link', { name: 'Войти', exact: true }).count() === 1,
      width + 'px: mascot login action is missing');
    assert(await botDialog.locator('nav a').count() === 2,
      width + 'px: guest bot must only offer login or registration');
    assert(await botDialog.getByRole('textbox').count() === 0 &&
      await botDialog.locator('.trakbot-dialog, .trakbot-typing, .trakbot-reactions-gallery').count() === 0,
      width + 'px: invitation must never become a private guest chat');
    const invite = await botDialog.boundingBox();
    assert(!!invite && invite.height < 350,
      width + 'px: guest invitation too tall for a small popup');
    // Real Chromium render, not an illustration: archive the exact open guest panel.
    if (width === 390 || width === 1672) {
      mkdirSync('e2e/shots/trakbot-proof', { recursive: true });
      await page.screenshot({
        path: `e2e/shots/trakbot-proof/guest-open-${width}.png`,
        fullPage: false, animations: 'disabled'
      });
    }
    await page.locator('.trakbot-dock-close').click();
    assert(await page.locator('.trakbot-dock-panel').count() === 0,
      width + 'px: TrakBot failed to close');
    assert(await page.locator('.trakbot-dock-panel').count() === 0,
      width + 'px: guest invitation reopened without a user action');


    const data = await page.evaluate(() => {
      const hero = document.querySelector('.public-hero-visual');
      const map = document.querySelector('.public-map-static');
      const header = document.querySelector('.guest-header-actions');
      const heroCss = hero && [getComputedStyle(hero).backgroundImage, getComputedStyle(hero,'::after').backgroundImage].join(' | ');
      const mapCss = map && getComputedStyle(map).backgroundImage;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflowSources: Array.from(document.querySelectorAll('body *')).flatMap((el) => {
          const box = el.getBoundingClientRect();
          const css = getComputedStyle(el);
          if (css.display === 'none' || css.visibility === 'hidden' ||
              box.width === 0 || box.height === 0 ||
              (box.right <= document.documentElement.clientWidth + 2 && box.left >= -2)) return [];
          return [{
            tag: el.tagName.toLowerCase(),
            selector: (el.id ? '#' + el.id : '') +
              (typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
            left: Math.round(box.left), right: Math.round(box.right),
            width: Math.round(box.width), scrollWidth: el.scrollWidth,
            position: css.position, whiteSpace: css.whiteSpace
          }];
        }).sort((a, b) => (b.right - document.documentElement.clientWidth) -
                           (a.right - document.documentElement.clientWidth)).slice(0, 15),
        heroCss, mapCss,
        loginCount: header?.querySelectorAll('a[href="#/login"]').length ?? 0,
        registerCount: header?.querySelectorAll('a[href="#/register"]').length ?? 0,
        serviceTiles: document.querySelectorAll('.public-service-tile').length,
        tileIcons: document.querySelectorAll('.public-service-tile .public-service-icon svg').length,
      };
    });
    if (data.scrollWidth > data.clientWidth + 2) {
      mkdirSync('e2e/shots/overflow-proof', { recursive: true });
      await page.screenshot({
        path: `e2e/shots/overflow-proof/guest-${width}.png`,
        fullPage: true, animations: 'disabled'
      });
      console.error('Layout overflow offenders:', JSON.stringify(data.overflowSources, null, 2));
    }
    assert(data.scrollWidth <= data.clientWidth + 2,
      width + 'px: horizontal overflow ' + data.scrollWidth + '/' + data.clientWidth +
      ' offenders=' + JSON.stringify(data.overflowSources.slice(0, 5)));
    assert(data.loginCount === 1 && data.registerCount === 1,
      width + 'px: duplicated/missing login or registration buttons');
    assert(data.serviceTiles === 6, width + 'px: unexpected public services count');
    if (width >= 1200) {
      const benefits = await page.locator('.public-why-strip .public-benefit').allTextContents();
      assert(benefits.length === 3, 'approved desktop footer requires exactly 3 benefit columns');
      assert(benefits[0].includes('Надёжное сообщество'), 'first approved benefit missing');
      assert(benefits[1].includes('Быстрая помощь'), 'second approved benefit missing');
      assert(benefits[2].includes('Всё в одном месте'), 'third approved benefit missing');
    }
    if (width >= 1440) {
      // Actual owner-approved 19 Nov composition, not a static rendered mock:
      // one header row, compact RuStore promo, three benefits beside the bot.
      const layout = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height} : null;
        };
        return {
          header:box('.guest-app .top'),
          promo:box('.public-app-card'),
          benefits:box('.public-why-strip'),
          bot:box('.trakbot-dock-launcher')
        };
      });
      assert(layout.header && layout.header.height <= 92,
        width + 'px: approved single-row header regressed: ' + JSON.stringify(layout.header));
      assert(layout.promo && layout.promo.right <= width + 2,
        width + 'px: promo card escaped viewport: ' + JSON.stringify(layout.promo));
      assert(layout.bot && layout.bot.width >= 190 && layout.bot.width <= 360,
        width + 'px: approved bot dock must stay compact but readable: ' + JSON.stringify(layout.bot));
      assert(layout.benefits && layout.promo && layout.benefits.top >= layout.promo.bottom - 15,
        width + 'px: benefits must start below elevated RuStore promo: ' + JSON.stringify(layout));
    }
    assert(data.tileIcons === 6, width + 'px: technical icon missing from a public tile');
    // esbuild fingerprints CSS-loaded WebP filenames on production builds. Match
    // the approved basename with or without its generated content hash; the
    // original static path is separately checked below through a real fetch.
    const approvedHeroUrl = /tracksos-approved-hero-owner-20261119(?:-[A-Za-z0-9]+)?\.webp/;
    assert(approvedHeroUrl.test(data.heroCss ?? '') &&
      !/tracksos-approved-(?:scenic-hero|truck|scania-r520)/.test(data.heroCss ?? ''),
      width + 'px: owner-approved 19 Nov hero is not active; computed background=' + data.heroCss);
    assert(!/tracksos-approved-map|tracksos-road-atmosphere/.test(data.mapCss ?? '') &&
      data.mapCss?.includes('gradient'),
      width + 'px: retired pre-17 Nov map/road art returned to active layout');

    // Validate only active owner-approved artwork. The old 19 Nov alternate
    // wordmark was intentionally removed; never request or decode its 404 HTML.
    for (const name of [
      'tracksos-approved-hero-owner-20261119-retouched.webp',
      'traksos-brand-logo-approved-618.png'
    ]) {
      const check = await page.evaluate(async (asset) => {
        const res = await fetch('/' + asset);
        if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return false;
        const blob = await res.blob();
        const logo = asset === 'traksos-brand-logo-approved-618.png';
        if (blob.size < (logo ? 16000 : 50000)) return false;
        const img = await createImageBitmap(blob).catch(() => null);
        return !!img && (logo ? img.width === 274 && img.height === 46 : img.width >= 800);
      }, name);
      assert(check, width + 'px: approved image cannot be loaded: ' + name);
    }

    // The approved live tiles open a contextual password dialog directly
    // above the same public page; no intermediate feature preview is allowed.
    if (width === 390 || width === 1672) {
      for (const id of ['sos', 'air', 'sto', 'ecu', 'parts', 'insurance']) {
        const link = page.locator('.public-service-' + id);
        assert(await link.getAttribute('href') === '#/explore/' + id,
          width + 'px: public tile ' + id + ' changed its approved destination');
        await link.click();
        const modal=page.getByRole('dialog',{name:'Вход по номеру телефона'});
        await modal.waitFor({timeout:10000});
        assert(new URL(page.url()).hash === '#/explore/' + id,
          width + 'px: public ' + id + ' lost its service URL');
        assert(await page.locator('.public-landing').isVisible() &&
          await page.locator('.guest-explore-hero:visible').count()===0,
          width + 'px: service returned old intermediate page '+id);
        assert(await modal.getByText('Вы выбрали:',{exact:false}).isVisible(),
          width + 'px: selected service not shown in auth '+id);
        await modal.getByRole('button',{name:'Закрыть окно'}).click();
        assert(await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'))===null,
          width + 'px: cancelled '+id+' remains selected for unrelated future login');
        await page.locator('.public-service-tiles').waitFor();
        assert(new URL(page.url()).hash === '#/',
          width + 'px: returning from ' + id + ' failed');
      }
    }

    if (width === 390 || width === 1672) {
      const link = page.locator('.public-track-techbase');
      assert(await link.getAttribute('href') === '#/explore/tech',
        width + 'px: TechBase feature must be a working direct link');
      await link.click();
      const modal=page.getByRole('dialog',{name:'Вход по номеру телефона'});
      await modal.waitFor({timeout:10000});
      assert(new URL(page.url()).hash === '#/explore/tech',
        width + 'px: TechBase must open contextual login');
      await modal.getByRole('button',{name:'Закрыть окно'}).click();
      await page.locator('.public-service-tiles').waitFor();
    }

    // Last approved 19 Nov layout has login in the desktop/mobile header;
    // the public hero is intentionally registration-first, without a duplicate login.
    await page.locator('.guest-header-actions').getByRole('link', { name: 'Войти', exact: true }).click();
    await page.getByRole('heading', { name: 'Вход по номеру телефона' }).waitFor();
    assert(await page.getByText('Помогите — нужна помощь').count() === 0,
      width + 'px: legacy help button is still displayed');
    await page.goto(BASE + '/#/');
    await page.locator('.public-actions').getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
    await page.getByRole('heading', { name: 'Регистрация в TrakSOS' }).waitFor();
    for (const name of ['Владелец / автопарк','Водитель автопарка']) {
      assert(await page.getByRole('button', { name }).isVisible(),
        width + 'px: client registration missing '+name);
    }
    assert(await page.getByRole('button', {name:'Мастер',exact:true}).count()===0,
      width+'px: partners must not be presented in client registration');

    await page.goto(BASE + '/#/join');
    await page.getByRole('heading', { name: 'Работать с TrakSOS' }).waitFor();
    const partner = ['Мастер','Эвакуаторщик','СТО','Страховой агент'];
    assert(await page.locator('.auth-desktop-form .opt').count()===4,
      width+'px: partner registration must have exactly 4 categories');
    for (const name of partner) {
      assert(await page.getByRole('button', {name:new RegExp('^'+name)}).isVisible(),
        width+'px: partner category missing '+name);
    }
    assert(await page.locator('.guest-partner-role[aria-pressed="true"]').count()===0,
      width+'px: a new partner must choose a role');
    // Real role-by-role evidence, not a generated mock. Each approved photo
    // panel and selected state is captured on the actual React form.
    if (width===390) {
      mkdirSync('e2e/shots/partners-review',{recursive:true});
      for (const [key,roleLabel] of [
        ['master','Мастер'],['tow','Эвакуаторщик'],['service','СТО'],['insurer','Страховой агент']
      ]) {
        await page.getByRole('button',{name:roleLabel,exact:true}).click();
        const chosen=page.locator('.guest-partner-role-'+key);
        assert(await chosen.getAttribute('aria-pressed')==='true',
          key+': partner tile no longer selects its proper registration role');
        const visual=await chosen.evaluate(el=>{
          const style=getComputedStyle(el,'::before');
          return {image:style.backgroundImage,position:style.backgroundPosition,size:style.backgroundSize};
        });
        assert(visual.image.includes(key==='insurer'?'linear-gradient':'traksos-service-scenes-desktop-hq.webp'),
          key+': partner visual failed to load canonical scene '+JSON.stringify(visual));
        if(key!=='insurer'){
          const expected={master:0,tow:33.3333,service:66.6667}[key];
          assert(Math.abs(parseFloat(visual.position)-expected)<0.5,
            key+': partner selected card shows wrong 25% panorama frame '+JSON.stringify(visual));
        } else {
          const shield=await chosen.evaluate(el=>getComputedStyle(el,'::after').backgroundImage);
          assert(shield.includes('owner20-artwork-sprite-retouched.webp'),
            'insurance partner illustration is not loaded from approved art: '+shield);
        }
        await page.screenshot({path:'e2e/shots/partners-review/partner-'+key+'-390.png',
          fullPage:true,animations:'disabled'});
      }
    }
    await page.getByRole('button',{name:'Мастер',exact:true}).click();
    for (const name of ['Электрик','Автономщик','Гидравлика']) {
      assert(await page.getByRole('button', {name,exact:true}).isVisible(),
        width+'px: master specialization missing '+name);
    }
    const hydraulics = page.getByRole('button', { name: 'Гидравлика', exact: true });
    await hydraulics.click();
    assert(await hydraulics.getAttribute('aria-pressed') === 'true',
      width+'px: hydraulic mobile specialization did not select');
    const hybridRole = page.locator('.guest-partner-hybrid input[type="checkbox"]');
    assert(await hybridRole.isVisible(), width+'px: hybrid mobile master + station toggle missing');
    await hybridRole.check();
    assert(await hybridRole.isChecked(), width+'px: dual master + station toggle failed');
    await page.getByRole('button', { name: 'СТО', exact: true }).click();
    assert(await hybridRole.isChecked() && await hydraulics.isVisible(),
      width+'px: station cannot retain a separate mobile master hydraulic specialty');
    assert(await page.locator('.guest-partner-role').count() === 4,
      width+'px: hybrid partner unexpectedly creates a fifth public role card');
    await page.goto(BASE + '/#/company');
    await page.getByRole('heading', {name:'Компания TrakSOS'}).waitFor();
    if(width===390) {
      mkdirSync('e2e/shots/public-documents',{recursive:true});
      await page.screenshot({path:'e2e/shots/public-documents/company-390.png',
        fullPage:true,animations:'disabled'});
    }
    await page.goto(BASE + '/#/offers');
    await page.getByRole('heading', {name:'Оферты и документы'}).waitFor();
    if(width===390) {
      await page.screenshot({path:'e2e/shots/public-documents/offers-390.png',
        fullPage:true,animations:'disabled'});
      for(const [key,path] of [['rules','rules'],['privacy','offer/privacy']]) {
        await page.goto(BASE+'/#/'+path);
        await page.locator('main').first().waitFor();
        await page.screenshot({path:'e2e/shots/public-documents/'+key+'-390.png',
          fullPage:true,animations:'disabled'});
      }
    }
    assert(errors.length === 0, width + 'px: browser errors: ' + errors.join('; '));
    console.log('OK: viewport ' + width + 'px, 6 cards, Company/Offers, 4 partner roles, no overflow');
    await context.close();
  }
} finally {
  await browser.close();
}
