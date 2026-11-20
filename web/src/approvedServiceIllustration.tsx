import { APPROVED_VISUALS } from './approvedVisuals.ts';
import './approvedServiceScene.css';

export type ServiceSceneKind = 'repair'|'tow'|'service'|'consult';
/**
 * One image atlas is shared by the four roadside-help tiles in authenticated
 * desktop, mobile Chrome and Android WebView. Image only: role authorization,
 * text and navigation remain with the parent tile.
 */
export function ApprovedServiceIllustration({kind}:{kind:ServiceSceneKind}) {
  return <span className={'tr-service-illustration tr-service-illustration--'+kind}
    aria-hidden="true" style={{backgroundImage:`url("${APPROVED_VISUALS.serviceScenes}")`}} />;
}
