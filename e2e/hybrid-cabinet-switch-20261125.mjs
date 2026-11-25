// Chromium exercise of the shared role selector and assigned-role contract.
// No live accounts or API mutations.
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
  stdin:{contents:`
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {HybridCabinetSwitch} from './web/src/hybridCabinetSwitch.tsx';
    import {canOpenCabinetMode, fallbackCabinetMode, CABINET_LANDINGS} from './web/src/cabinetMode.ts';
    window.roleContract={canOpenCabinetMode,fallbackCabinetMode,CABINET_LANDINGS};
    function Fixture(){
      const [roles,setRoles]=useState(['master','service']);
      const [mode,setMode]=useState('performer');
      return <div className="app role-performer"><header className="top"><div className="row">
        <HybridCabinetSwitch roles={roles} mode={mode} onChoose={next=>{
          setMode(next);location.hash='#/'+CABINET_LANDINGS[next];
        }}/>
        </div></header><output>{mode}</output>
        <button onClick={()=>{setRoles(['master']);setMode('performer')}}>Отозвать СТО</button>
      </div>
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `,resolveDir:process.cwd(),loader:'tsx',sourcefile:'hybrid-switch-test.tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},
});
const browser=await chromium.launch();
const assert=(ok,message)=>{if(!ok)throw Error(message)};
try{
  for(const width of [320,390,1440]){
    const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width<900,isMobile:width<900});
    const page=await ctx.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
    for(const path of ['web/src/styles.css','web/src/cabinetPremium.css','web/src/hybridCabinetSwitch.css'])await page.addStyleTag({path});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const choice=page.getByRole('combobox',{name:'Текущий рабочий кабинет'});
    await choice.waitFor();
    assert(await choice.inputValue()==='performer','Initial role not shown');
    assert(await choice.locator('option').allTextContents().then(a=>a.join('|'))==='Выездной мастер|СТО','Incorrect role choices');
    await choice.selectOption('service');
    await page.waitForFunction(()=>location.hash==='#/base');
    assert(await choice.inputValue()==='service','Service not active');
    await choice.selectOption('performer');
    await page.waitForFunction(()=>location.hash==='#/work');
    assert(await choice.inputValue()==='performer','Master not active');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+3),'Header overflows');
    const contract=await page.evaluate(()=>{
      const {canOpenCabinetMode:can,fallbackCabinetMode:fallback,CABINET_LANDINGS:landing}=window.roleContract;
      return can(['master','service'],'performer')&&can(['master','service'],'service')&&
        !can(['master','service'],'admin')&&!can(['master'],'service')&&!can(['service'],'performer')&&
        !can(['driver'],'unknown')&&can(['driver'],'client')&&can(['admin'],'moderator')&&
        !can(['insurer'],'inspection')&&fallback(['service'])==='service'&&landing.service==='base';
    });
    assert(contract,'Assigned role permission contract failed');
    await page.getByRole('button',{name:'Отозвать СТО'}).click();
    assert(await choice.count()===0,'Single role should not show a role selector');
    assert(errors.length===0,'JS errors: '+errors.join('; '));
    await ctx.close();
  }
  console.log('PASS hybrid current-role selector, role permissions and narrow viewport');
}finally{await browser.close();}
