import { NavGlyph } from './navGlyph.tsx';
import { groupCabinetMenu } from './cabinetMenuGroups.ts';

type MenuLink = [path: string, label: string];
type MenuEntry = {href:string; label:string};

function uniqueEntries(links:MenuLink[], omit:Set<string>):MenuEntry[] {
  const seen=new Set<string>(omit);
  const entries:MenuEntry[]=[];
  for (const [href,label] of links) {
    if (!href.startsWith('/') || !label.trim() || seen.has(href)) continue;
    seen.add(href);
    entries.push({href:'#'+href,label});
  }
  return entries;
}

function MenuSection({title,caption,entries,icon,initiallyOpen=false}:{
  title:string;caption:string;entries:MenuEntry[];icon:string;initiallyOpen?:boolean;
}) {
  if (!entries.length) return null;
  return <details className="tr-mobile-menu-section" open={initiallyOpen}>
    <summary className="tr-mobile-menu-section-head" aria-label={title}>
      <span className="tr-mobile-menu-section-icon"><NavGlyph glyph={icon}/></span>
      <span className="tr-mobile-menu-section-copy"><strong>{title}</strong><small>{caption}</small></span>
      <span className="tr-mobile-menu-disclosure" aria-hidden="true">⌄</span>
    </summary>
    <nav className="tr-mobile-menu-links" aria-label={title}>
      {entries.map(item=><a key={item.href} href={item.href}>
        <span>{item.label}</span><span className="tr-mobile-menu-chevron" aria-hidden="true">›</span>
      </a>)}
    </nav>
  </details>;
}

/**
 * All destinations are taken from the same role-filtered Shell navigation.
 * Do not create simulated sections, duplicate route logic, or expose other roles.
 */
export function MobileRoleMenu({mode,quick,account,help,onLogout}:{
  mode:string;
  quick:[string,string,string][];
  account:MenuLink[];
  help:MenuLink[];
  onLogout:()=>void;
}) {
  const home=quick.find(([href])=>href!=='/menu')?.[0] || '/';
  const quickEntries=uniqueEntries(
    quick.filter(([href])=>href!=='/menu' && href!=='/profile').map(([href,,label])=>[href,label]),
    new Set<string>()
  );
  const groups=groupCabinetMenu(account,help,[...quick.map(([href])=>href),'/profile']);
  const workEntries=uniqueEntries(groups.work,new Set());
  const helpEntries=uniqueEntries(groups.guidance,new Set());
  const documentEntries=uniqueEntries(groups.documents,new Set());
  const roleTitle:{[key:string]:string}={
    client:'Владелец / водитель',performer:'Выездной специалист',
    service:'СТО и рембаза',insurer:'Страховой партнёр',courier:'Курьер доставки',
    inspection:'Техосмотр',moderator:'Модератор',admin:'Администратор'
  };
  return <main className="tr-mobile-menu-page" aria-label="Меню кабинета TrakSOS">
    <div className="tr-mobile-menu-hero">
      <div>
        <span className="tr-mobile-menu-eyebrow">TRAKSOS · ЛИЧНЫЙ КАБИНЕТ</span>
        <h1>Меню и разделы</h1>
        <p>{roleTitle[mode] ?? 'Мой кабинет'} · все доступные действия в одном месте</p>
      </div>
      <NavGlyph glyph="▦"/>
    </div>
    <MenuSection title="Быстрый доступ" caption="Основные рабочие действия" entries={quickEntries} icon="⌂" initiallyOpen/>
    <MenuSection title="Разделы кабинета" caption="Заявки, техника, финансы и настройки по вашей роли" entries={workEntries} icon="▣"/>
    <MenuSection title="Помощь" caption="Обучение, подсказки и связь с поддержкой" entries={helpEntries} icon="?"/>
    <MenuSection title="Документы" caption="Договоры, оферты и правила" entries={documentEntries} icon="▤"/>
    <details className="tr-mobile-menu-section tr-mobile-menu-account">
      <summary className="tr-mobile-menu-section-head" aria-label="Аккаунт и настройки">
        <span className="tr-mobile-menu-section-icon"><NavGlyph glyph="◉"/></span>
        <span className="tr-mobile-menu-section-copy"><strong>Аккаунт</strong><small>Настройки и безопасный выход</small></span>
        <span className="tr-mobile-menu-disclosure" aria-hidden="true">⌄</span>
      </summary>
      <div className="tr-mobile-menu-links">
        <a href="#/profile"><span>Профиль и настройки</span><span className="tr-mobile-menu-chevron" aria-hidden="true">›</span></a>
        <button type="button" className="tr-mobile-menu-logout" onClick={onLogout}>Выйти из аккаунта</button>
      </div>
    </details>
    <a className="tr-mobile-menu-home" href={'#'+home}><NavGlyph glyph="⌂"/> Вернуться на рабочий стол</a>
  </main>;
}
