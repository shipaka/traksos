/**
 * Curated *links* to manufacturer publications, not hosted copies of the documents.
 * Component records are not vehicle-specific: the technician must verify the
 * installed manufacturer, variant and part number before using a schematic.
 */
export type TechAudience = 'driver' | 'master';
export type TechKind = 'truck' | 'trailer' | 'component';
export type TechDocument = {
  id: string;
  title: string;
  audience: TechAudience;
  kind: TechKind;
  vehicleMake: string | null;
  models: readonly string[];
  componentMake: string | null;
  system: string;
  type: 'operation' | 'maintenance' | 'diagnostics' | 'wiring' | 'parts' | 'service';
  language: string;
  source: string;
  url: string;
  access: 'open' | 'portal';
  applicability: 'brand' | 'model' | 'component' | 'vin';
  warning: string;
  reviewedOn: string;
};

export const TECHBASE_CATALOG: readonly TechDocument[] = [
  { id:'scania-driver',title:'Scania — руководство водителя и эксплуатация систем',audience:'driver',kind:'truck',vehicleMake:'Scania',models:[],componentMake:null,system:'Эксплуатация',type:'operation',language:'EN',source:'Scania Bodybuilder',url:'https://bodybuilder.scania.com/trucks/en/instructions/drivers-manual.html',access:'open',applicability:'brand',warning:'Доступны выдержки; конкретное руководство выбирается по комплектации автомобиля.',reviewedOn:'2026-11-18' },
  { id:'volvo-driver',title:'Volvo Trucks — Driver Guide по номеру шасси',audience:'driver',kind:'truck',vehicleMake:'Volvo',models:[],componentMake:null,system:'Эксплуатация',type:'operation',language:'MULTI',source:'Volvo Trucks',url:'https://driverguide.volvotrucks.com/',access:'open',applicability:'vin',warning:'Производитель подбирает инструкции по шасси; VIN вводите только на сайте Volvo.',reviewedOn:'2026-11-18' },
  { id:'daf-driver',title:'DAF — заводское руководство водителя по VIN',audience:'driver',kind:'truck',vehicleMake:'DAF',models:[],componentMake:null,system:'Эксплуатация',type:'operation',language:'MULTI',source:'DAF Trucks',url:'https://www.daf.com/en/driver-information/driver-manuals',access:'open',applicability:'vin',warning:'Для Euro 6 потребуется вручную ввести последние восемь символов VIN на сайте DAF.',reviewedOn:'2026-11-18' },
  { id:'mercedes-driver',title:'Mercedes-Benz Trucks — инструкции по эксплуатации',audience:'driver',kind:'truck',vehicleMake:'Mercedes-Benz',models:['Actros'],componentMake:null,system:'Эксплуатация',type:'operation',language:'MULTI',source:'Mercedes-Benz Trucks',url:'https://bb-portal.mercedes-benz-trucks.com/en/GLOBAL/lastkraftwagen/technik-und-informationen/auswahl/betriebsanleitungen',access:'open',applicability:'model',warning:'Выберите точное поколение и комплектацию в каталоге производителя.',reviewedOn:'2026-11-18' },
  { id:'krone-load-carrier',title:'KRONE Load Carrier — инструкция эксплуатации',audience:'driver',kind:'trailer',vehicleMake:'KRONE',models:['Load Carrier'],componentMake:null,system:'Эксплуатация прицепа',type:'operation',language:'EN',source:'KRONE',url:'https://www.krone-trailer.com/fileadmin/media/downloads/EN/Anhaenger_und_Aufbauten/Betriebsanleitungen/Load_Carrier/505410638_02_BA_Load_Carrier_eng.pdf',access:'open',applicability:'model',warning:'Применима к указанной линейке Load Carrier; версию определяйте по табличке прицепа.',reviewedOn:'2026-11-18' },
  { id:'krone-inspection',title:'KRONE — сервисная книжка и перечни осмотров (RU)',audience:'driver',kind:'trailer',vehicleMake:'KRONE',models:[],componentMake:null,system:'Техническое обслуживание',type:'maintenance',language:'RU',source:'KRONE',url:'https://www.krone-trailer.com/en/downloads/',access:'open',applicability:'brand',warning:'Откройте раздел Inspection Booklets → Сервисная книжка RU.',reviewedOn:'2026-11-18' },
  { id:'carrier-8500-operator',title:'Carrier Vector 8500 — руководство оператора',audience:'driver',kind:'component',vehicleMake:null,models:['Vector 8500'],componentMake:'Carrier Transicold',system:'Рефрижератор',type:'operation',language:'EN',source:'Carrier Transicold',url:'https://locator.ttdealers.carrier.com/upload/62-11646-01%20Rev%20C_ENG-CAN-BRA-COL.pdf',access:'open',applicability:'component',warning:'Только для указанной модели агрегата; модель уточните по табличке.',reviewedOn:'2026-11-18' },
  { id:'carrier-8600-operator',title:'Carrier Vector 8600MT — руководство оператора',audience:'driver',kind:'component',vehicleMake:null,models:['Vector 8600MT'],componentMake:'Carrier Transicold',system:'Рефрижератор',type:'operation',language:'EN',source:'Carrier Transicold',url:'https://locator.ttdealers.carrier.com/upload/62-12320_A.pdf',access:'open',applicability:'component',warning:'Только для Vector 8600MT с контроллером APX.',reviewedOn:'2026-11-18' },
  { id:'jost-operation',title:'JOST — эксплуатация и обслуживание седельных устройств',audience:'driver',kind:'component',vehicleMake:null,models:[],componentMake:'JOST',system:'Седельно-сцепное устройство',type:'operation',language:'EN',source:'JOST',url:'https://production.jost-world.com/en/products/pdf-downloads/jost-truck-trailer-components/',access:'open',applicability:'component',warning:'Выберите тип седельно-сцепного устройства по маркировке.',reviewedOn:'2026-11-18' },
  { id:'zf-ebs31',title:'WABCO EBS 3.1 — ремонтное руководство TP15143',audience:'master',kind:'component',vehicleMake:null,models:['EBS 3.1'],componentMake:'WABCO',system:'EBS / ABS',type:'diagnostics',language:'EN',source:'ZF WABCO',url:'https://www.zf.com/products/media/automotive/cv/literature_downloads_wna/truck_solutions/abs__ebs___habs_technical_publications/TP15143_web.pdf',access:'open',applicability:'component',warning:'Документ для конкретной североамериканской системы EBS 3.1; нельзя автоматически применять к европейским тягачам и прицепам.',reviewedOn:'2026-11-18' },
  { id:'zf-publications',title:'ZF WABCO — ремонт, диагностика и кабели ABS/EBS',audience:'master',kind:'component',vehicleMake:null,models:[],componentMake:'WABCO',system:'EBS / ABS',type:'diagnostics',language:'EN',source:'ZF',url:'https://www.zf.com/products/en/cv/footer/downloads/downloads.html',access:'open',applicability:'component',warning:'Подбирайте публикацию по номеру системы и артикулу блока.',reviewedOn:'2026-11-18' },
  { id:'haldex-gen3',title:'Haldex EB+ Gen3 — монтаж и технические документы',audience:'master',kind:'component',vehicleMake:null,models:['EB+ Gen3'],componentMake:'Haldex',system:'EBS / ABS',type:'wiring',language:'EN',source:'Haldex',url:'https://www.haldex.com/en/europe/trailer-application-guide/ebs/eb-gen3/documents/',access:'open',applicability:'component',warning:'Схемы различаются по модификации EBS и конфигурации датчиков/модуляторов.',reviewedOn:'2026-11-18' },
  { id:'knorr-eservice',title:'Knorr-Bremse — сервисные руководства TEBS и суппортов',audience:'master',kind:'component',vehicleMake:null,models:[],componentMake:'Knorr-Bremse',system:'EBS / ABS',type:'service',language:'EN',source:'Knorr-Bremse',url:'https://truckservices.knorr-bremse.com/en/be/services/technical-documentation/',access:'portal',applicability:'component',warning:'Часть документов открывается через портал производителя; применимость по номеру изделия.',reviewedOn:'2026-11-18' },
  { id:'bpw-tsb',title:'BPW ECO Disc TSB — ремонт дисковых тормозов',audience:'master',kind:'component',vehicleMake:null,models:['TSB'],componentMake:'BPW',system:'Оси и тормоза',type:'service',language:'EN',source:'BPW',url:'https://www.bpw.de/uploads/tx_szdownloadcenter/Workshopmanual-TSB_35291801e.pdf',access:'open',applicability:'component',warning:'Проверить тип оси, тормоза и поколение ECO Plus перед процедурой.',reviewedOn:'2026-11-18' },
  { id:'bpw-maintenance',title:'BPW — регламент обслуживания осей и подвесок',audience:'master',kind:'component',vehicleMake:null,models:[],componentMake:'BPW',system:'Оси и подвеска',type:'maintenance',language:'EN',source:'BPW',url:'https://www.bpw.de/uploads/tx_szdownloadcenter/Maintenance-instructions-Trailer-Axles_Suspensions-33111701e.pdf',access:'open',applicability:'component',warning:'Уточнить конструкцию оси и применимую редакцию регламента.',reviewedOn:'2026-11-18' },
  { id:'saf-axle-zi',title:'SAF-Holland S(Z)11/12 — ремонт осей с дисковыми тормозами',audience:'master',kind:'component',vehicleMake:null,models:['S(Z)11/12-22K11/K10'],componentMake:'SAF-Holland',system:'Оси и тормоза',type:'service',language:'EN',source:'SAF-Holland',url:'https://safholland.com/za/en/download-center/document/resource/environment/project1_p/documents/documentationP/Before%2520Empolis%2520Box%2520update/pLiterature/WH_TA_disc_SI-ZI11-12_22K10_en-DE.pdf',access:'open',applicability:'component',warning:'Только для указанных моделей осей, идентифицируемых по табличке или серийному номеру.',reviewedOn:'2026-11-18' },
  { id:'man-service',title:'MAN — заводские схемы, DTC и инструкции по ремонту',audience:'master',kind:'truck',vehicleMake:'MAN',models:[],componentMake:null,system:'Электрика и диагностика',type:'wiring',language:'MULTI',source:'MAN Service Portal',url:'https://public.man.eu/portal/asp/en/98221',access:'portal',applicability:'vin',warning:'Используйте идентификацию автомобиля и доступ к MAN Service Portal; не универсальная схема.',reviewedOn:'2026-11-18' },
  { id:'daf-rmi',title:'DAF RMI — сервисные операции, ремонт по VIN',audience:'master',kind:'truck',vehicleMake:'DAF',models:[],componentMake:null,system:'Ремонт и диагностика',type:'service',language:'MULTI',source:'DAF',url:'https://rmi.daf.com/en/standard-navigation/retrieve-information-packages/workshop-procedures',access:'portal',applicability:'vin',warning:'Рабочие процедуры доступны после идентификации машины по VIN и при наличии требуемого доступа.',reviewedOn:'2026-11-18' },
  { id:'carrier-install',title:'Carrier — монтажные схемы транспортных рефрижераторов',audience:'master',kind:'component',vehicleMake:null,models:[],componentMake:'Carrier Transicold',system:'Рефрижератор',type:'wiring',language:'EN',source:'Carrier',url:'https://www.carrier.com/us/en/cold-chain/truck-trailer/installation-instructions/',access:'open',applicability:'component',warning:'Выбирайте серию X4 / Vector и ревизию холодильного агрегата.',reviewedOn:'2026-11-18' },
  { id:'bpw-parts',title:'BPW — поиск каталожных номеров по коду и номеру оси',audience:'master',kind:'component',vehicleMake:null,models:[],componentMake:'BPW',system:'Запчасти',type:'parts',language:'EN',source:'BPW',url:'https://www.bpw.de/en/service/after-sales-/-spare-parts-old/spare-parts-lists',access:'open',applicability:'component',warning:'Подбирать детали по номеру оси и дате изготовления.',reviewedOn:'2026-11-18' },
  { id:'krone-tpms',title:'KRONE TPMS — датчики и блок управления',audience:'master',kind:'trailer',vehicleMake:'KRONE',models:[],componentMake:null,system:'TPMS',type:'service',language:'EN',source:'KRONE',url:'https://www.krone-trailer.com/en/downloads/',access:'open',applicability:'brand',warning:'Выберите инструкцию TPMS нужной версии в разделе загрузок.',reviewedOn:'2026-11-18' },
  { id:'jost-service',title:'JOST — монтажные и сервисные инструкции седельных устройств',audience:'master',kind:'component',vehicleMake:null,models:[],componentMake:'JOST',system:'Седельно-сцепное устройство',type:'service',language:'EN',source:'JOST',url:'https://production.jost-world.com/en/products/pdf-downloads/jost-truck-trailer-components/',access:'open',applicability:'component',warning:'Точная модель определяется по маркировке седельного устройства.',reviewedOn:'2026-11-18' }
];

export function techBaseAudience(roles: readonly string[]): readonly TechAudience[] {
  const result: TechAudience[] = [];
  if (roles.some(role => ['client','driver','master','service','tow','admin','moderator'].includes(role))) result.push('driver');
  if (roles.some(role => ['master','service','admin','moderator'].includes(role))) result.push('master');
  return result;
}

export function techBaseForRoles(roles: readonly string[], requested?: string) {
  const allowed = techBaseAudience(roles);
  if (requested && requested !== 'driver' && requested !== 'master') return [];
  return TECHBASE_CATALOG.filter(doc => allowed.includes(doc.audience) &&
    (!requested || doc.audience === requested));
}
