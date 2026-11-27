// Actual React image states, isolated local synthetic image responses; no accounts or writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
  stdin:{contents:`
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {VehiclePhotoLink,VehicleModelPhoto} from './web/src/vehicleVisual.tsx';
    function Fixture(){
      const [vehicle,setVehicle]=useState({brand:'Scania',model:'R',year:2020});
      window.setVehicle=setVehicle;
      return <><div id="linked"><VehiclePhotoLink {...vehicle} href="#/garage/truck-test"/></div>
        <div id="standalone"><VehicleModelPhoto {...vehicle} familyExample/></div></>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `,resolveDir:process.cwd(),sourcefile:'photo-state-fixture.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},
});
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:844},locale:'ru-RU'});
    try{
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('http://photo-test.invalid/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body><div id="root"></div></body></html>'});
        if(path.endsWith('/scania-r520-2016.webp'))return route.fulfill({status:404,body:''});
        if(path.endsWith('/renault-premium-2006.webp'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="black"/></svg>'});
        return route.fulfill({status:404,body:''});
      });
      await page.goto('http://photo-test.invalid/');
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      const linked=page.locator('#linked'), standalone=page.locator('#standalone');
      const caption=linked.locator('.trak-vehicle-photo-caption small');
      const credit=linked.locator('.trak-vehicle-photo-credits');
      await standalone.getByText('Не удалось загрузить фото модели',{exact:true}).waitFor();
      await linked.getByText('Не удалось загрузить фото модели',{exact:true}).waitFor();
      assert.match(await caption.innerText(),/Не удалось загрузить/);
      assert.equal(await credit.count(),0);
      assert.equal(await linked.getByRole('link').getAttribute('href'),'#/garage/truck-test');
      await page.evaluate(()=>window.setVehicle({brand:'КАМАЗ',model:'54901',year:2024}));
      await linked.getByText('Точное фото модели пока не добавлено',{exact:true}).waitFor();
      assert.match(await caption.innerText(),/Фото для этой модели пока нет/);
      assert.equal(await credit.count(),0);
      await page.evaluate(()=>window.setVehicle({brand:'Renault',model:'Premium',year:2010}));
      await credit.waitFor();
      assert.match(await caption.innerText(),/Фото соответствующей модели/);
      await page.waitForFunction(()=>document.querySelector('#standalone img')?.naturalWidth>0);
      await linked.locator('.trak-vehicle-photo-link').click();
      await page.waitForURL('**/#/garage/truck-test');
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
  console.log('PASS vehicle photo: error vs unavailable, new model recovery, caption, credit and history link');
}finally{await browser.close();}
