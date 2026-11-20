import { NavGlyph } from './navGlyph.tsx';

/** A real, compact route breadcrumb in the native Android UI.
 * The link list and current label come from Shell's authorized role menu.
 * Do not infer a role or create a second navigation registry.
 */
export function MobileSectionChrome({ title, homeHref }: {
  title: string; homeHref: string;
}) {
  return <nav className="tr-native-section-path" aria-label="Навигация внутри кабинета">
    <a href={'#'+homeHref} className="tr-native-section-home"
      aria-label="Вернуться на рабочий стол"><NavGlyph glyph="⌂" /></a>
    <span className="tr-native-section-current" aria-current="page">
      <small>TRAKSOS · РАЗДЕЛ</small>
      <strong>{title}</strong>
    </span>
    <a href="#/menu" className="tr-native-section-menu" aria-label="Открыть все разделы">
      <NavGlyph glyph="menu" /><span>Разделы</span>
    </a>
  </nav>;
}
