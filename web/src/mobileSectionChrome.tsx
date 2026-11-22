import { NavGlyph } from './navGlyph.tsx';
import { APPROVED_VISUALS } from './approvedVisuals.ts';
import { approvedInnerSectionCopy } from './approvedInnerExperience.tsx';

/** Native-only compact continuation of the approved Android 618.png design.
 * Real content below is untouched. This is not a simulated workflow or API.
 * Links go to the existing role home, role menu and private TrakBot chat.
 */
export function MobileSectionChrome({ title, homeHref, route=[], mode='client' }: {
  title: string; homeHref: string; route?: string[]; mode?: string;
}) {
  const section=approvedInnerSectionCopy(route,title,mode);
  const staff=mode==='admin'||mode==='moderator';
  return <>
    <nav className="tr-native-section-path" aria-label="Навигация внутри кабинета">
      <a href={'#'+homeHref} className="tr-native-section-home"
        aria-label="Вернуться на рабочий стол"><NavGlyph glyph="⌂" /></a>
      <span className="tr-native-section-current" aria-current="page">
        <small>TRAKSOS · РАЗДЕЛ</small>
        <strong>{title}</strong>
      </span>
      <a href="#/menu" className="tr-native-section-menu" aria-label="Открыть все разделы">
        <NavGlyph glyph="menu" /><span>Разделы</span>
      </a>
    </nav>
    <section className="tr-native-section-brief" data-route={route.join("/")} aria-label="Подсказка по разделу">
      <div className="tr-native-section-brief-copy">
        <span className="tr-native-section-kicker">{section.marker}</span>
        <p>{section.subtitle}</p>
        {!staff && route[0]!=='trakbot' && <a href="#/trakbot" className="tr-native-section-assistant">
          <span className="tr-native-assistant-dot" aria-hidden="true"/>TrakBot · спросить лично <span aria-hidden="true">↗</span>
        </a>}
        {staff && <span className="tr-native-section-staff">Действия только по вашей роли</span>}
      </div>
      <img src={APPROVED_VISUALS.workspaceTruck} alt="" loading="lazy"/>
    </section>
  </>;
}
