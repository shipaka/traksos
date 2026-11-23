/**
 * Single visual-source registry for TrakSOS Web, mobile browser and Android
 * WebView. A role may lay out images differently; it must not invent its own
 * logo, truck mascot or unrelated scene for the same job.
 *
 * Logo: direct unchanged crop of owner's approved Android 618.png (20 Nov).
 * Mascot: approved v3 truck-technician, 30 expressions, already in public.
 * Road scene: the same locally bundled licensed/approved illustration in
 * authenticated desktop, mobile Chrome and Android; never an actual customer
 * vehicle. Actual vehicle photos always come from vehiclePhotoCatalog.ts.
 * Public desktop PC's approved 617.png photographic composition remains separate.
 */
export const APPROVED_VISUALS = Object.freeze({
  logo: '/traksos-brand-logo-approved-618.png',
  trakbotHello: '/trakbot-approved-hello.webp',
  trakbotReactions: '/trakbot-approved-30.webp',
  workspaceTruck: '/tracksos-approved-hero-owner-20261119-retouched.webp',
  serviceScenes: '/traksos-service-scenes-shared.webp',
  // Same four services; higher-resolution illustrative photos for PC cabinets only.
  desktopServiceScenes: '/traksos-service-scenes-desktop-hq.webp',
  publicPcPhoto: '/owner20-photo-background-approved-retouched.webp',
  // Approved 23 Nov 2026 variant #3; unique asset used only after exhausted SOS dispatch.
  noPerformerSearch: '/feature-art/traksos-no-performer-search-approved-20261123.webp',
  publicPcAtlas: '/owner20-artwork-sprite-retouched.webp',
} as const);

export const APPROVED_SCENE_COPY = Object.freeze({
  orders: 'Нейтральная иллюстрация грузовика. Нет активной заявки или маршрута.',
  fleet: 'Иллюстрация грузового автомобиля. Это не зарегистрированная техника пользователя.',
  shift: 'Иллюстрация выездной помощи. Это не поступивший заказ.',
} as const);
