// Independent public business directory, not platform partners.
// Source facts reviewed on 2026-11-27; no calls, FNS or live availability confirmed.
// Keep only locations with source-reported coordinates from the business or its manufacturer/distributor, address and public business contact.
// Further additions require deduplication and a reviewed source; never guess GPS.
// Draft pilot only: replace static seed with moderated directory API before bulk rollout.
import { regionalPilotPoints } from './stoRegionalPilot20261127.ts';
import { refrigerationPilotPoints } from './stoRefrigerationPilot20261127.ts';
export type MapServiceCategory = 'sto'|'tyre'|'wash'|'refrigeration'|'trailer';
export type DirectoryPoint = {
  id: string; kind: 'service'; name: string; lat: number; lng: number;
  directory: true; address: string; phone: string; services: string[];
  hours?: string; source: string; category?: MapServiceCategory;
};
export const directoryPoints: readonly DirectoryPoint[] = [
  ...refrigerationPilotPoints,
  ...regionalPilotPoints,
  {id:'directory:mtbr-shushary',kind:'service',directory:true,name:'МТБР — Санкт-Петербург',
    lat:59.771946388888885,lng:30.455233333333332,
    address:'Санкт-Петербург, Шушары, Московское шоссе, 181, корп. 2, стр. 1',
    phone:'+78124495252',services:['Ремонт грузовиков MAN','ТО'],
    hours:'Ежедневно 08:00–21:00 (по сайту)',source:'https://man-spb.ru/contacts/'},
  {id:'directory:irsa-spb',kind:'service',directory:true,name:'ИРСА',category:'sto',
    lat:60.047703,lng:30.250740,address:'Санкт-Петербург, ул. Заповедная, 51А',
    phone:'+79319547100',services:['Ремонт грузовиков','Двигатели','Подвеска','Тормоза','Грузовой шиномонтаж'],source:'https://remzona-irsa.ru/'},
  {id:'directory:asta-kola',kind:'service',directory:true,name:'АСТА / Cordiant Professional — Кола',category:'tyre',
    lat:68.877783,lng:33.026490,address:'Мурманская область, Кола, пр. Миронова, 10',
    phone:'+78155332342',services:['Грузовой шиномонтаж'],hours:'Пн–пт 09:00–17:00 (по сайту)',source:'https://www.astaworld.ru/shops/asta_zapchasti_kola_mironova_10'},
  {id:'directory:tservice-fedorovskoe',kind:'service',directory:true,name:'Т-Сервис',
    lat:59.663862,lng:30.540923,address:'Ленинградская область, Фёдоровское, Почтовая ул., 20А',
    phone:'+79215918454',services:['Ремонт грузовиков','Прицепы и полуприцепы','Агрегатный ремонт'],
    source:'https://t-service-spb.ru/'},
];
export function directDirectoryDial(phone: string): string | undefined {
  return /^\+7\d{10}$/.test(phone) ? 'tel:'+phone : undefined;
}
