import { APPROVED_VISUALS } from './approvedVisuals.ts';

/** One branded phone preview for the public 617/618 app cards.
 * Uses the actual bundled TrakSOS application icon; not a fake RuStore badge,
 * an external screenshot, or a separate image variant per platform. */
export function TrakAppPhone({className = ''}:{className?:string}) {
  return <div className={['traksos-app-phone',className].filter(Boolean).join(' ')}
    aria-hidden="true">
    <div className="traksos-app-phone-screen">
      <span className="traksos-app-phone-camera"/>
      <img className="traksos-app-phone-mark" src={APPROVED_VISUALS.logo}
        width="274" height="46" alt=""/>
      <img className="public-app-phone-truck traksos-app-phone-icon"
        src="/icon-192.png?v=approved-20261120" alt="" loading="lazy" decoding="async"/>
      <span className="traksos-app-phone-caption">Помощь грузовику в дороге</span>
      <span className="traksos-app-phone-home"/>
    </div>
  </div>;
}
