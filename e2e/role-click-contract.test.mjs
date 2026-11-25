import assert from 'node:assert/strict';
import {expectedTabs,assertRoleTabs,assertActiveTab,assertRoleMenu,desktopActions,assertDesktopActions,desktopPersonalPaths,assertDesktopMenu} from './role-click-contract.mjs';
for(const [mode,tabs] of Object.entries(expectedTabs)){
  assertRoleTabs(mode,tabs);
  assert.throws(()=>assertRoleTabs(mode,tabs.slice(1)),/unexpected role tabs/);
  assert.throws(()=>assertRoleTabs(mode,[...tabs,'#/fake']),/unexpected role tabs/);
  for(const tab of tabs)assertActiveTab([tab],tab);
  assert.throws(()=>assertActiveTab([tabs[0],tabs[1]],tabs[0]),/one active tab/);
  assert.throws(()=>assertActiveTab([],tabs[0]),/one active tab/);
  const links=['#/profile','#/support','#/help'];
  const shop=['client','performer','service'].includes(mode);
  if(shop)links.push('#/shop');
  assertRoleMenu(mode,links);
  assert.throws(()=>assertRoleMenu(mode,links.filter(x=>x!=='#/profile')),/missing menu route/);
  assert.throws(()=>assertRoleMenu(mode,shop?links.filter(x=>x!=='#/shop'):[...links,'#/shop']),/wrong shop visibility/);
  if(mode!=='admin')assert.throws(()=>assertRoleMenu(mode,[...links,'#/admin/section/orders']),/administrator links exposed/);
}
console.log('PASS role navigation contract: missing/extra tabs, wrong active state, menu permissions and missing profile rejected');

for(const [role,actions] of Object.entries(desktopActions)){
  const home=({owner:'#/',driver:'#/',master:'#/work',tow:'#/work',service:'#/base',
    'hybrid-service':'#/base','hybrid-master':'#/work',insurer:'#/insurance',
    inspection:'#/inspections',courier:'#/courier',moderator:'#/moderation',admin:'#/admin'})[role];
  const links=[home,...actions];
  assertDesktopActions(role,links,home);
  const mode=role==='owner'||role==='driver'?'client':role==='master'||role==='tow'||role==='hybrid-master'?'performer':role==='hybrid-service'?'service':role;
  const combined=[...new Set([...links,'#/profile','#/privacy','#/support','#/help','#/economics','#/learn',...(['client','performer','service'].includes(mode)?['#/shop']:[])])];
  const left=combined.filter(x=>!desktopPersonalPaths.includes(x)),right=combined.filter(x=>desktopPersonalPaths.includes(x));
  assertDesktopMenu(mode,role,left,right,home);
  assert.throws(()=>assertDesktopMenu(mode,role,[...left,'#/profile'],right.filter(x=>x!=='#/profile'),home),/incorrect desktop menu placement/);
  assert.throws(()=>assertDesktopMenu(mode,role,left.filter(x=>x!=='#/support'),[...right,'#/support'],home),/incorrect desktop menu placement/);
  assert.throws(()=>assertDesktopMenu(mode,role,left,[...right,'#/profile'],home),/duplicate desktop/);
  assert.throws(()=>assertDesktopMenu(mode,role,left.filter(x=>x!=='#/learn'),right,home),/missing work\/help destination/);
  for(const href of links)assert.throws(()=>assertDesktopActions(role,links.filter(x=>x!==href),home),/missing or duplicate desktop action/);
  assert.throws(()=>assertDesktopActions(role,[...links,actions[0]],home),/missing or duplicate desktop action/);
}
assert.throws(()=>assertDesktopActions('driver',['#/',...desktopActions.driver,'#/fleet'],'#/'),/Driver sees owner fleet action/);

// Actual Chromium negative controls: an overlay intercepts pointer events;
// a decorative button receives the click but never changes its destination.
const {chromium}=await import('playwright');
const {clickWorkingAction}=await import('./desktop-working-action.mjs');
const browser=await chromium.launch();
try{
  const page=await browser.newPage();
  await page.setContent('<button id="action" onclick="document.body.dataset.done=\'yes\'">Work</button><div id="cover" style="position:fixed;inset:0;z-index:100;background:transparent"></div>');
  const target=page.locator('#action');
  const verify=async()=>assert.equal(await page.locator('body').getAttribute('data-done'),'yes','Action did not change destination');
  await assert.rejects(()=>clickWorkingAction(target,verify,600),/Timeout/);
  await page.locator('#cover').evaluate(el=>el.remove());
  await target.evaluate(el=>el.removeAttribute('onclick'));
  await assert.rejects(()=>clickWorkingAction(target,verify),/Action did not change destination/);
  await target.evaluate(el=>el.addEventListener('click',()=>document.body.dataset.done='yes'));
  await clickWorkingAction(target,verify);
}finally{await browser.close();}
console.log('PASS desktop action matrix: missing and duplicate links, covered and inert actions rejected');
