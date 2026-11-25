import { APPROVED_SCENE_COPY, APPROVED_VISUALS } from './approvedVisuals.ts';
import './approvedEmptyScene.css';

type SceneKind = keyof typeof APPROVED_SCENE_COPY;

/**
 * A shared illustration for genuine EMPTY states only. No fictional order,
 * vehicle, income, ETA or completion status is inserted into real API data.
 * The same asset and subtle route motion are used in Web and Android WebView.
 */
export function ApprovedEmptyScene({kind}:{kind:SceneKind}) {
  return <div className={'tr-approved-empty-scene tr-approved-empty-scene--'+kind}
    role="img" aria-label={APPROVED_SCENE_COPY[kind]}>
    <img src={APPROVED_VISUALS.workspaceTruck} alt="" aria-hidden="true" loading="lazy" />
  </div>;
}
