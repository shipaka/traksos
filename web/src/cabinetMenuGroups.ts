export type CabinetMenuLink=[path:string,label:string];

function isDocument(path:string) {
  return path==='/rules'||path==='/offers'||path==='/privacy'||
    path==='/work/docs'||path.startsWith('/offer/');
}

/** Group only existing, role-filtered routes. Preserve the first label for
 * duplicate work/help destinations and the explicit policy label for privacy. */
export function groupCabinetMenu(account:CabinetMenuLink[],help:CabinetMenuLink[],omit:readonly string[]=[]){
  const seen=new Set(omit);
  const helpPaths=new Set(help.map(([path])=>path));
  const work:CabinetMenuLink[]=[];
  const guidance:CabinetMenuLink[]=[];
  const documents:CabinetMenuLink[]=[];
  for(const [path,label] of [...account,...help]){
    if(!path.startsWith('/')||!label.trim()||seen.has(path))continue;
    seen.add(path);
    const entry:CabinetMenuLink=[path,path==='/offer/privacy'?'Политика персональных данных':label];
    if(isDocument(path))documents.push(entry);
    else if(helpPaths.has(path))guidance.push(entry);
    else work.push(entry);
  }
  return {work,guidance,documents};
}
