import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
 throw Error('Header search smoke is local only');
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ru-RU'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
 const field=page.getByRole('searchbox',{name:'Поиск разделов и услуг'});
 await field.waitFor({state:'visible'});
 await field.fill('запчаст');
 const results=page.locator('#track-search-list');
 await results.getByRole('option',{name:/Запчасти и аналоги/}).waitFor();
 if(await results.getByRole('option').count()!==1)
   throw Error('Parts search should have one useful result');
 await field.press('Enter');
 await page.waitForURL(/#\/register$/);
 await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
 await field.fill('консультация');
 await results.getByRole('option',{name:/Консультация специалиста/}).click();
 await page.waitForURL(/#\/login$/);
 await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
 await field.fill('несуществующее-направление');
 await results.getByText(/Раздел не найден/).waitFor();
 await field.press('Escape');
 if(await results.count())throw Error('Escape did not close search results');
 if(errors.length)throw Error('Page errors: '+errors.join(' | '));
 console.log('Approved header search is functional: inventory entry, consultation, not found, keyboard');
} finally {await browser.close();}
