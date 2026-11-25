export type CabinetMenuLink=[path:string,label:string];

function isDocument(path:string) {
  return path==='/rules'||path==='/offers'||path==='/privacy'||
    path==='/work/docs'||path.startsWith('/offer/');
}
function isFinance(path:string) {
  return ['/work/me/money','/work/me/tax','/base/money','/economics','/admin/section/payments'].includes(path);
}
function isSettings(path:string) {
  return ['/profile','/work/me','/work/me/about','/work/me/phone','/work/me/schedule',
    '/work/filter','/base/me','/admin/section/settings'].includes(path);
}
function isWorkTool(path:string) {
  return path==='/shop'||path.startsWith('/techbase/');
}

/** Group only existing, role-filtered routes; never grant access here.
 * Preserve exact labels (except the canonical privacy policy label), and
 * prioritize available tools without introducing another destination. */
export function groupCabinetMenu(account:CabinetMenuLink[],help:CabinetMenuLink[],omit:readonly string[]=[]){
  const seen=new Set(omit);
  const helpPaths=new Set(help.map(([path])=>path));
  const work:CabinetMenuLink[]=[];
  const tools:CabinetMenuLink[]=[];
  const finance:CabinetMenuLink[]=[];
  const settings:CabinetMenuLink[]=[];
  const guidance:CabinetMenuLink[]=[];
  const documents:CabinetMenuLink[]=[];
  for(const [path,label] of [...account,...help]){
    if(!path.startsWith('/')||!label.trim()||seen.has(path))continue;
    seen.add(path);
    const entry:CabinetMenuLink=[path,path==='/offer/privacy'?'Политика персональных данных':label];
    if(isDocument(path))documents.push(entry);
    else if(isFinance(path))finance.push(entry);
    else if(isSettings(path))settings.push(entry);
    else if(isWorkTool(path))tools.push(entry);
    else if(helpPaths.has(path))guidance.push(entry);
    else work.push(entry);
  }
  return {work:[...tools,...work],finance,settings,guidance,documents};
}
