// Independent acceptance matrix for the approved role navigation (617/618).
// Keep this explicit: deriving expected tabs from the app would miss regressions.
export const expectedTabs=Object.freeze({
  client:['#/','#/orders','#/air','#/garage','#/menu'],
  performer:['#/work','#/work/jobs','#/work/chats','#/menu'],
  service:['#/base','#/base/inbox','#/shop','#/base/money','#/menu'],
  insurer:['#/insurance','#/insurance/requests','#/insurance/chats','#/menu'],
  inspection:['#/inspections','#/menu'],
  courier:['#/courier','#/courier/jobs','#/support','#/menu'],
  moderator:['#/moderation','#/support','#/menu'],
  admin:['#/admin','#/admin/section/orders','#/admin/section/people','#/menu']
});
export function assertRoleTabs(mode,actual){
  const expected=expectedTabs[mode];
  if(!expected||JSON.stringify(expected)!==JSON.stringify(actual))
    throw Error(mode+': unexpected role tabs '+JSON.stringify({expected,actual}));
}
export function assertActiveTab(actual,target){
  if(actual.length!==1||actual[0]!==target)
    throw Error('Expected one active tab '+target+', got '+JSON.stringify(actual));
}
export function assertRoleMenu(mode,links){
  const allowedShop=['client','performer','service'].includes(mode);
  if(links.includes('#/shop')!==allowedShop)throw Error(mode+': wrong shop visibility');
  if(mode!=='admin'&&links.some(x=>x.startsWith('#/admin/section/')))
    throw Error(mode+': administrator links exposed');
  for(const href of ['#/profile','#/support','#/help']){
    if(!links.includes(href))throw Error(mode+': missing menu route '+href);
  }
}

// Independent work-action contract for the desktop sidebar, not just generic
// account menu links. Exact routes are safe reads/forms; never submit a request.
export const desktopActions=Object.freeze({
  owner:['#/orders','#/sos','#/garage','#/fleet','#/shop','#/services','#/insurance/request/new','#/air'],
  driver:['#/orders','#/sos','#/garage','#/shop','#/services','#/insurance/request/new','#/air'],
  master:['#/work/jobs','#/work/me/schedule','#/work/filter','#/work/me/money','#/work/docs','#/shop'],
  tow:['#/work/jobs','#/work/me/schedule','#/work/filter','#/work/me/money','#/work/docs','#/shop'],
  service:['#/base/money','#/base/me','#/shop','#/support'],
  'hybrid-service':['#/base/money','#/base/me','#/shop','#/support'],
  'hybrid-master':['#/work/jobs','#/work/me/schedule','#/work/filter','#/work/me/money','#/work/docs','#/shop'],
  insurer:['#/profile'],
  inspection:['#/profile'],
  courier:['#/courier/jobs','#/support'],
  moderator:['#/moderation/verify','#/support','#/profile'],
  admin:['#/admin/section/orders','#/admin/section/support','#/profile']
});
export function assertDesktopActions(role,links,home){
  const required=desktopActions[role];
  if(!required)throw Error('Unknown desktop role '+role);
  for(const href of [home,...required]){
    if(links.filter(x=>x===href).length!==1)
      throw Error(role+': missing or duplicate desktop action '+href);
  }
  if(role==='driver'&&links.includes('#/fleet'))throw Error('Driver sees owner fleet action');
}
