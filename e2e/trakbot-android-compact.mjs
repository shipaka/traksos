// Compact TrakBot / TrackSalesBot in a real Chromium Android-sized viewport.
// All authentication and chat data in this test are intercepted locally; no real
// user account, message, payment, or external AI service is involved.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const sizes = [
  { width: 320, height: 640 }, { width: 360, height: 720 },
  { width: 390, height: 844 }, { width: 412, height: 915 },
  { width: 640, height: 360 }, { width: 768, height: 850 },
];
const sample = [
  { id:'b-1', role:'bot', body:'Привет! Помогу разобраться с неисправностью грузовика.', created_at:'2026-11-19T10:00:00Z' },
  { id:'u-1', role:'user', body:'Подскажи, пожалуйста, что означает P0420?', created_at:'2026-11-19T10:01:00Z' },
  { id:'b-2', role:'bot', body:'Это общий код OBD-II. Для грузовика важны модель, год и блок управления. Не путайте универсальный код с заводской диагностикой. '.repeat(4), created_at:'2026-11-19T10:02:00Z' },
];

try {
  for (const { width, height } of sizes) {
    const context = await browser.newContext({
      viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      locale: 'ru-RU',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      // Test-only mocked account; server never receives it as a valid token.
      localStorage.setItem('traksos.token','playwright-mock-trakbot');
      localStorage.setItem('traksos.cookie','1');
    });
    await page.route('**/api/me', route => route.fulfill({
      status:200, contentType:'application/json',
      body:JSON.stringify({
        id:'mock-layout-user',phone:'+70000000000',name:'Тестовый клиент',
        roles:['client'], owner_id:null,company_name:null,company_inn:null,
        rating:null,rating_count:0,performer:null,
      }),
    }));
    await page.route('**/api/trakbot/messages', route => route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({ messages:sample,freePilot:true,aiAvailable:false }),
    }));
    await page.route('**/api/trakbot/answer', async route => {
      await new Promise(resolve => setTimeout(resolve, 650));
      await route.fulfill({
        status:200,contentType:'application/json',
        body:JSON.stringify({
          userMessage:{id:'u-2',role:'user',body:'Есть проблема с тормозами',created_at:'2026-11-19T10:03:00Z'},
          message:{id:'b-3',role:'bot',body:'Не продолжай движение при неисправности тормозов. Обратись к специалисту.',created_at:'2026-11-19T10:03:01Z'},
          freePilot:true,
        }),
      });
    });
    await page.goto(BASE+'/#/help',{waitUntil:'domcontentloaded'});
    const launch = page.getByRole('button',{name:'Открыть TrakBot'});
    await launch.waitFor({timeout:15000});
    await launch.click();
    const dialog=page.getByRole('dialog',{name:'TrakBot — личный помощник'});
    await dialog.waitFor();
    await page.locator('.trakbot-message--bot').last().waitFor({timeout:15000});

    const geometry=await page.evaluate(() => {
      const rect = (s) => { const el=document.querySelector(s);return el?el.getBoundingClientRect():null; };
      return {
        vw:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
        panel:rect('.trakbot-dock-panel'),avatar:rect('.trakbot-dialog .trakbot-message--bot .trakbot-mascot'),
        input:rect('.trakbot-dialog .compose input'),send:rect('.trakbot-dialog .compose button[type=submit]'),
        messages:rect('.trakbot-dialog .msgs'),galleryCount:document.querySelectorAll('.trakbot-reactions-gallery').length,
        scrollableMessages:document.querySelector('.trakbot-dialog .msgs')?.scrollHeight > document.querySelector('.trakbot-dialog .msgs')?.clientHeight,
      };
    });
    const wiggle = 3;
    assert(geometry.panel && geometry.avatar && geometry.input && geometry.send,
      width+'×'+height+': missing mini-chat parts');
    assert(geometry.avatar.width<=37, width+'×'+height+': mascot too large: '+geometry.avatar.width);
    assert(geometry.panel.width<=width+wiggle && geometry.panel.left>=-wiggle && geometry.panel.right<=width+wiggle,
      width+'×'+height+': mini-chat overflows horizontal viewport');
    assert(geometry.panel.height<height*.87, width+'×'+height+': mini-chat monopolizes the screen');
    assert(geometry.input.bottom<=geometry.panel.bottom+wiggle && geometry.input.top>=geometry.panel.top-wiggle,
      width+'×'+height+': message input outside mini-chat');
    assert(geometry.send.bottom<=geometry.panel.bottom+wiggle && geometry.send.top>=geometry.panel.top-wiggle,
      width+'×'+height+': send button outside mini-chat');
    assert(geometry.galleryCount===0, width+'×'+height+': large 30-sticker gallery visible in mini-chat');
    assert(geometry.scrollWidth<=geometry.vw+wiggle,
      width+'×'+height+': page horizontal overflow '+geometry.scrollWidth+'/'+geometry.vw);
    assert(geometry.scrollableMessages,
      width+'×'+height+': long messages should scroll inside chat, not enlarge panel');

    const input=page.getByRole('textbox',{name:'Сообщение TrakBot'});
    await input.fill('Есть проблема с тормозами');
    await page.locator('.trakbot-dialog .compose button[type=submit]').click();
    await page.getByRole('status',{name:'TrakBot готовит ответ'}).waitFor({timeout:2000});
    await page.locator('.trakbot-message--bot').filter({hasText:'Не продолжай движение'}).waitFor({timeout:5000});
    const safety = await page.locator('.trakbot-message--bot').last().locator('.trakbot-mascot--stop').count();
    assert(safety===1,width+'×'+height+': brake advice must show stop/safety expression');
    const last = await page.evaluate(() => {
      const box=document.querySelector('.trakbot-dock-panel')?.getBoundingClientRect();
      const field=document.querySelector('.trakbot-dialog .compose input')?.getBoundingClientRect();
      return box && field && field.bottom<=box.bottom+3 && field.top>=box.top-3;
    });
    assert(last, width+'×'+height+': keyboard-focused input left the mini-chat');
    await page.locator('.trakbot-dock-close').click();
    assert(await page.locator('.trakbot-dock-panel').count()===0,
      width+'×'+height+': close blocked');
    assert(!errors.length, width+'×'+height+': runtime errors '+errors.join(' | '));
    console.log('OK TrakBot Android compact '+width+'x'+height+
      ', avatar '+Math.round(geometry.avatar.width)+'px, panel '+Math.round(geometry.panel.height)+'px');
    await context.close();
  }
} finally {
  await browser.close();
}
