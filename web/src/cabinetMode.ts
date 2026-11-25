export type CabinetMode='client'|'performer'|'admin'|'moderator'|'service'|'insurer'|'inspection'|'courier';
export const CABINET_LANDINGS: Record<CabinetMode,string>={
  client:'',performer:'work',admin:'admin',moderator:'moderation',
  service:'base',insurer:'insurance',inspection:'inspections',courier:'courier',
};
export function canOpenCabinetMode(roles:readonly string[],mode:unknown):mode is CabinetMode {
  switch(mode){
    case 'client':return roles.includes('client')||roles.includes('driver');
    case 'performer':return roles.includes('master')||roles.includes('tow');
    case 'moderator':return roles.includes('moderator')||roles.includes('admin');
    case 'inspection':return roles.includes('inspection_operator');
    case 'admin':case 'service':case 'insurer':case 'courier':return roles.includes(mode);
    default:return false;
  }
}
export function fallbackCabinetMode(roles:readonly string[]):CabinetMode {
  return (['courier','insurer','inspection','client','performer','service','admin','moderator'] as const)
    .find(mode=>canOpenCabinetMode(roles,mode))??'client';
}
export function hybridCabinetChoices(roles:readonly string[],performerKind?:string) {
  if(!canOpenCabinetMode(roles,'performer')||!canOpenCabinetMode(roles,'service'))return [];
  const choices: {mode:CabinetMode;label:string}[]=[
    {mode:'performer',label:performerKind==='tow'?'Эвакуаторщик':'Выездной мастер'},
    {mode:'service',label:'СТО'},
    {mode:'client',label:roles.includes('driver')?'Сотрудник автопарка':'Владелец автопарка'},
    {mode:'insurer',label:'Страхование'},
    {mode:'inspection',label:'Техосмотр'},
    {mode:'courier',label:'Курьер'},
    {mode:'admin',label:'Администратор'},
    {mode:'moderator',label:'Модератор'},
  ];
  // Admin may open the moderation route without a distinct moderator role;
  // do not advertise that implicit capability as another assigned account.
  return choices.filter(c=>canOpenCabinetMode(roles,c.mode)&&
    (c.mode!=='moderator'||roles.includes('moderator')));
}
