// Independent public business directory, not platform partners.
// Source facts reviewed on 2026-11-27; no calls, FNS or live availability confirmed.
// Keep only locations with first-party coordinates, address and business contact.
// Further additions require deduplication and a reviewed source; never guess GPS.
// Draft pilot only: replace static seed with moderated directory API before bulk rollout.
export type DirectoryPoint = {
  id: string; kind: 'service'; name: string; lat: number; lng: number;
  directory: true; address: string; phone: string; services: string[];
  hours?: string; source: string;
};
export const directoryPoints: readonly DirectoryPoint[] = [
  {id:'directory:mtbr-shushary',kind:'service',directory:true,name:'МТБР — Санкт-Петербург',
    lat:59.771946388888885,lng:30.455233333333332,
    address:'Санкт-Петербург, Шушары, Московское шоссе, 181, корп. 2, стр. 1',
    phone:'+78124495252',services:['Ремонт грузовиков','ТО','Прицепная техника'],
    hours:'Ежедневно 08:00–21:00 (по сайту)',source:'https://man-spb.ru/contacts/'},
  {id:'directory:tservice-fedorovskoe',kind:'service',directory:true,name:'Т-Сервис',
    lat:59.663862,lng:30.540923,address:'Ленинградская область, Фёдоровское, Почтовая ул., 20А',
    phone:'+79215918454',services:['Ремонт грузовиков','Прицепы и полуприцепы','Агрегатный ремонт'],
    source:'https://t-service-spb.ru/'},
];
export function directDirectoryDial(phone: string): string | undefined {
  return /^\+7\d{10}$/.test(phone) ? 'tel:'+phone : undefined;
}
