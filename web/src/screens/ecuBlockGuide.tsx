import {useMemo,useState} from 'react';
import './ecuBlockGuide.css';

/** Curated acronym *glossary*, not a VIN-level fitment catalog.
 * Entries are authored summaries, links point to original documentation only.
 * Never imply that a module is present in every truck of a brand.
 */
export type EcuBlock={make:string;code:string;title:string;purpose:string;source:string;scope:string};
const SCANIA='https://help-my.scania.com/gb/en/knowledge-base.html?category=general-information&subcategory_level1=eu-data-act-and-scanias-connected-products';
const VOLVO='https://www.volvotrucks.us/media/vtna/files/shared/body-builder/manuals/volvo-bb-section-3-vecu4.pdf';
const MAN='https://zinref.ru/avtomobili/Man/002_Gruzoviki%20MAN%20ZDR-KSM_2016_god/001.htm';
export const ECU_BLOCKS:readonly EcuBlock[]=[
 {make:'Scania',code:'EMS',title:'Управление двигателем',purpose:'Система управления работой двигателя и его параметрами',source:SCANIA,scope:'Точная установка зависит от модели и комплектации'},
 {make:'Scania',code:'GMS',title:'Управление коробкой передач',purpose:'Система управления трансмиссией',source:SCANIA,scope:'Точная установка зависит от модели и комплектации'},
 {make:'Scania',code:'BMS',title:'Управление тормозной системой',purpose:'Brake Management System — электронное управление тормозами',source:SCANIA,scope:'Точная установка зависит от поколения и исполнения'},
 {make:'Volvo',code:'VECU',title:'Электронный блок управления автомобилем',purpose:'Vehicle Electronic Control Unit — управление функциями автомобиля',source:VOLVO,scope:'Список модуляций относится к определённым семействам Volvo; проверяйте VIN'},
 {make:'Volvo',code:'ECM',title:'Блок управления двигателем',purpose:'Engine Control Module',source:VOLVO,scope:'Не подтверждает наличие блока на каждой модификации'},
 {make:'Volvo',code:'TECU',title:'Электронный блок управления трансмиссией',purpose:'Transmission Electronic Control Unit',source:VOLVO,scope:'Тип коробки и модуль зависят от исполнения'},
 {make:'Volvo',code:'TCM',title:'Модуль управления трансмиссией',purpose:'Transmission Control Module',source:VOLVO,scope:'Не является синонимом совместимости с TECU'},
 {make:'MAN',code:'FFR',title:'Компьютер управления автомобилем',purpose:'Управление функциями движения и автомобиля',source:MAN,scope:'Источник — копия технического документа, нужна проверка по конкретной машине'},
 {make:'MAN',code:'ZBR',title:'Центральный бортовой компьютер',purpose:'Центральная электронная система автомобиля',source:MAN,scope:'Источник — копия технического документа, нужна проверка по конкретной машине'},
 {make:'MAN',code:'KSM',title:'Блок управления оборудованием надстройки',purpose:'Опциональный блок для дополнительных функций надстройки',source:MAN,scope:'Есть только на некоторых комплектациях; не считать обязательным'},
];
const matches=(a:string,b:string)=>a.trim().toLocaleLowerCase('ru-RU')===b.trim().toLocaleLowerCase('ru-RU');
export function EcuBlockGuide({make='',selected='',onSelect}:{
 make?:string;selected?:string;onSelect?:(code:string)=>void
}){
 const [filterMake,setFilterMake]=useState('');
 const [query,setQuery]=useState('');
 const currentMake=make||filterMake;
 const options=useMemo(()=>ECU_BLOCKS.filter(x=>(!currentMake||matches(x.make,currentMake))&&
  (!query||[x.code,x.title,x.purpose].join(' ').toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')))),
  [currentMake,query]);
 return <section className="card stack" aria-label="Справочник электронных блоков">
  <div><b>Справочник электронных блоков</b>
   <p className="note">Расшифровка обозначений из диагностики, без схем, прошивок и предположений о совместимости. Начальная база: Scania, Volvo, MAN.</p></div>
  {!make&&<label>Марка
   <select className="field" value={filterMake} onChange={e=>setFilterMake(e.target.value)}>
    <option value="">Все марки</option>
    {['Scania','Volvo','MAN'].map(m=><option key={m} value={m}>{m}</option>)}
   </select>
  </label>}
  <input className="field" type="search" aria-label="Поиск блока по коду или названию"
   value={query} onChange={e=>setQuery(e.target.value)} placeholder="Код или название: BMS, VECU, FFR…"/>
  {options.length===0&&<p className="note">Для этой марки записи пока не проверены. Выберите «Не знаю / нет в списке» и опишите проблему.</p>}
  <div className="stack">
   {options.map(x=><article key={x.make+':'+x.code} className="card flat stack">
     <div className="between"><strong>{x.make} · {x.code}</strong>
       {onSelect&&<button type="button" className="btn small ghost"
         aria-pressed={selected===x.code} onClick={()=>onSelect(x.code)}>{selected===x.code?'Выбран':'Выбрать'}</button>}
     </div>
     <b>{x.title}</b><span className="note">{x.purpose}</span>
     <small className="note">Применяемость: {x.scope}</small>
     <a href={x.source} target="_blank" rel="noreferrer noopener" className="note">Проверить первоисточник</a>
   </article>)}
  </div>
  {onSelect&&<button type="button" className="btn ghost" aria-pressed={selected==='unknown'}
    onClick={()=>onSelect('unknown')}>Не знаю / блока нет в списке</button>}
  <p className="note">Название модуля — справочная подсказка, а не гарантия применяемости по модели, году или VIN.</p>
 </section>;
}
