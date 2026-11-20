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
    <svg className="tr-approved-scene-route" viewBox="0 0 420 150"
      preserveAspectRatio="none" aria-hidden="true">
      <path className="tr-approved-scene-route-line"
        d="M18 110 C 72 115, 83 65, 143 79 S 253 129, 302 60 S 373 51, 402 22" />
      <circle className="tr-approved-scene-route-origin" cx="18" cy="110" r="6"/>
      <circle className="tr-approved-scene-route-destination" cx="402" cy="22" r="7"/>
    </svg>
  </div>;
}
