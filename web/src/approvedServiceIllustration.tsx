import { APPROVED_VISUALS } from './approvedVisuals.ts';
import type { CSSProperties } from 'react';
import './approvedServiceScene.css';

export type ServiceSceneKind = 'repair'|'tow'|'service'|'consult';
/**
 * Same service-to-illustration mapping everywhere. Android and mobile browser
 * keep approved images; full-size PC cabinets may use different higher-density
 * photographs as expressly authorized by the owner. Both remain decorative.
 */
export function ApprovedServiceIllustration({kind}:{kind:ServiceSceneKind}) {
  const sources = {
    '--tr-service-mobile': `url("${APPROVED_VISUALS.serviceScenes}")`,
    '--tr-service-desktop': `url("${APPROVED_VISUALS.desktopServiceScenes}")`,
  } as CSSProperties;
  return <span className={'tr-service-illustration tr-service-illustration--'+kind}
    aria-hidden="true" style={sources} />;
}
