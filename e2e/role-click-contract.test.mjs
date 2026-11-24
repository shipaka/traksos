import assert from 'node:assert/strict';
import {expectedTabs,assertRoleTabs,assertActiveTab,assertRoleMenu} from './role-click-contract.mjs';
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
