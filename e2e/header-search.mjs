import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
 throw Error('Header search smoke is local only');
const browser=await chromium.launch();
const errors=[];
async function session(term, select, expectedHash, width=1440){
  // A new browser document per case avoids testing search during a previous
  // hash-router transition. This is the actual user opening a fresh page.
  const page=await browser.newPage({viewport:{width,height:width<500?844:900},locale:'ru-RU'});
  page.on('pageerror',err=>errors.push(err.message));
  try{
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    // Wait for the actual approved header control, not a retired hero heading.
    try {
      await page.locator('.track-site-search-icon').waitFor({state:'visible',timeout:10000});
    } catch (error) {
      // Keep the failure red; collect evidence rather than weakening the design assertion.
      const fs=await import('node:fs/promises');
      await fs.mkdir('e2e/shots',{recursive:true});
      await page.screenshot({path:'e2e/shots/header-search-failure.png',fullPage:true}).catch(()=>{});
      const snapshot=await page.evaluate(()=>({
        url:location.href,title:document.title,
        bodyText:document.body?.innerText?.slice(0,1400),
        searchIconCount:document.querySelectorAll('.track-site-search-icon').length,
        searchInputCount:document.querySelectorAll('input[type="search"]').length,
        appRoot:document.querySelector('#root')?.innerHTML?.slice(0,1400)
      })).catch(e=>({snapshotError:String(e)}));
      console.error('Header search diagnostic:',JSON.stringify({width,snapshot,errors}));
      throw error;
    }
    const search=page.getByRole('searchbox',{name:'Поиск разделов и услуг'});
    // Canonical header starts as a search icon; opening it must reveal a usable real input.
    await page.locator('.track-site-search-icon').click();
    await search.fill(term);
    const options=page.locator('#track-search-list');
    if(select){
      const found=options.getByRole('option',{name:select});
      await found.waitFor({state:'visible'});
      await found.click();
      await page.waitForURL(new RegExp('#/'+expectedHash+'$'));
    } else {
      await options.getByText(/Раздел не найден/).waitFor();
      await search.press('Escape');
      if(await options.count())throw Error('Escape did not close search results');
    }
  } finally {await page.close();}
}
try {
 await session('запчаст',/Запчасти и аналоги/,'register');
 await session('запчаст',/Запчасти и аналоги/,'register',390);
 await session('консультация',/Консультация специалиста/,'login');
 await session('несуществующее-направление',null,null);
 if(errors.length)throw Error('Page errors: '+errors.join(' | '));
 console.log('Approved icon-only expandable header search works on desktop and mobile');
}finally{await browser.close();}
