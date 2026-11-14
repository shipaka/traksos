import { useMemo, useState } from 'react';

/** Small, honest navigation search: finds only actual existing TrackSOS
 * sections/workflows. Supplier inventory is searched in the parts shop itself. */
const sections=[
  {id:'road',title:'Помощь в дороге',hint:'Вызов мастера, эвакуатора или выбор СТО',
    tags:'sos мастер эвакуатор помощь ремонт дорожная техпомощь',to:'/sos',guest:'/login',icon:'✚'},
  {id:'master',title:'Выездной мастер',hint:'Электрик, диагност, пневматика, автономка, шиномонтаж',
    tags:'выездной мастер автоэлектрик диагностика шиномонтаж пневматика',to:'/sos',guest:'/login',icon:'⚒'},
  {id:'tow',title:'Эвакуатор',hint:'Перевозка грузового автомобиля',
    tags:'эвакуатор эвакуация транспортировка тягач грузовик',to:'/new/tow',guest:'/login',icon:'↗'},
  {id:'sto',title:'Грузовые СТО',hint:'Найти сервис или записаться на ремонт',
    tags:'рембаза техобслуживание ремонт сто станция сервис',to:'/services',guest:'/login',icon:'▣'},
  {id:'consult',title:'Консультация специалиста',hint:'Помощь мастера по телефону',
    tags:'телефон консультация специалист помощь совет',to:'/new/consult',guest:'/login',icon:'☏'},
  {id:'insurance',title:'Страхование грузовика',hint:'ОСАГО, КАСКО, груз и ответственность',
    tags:'страхование осаго каско полис страховщик страховка',to:'/insurance/request/new',guest:'/register',icon:'◇'},
  {id:'parts',title:'Запчасти и аналоги',hint:'Перейти к поиску по артикулу в магазине',
    tags:'запчасти детали аналоги магазин каталог купить артикул',to:'/shop',guest:'/register',icon:'⚙'},
  {id:'inspection',title:'Техосмотр',hint:'Ваша техника и заявки на осмотр',
    tags:'техосмотр диагностическая карта осмотр',to:'/garage',guest:'/register',icon:'✓'},
  {id:'orders',title:'Мои заявки',hint:'Активные обращения и история',
    tags:'мои заявки история статус заказы обращения',to:'/orders',guest:'/login',icon:'☷'},
  {id:'guide',title:'Помощь и подсказки',hint:'Как пользоваться TrackSOS',
    tags:'справочник руководство как работает помощь подсказки',to:'/help',guest:'/help',icon:'?'},
];

export function SiteQuickSearch({ authenticated }: { authenticated:boolean }){
  const [value,setValue]=useState('');
  const [focus,setFocus]=useState(false);
  const query=value.toLocaleLowerCase('ru').trim();
  const found=useMemo(()=>query?sections.filter(s=>
    [s.title,s.hint,s.tags].some(v=>v.toLocaleLowerCase('ru').includes(query))).slice(0,6):[],[query]);
  const choose=(section:typeof sections[number])=>{
    setFocus(false);setValue('');
    location.hash='#'+(authenticated?section.to:section.guest);
  };
  return <div className="track-site-search">
    <label className="track-site-search-wrap">
      <span className="track-site-search-icon" aria-hidden="true">⌕</span>
      <input type="search" value={value} autoComplete="off"
        placeholder="Найти раздел или услугу…" aria-label="Поиск разделов и услуг"
        aria-controls="track-search-list"
        aria-expanded={focus&&!!query}
        onFocus={()=>setFocus(true)}
        onChange={e=>setValue(e.target.value)}
        onKeyDown={e=>{
          if(e.key==='Escape'){setFocus(false);(e.currentTarget as HTMLInputElement).blur();}
          if(e.key==='Enter'&&found.length){e.preventDefault();choose(found[0]);}
        }}
        onBlur={e=>{
          const target=e.relatedTarget as HTMLElement|null;
          if(!target?.closest('.track-site-search-results'))setFocus(false);
        }}/>
      <span className="track-site-search-shortcut" aria-hidden="true">↵</span>
    </label>
    {focus&&!!query&&<div className="track-site-search-results" id="track-search-list"
      role="listbox" aria-label="Найденные разделы">
      {found.length?found.map(item=><a key={item.id} href={'#'+(authenticated?item.to:item.guest)}
        role="option" aria-selected="false"
        onClick={e=>{e.preventDefault();choose(item);}}>
        <span className="track-site-search-result-icon" aria-hidden="true">{item.icon}</span>
        <span><b>{item.title}</b><small>{item.hint}</small></span>
        <span aria-hidden="true">›</span>
      </a>):<div className="track-site-search-empty">Раздел не найден. Попробуйте «мастер», «СТО», «запчасти» или «страхование».</div>}
    </div>}
  </div>;
}
