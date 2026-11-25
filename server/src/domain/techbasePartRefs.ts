// A part reference is a catalogue identity, NOT a confirmed vehicle fit.
export type TechPartRef = {brand:string;article:string;name:string;source:string;sourcePage:number;fitment:'unknown'};
const source='https://bodybuilder.scania.com/content/dam/bodybuilder/tbb-files/scania-parts-for-bodybuilding/Pneumatic_system.pdf';
const ref=(article:string,name:string):TechPartRef=>({brand:'Scania',article,name,source,sourcePage:1,fitment:'unknown'});
// Independently checked against the catalogue table on page 1, not an OEM drawing copy.
const references:Record<string,readonly TechPartRef[]>={
 'scania-r-pressure-limit':[ref('1914109','Клапан ограничения давления')],
 'scania-r-check-valve':[ref('1912297','Обратный клапан')],
 'scania-r-air-reservoir':[ref('1357950','Ресивер 30 л, сталь'),ref('1549617','Ресивер 30 л, алюминий')],
 'scania-r-air-fitting-straight':[ref('2058773','Прямое соединение, малое'),ref('2058774','Прямое соединение, обычное')],
 'scania-r-air-body-outlet':[ref('2246502','Заглушка вывода воздуха для надстройки')],
};
export const partRefsForCard=(cardId:string):readonly TechPartRef[]=>references[cardId]??[];
export const exactPartKey=(s:string)=>s.trim().toLowerCase();
export const samePart=(a:{brand:string;article:string},b:{brand:string;article:string})=>
 exactPartKey(a.brand)===exactPartKey(b.brand)&&exactPartKey(a.article)===exactPartKey(b.article);
