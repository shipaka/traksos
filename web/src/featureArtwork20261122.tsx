/** One source of truth for the five illustrated TrakSOS service cards.
 * All sizes have been exported from the SAME immutable master scene.
 * Do not substitute alternate images for an existing service in another cabinet.
 *
 * Master: 512×512 WebP. Desktop: 512×300. Mobile web: 360×210.
 * Android: 256×150. Text, logo and CTA are always separate DOM elements.
 */
import type { CSSProperties } from 'react';
import {native} from './native.ts';

export const FEATURE_ART_KEYS = ['tech','ecu','parts','insurance','inspection'] as const;
export type FeatureArtworkKey = typeof FEATURE_ART_KEYS[number];

type Variants = {
  master:string;desktop:string;mobile:string;android:string;
};
const art = (name:FeatureArtworkKey):Variants => ({
  master: `/feature-art/traksos-feature-${name}-master-20261122.webp`,
  desktop: `/feature-art/traksos-feature-${name}-desktop-20261122.webp`,
  mobile: `/feature-art/traksos-feature-${name}-mobile-20261122.webp`,
  android: `/feature-art/traksos-feature-${name}-android-20261122.webp`,
});
export const FEATURE_ARTWORK:Readonly<Record<FeatureArtworkKey,Variants>> = Object.freeze({
  tech:art('tech'),
  ecu:art('ecu'),
  parts:art('parts'),
  insurance:art('insurance'),
  inspection:art('inspection'),
});

export function FeatureArtwork({kind,className=''}:{kind:FeatureArtworkKey,className?:string}) {
  const image=FEATURE_ARTWORK[kind];
  // The native Android app has a separate tested visual size and must not load
  // the 512px desktop file when it displays its compact approved cards.
  const src=native.isApp?image.android:image.desktop;
  const compact=native.isApp?image.android:image.mobile;
  return <picture className={['traksos-feature-art',className].filter(Boolean).join(' ')}
      data-feature-art={kind} aria-hidden="true">
    <source media="(max-width:899px)" srcSet={compact}/>
    <img src={src} alt="" loading="lazy" decoding="async" draggable={false}
      style={{objectPosition:'right center'} satisfies CSSProperties}/>
  </picture>;
}
