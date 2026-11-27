import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle=await build({stdin:{sourcefile:'inn-entry.tsx',resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {InnInput,validInnLength} from './web/src/innInput.tsx';
 function Form(){
   const [value,setValue]=useState('');
   const [personal,setPersonal]=useState(false);
   return <><button onClick={()=>{setValue('');setPersonal(!personal)}}>Тип ИНН</button>
     <InnInput key={String(personal)} personal={personal} value={value} onChange={setValue}/>
     <button disabled={!validInnLength(value,personal)}>Сохранить</button></>;
 }
 createRoot(document.getElementById('root')).render(<Form/>);
`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
const browser=await chromium.launch();
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const save=page.getByRole('button',{name:'Сохранить'});
  let input=page.getByRole('textbox',{name:'ИНН компании'});
  await input.fill('0123456789');assert.ok(await save.isEnabled());
  assert.equal(await input.inputValue(),'0123456789','leading zero must survive');
  await input.fill('01234567890');assert.ok(await save.isDisabled());
  await page.getByRole('alert').waitFor();
  await input.fill('012345678901');assert.ok(await save.isEnabled());
  const paste=async(text)=>input.evaluate((el,text)=>{
    el.select();
    const data=new DataTransfer();data.setData('text/plain',text);
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    el.dispatchEvent(event);return event.defaultPrevented;
  },text);
  assert.equal(await paste('0123456789012'),true,'overlong paste must be rejected before truncation');
  assert.equal(await input.inputValue(),'012345678901');
  assert.match(await page.getByRole('alert').innerText(),/Ввод не принят/);
  assert.equal(await paste('01234567A901'),true);
  assert.equal(await input.inputValue(),'012345678901');
  await page.getByRole('button',{name:'Тип ИНН'}).click();
  input=page.getByRole('textbox',{name:'ИНН физлица или ИП'});
  await input.fill('0123456789');assert.ok(await save.isDisabled());
  await input.fill('012345678901');assert.ok(await save.isEnabled());
  await input.fill('');assert.ok(await save.isDisabled());
  assert.equal(await input.getAttribute('maxlength'),'12');
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS INN input: company 10/12, individual 12, leading zeros, rejected paste and incomplete forms');
}finally{await browser.close();}
