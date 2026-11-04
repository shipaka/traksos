// Вес отзыва зависит от рейтинга автора:
// вес = (рейтинг − 3) / 2, в пределах [0,1; 1]; у новичка (< 3 оценок) — 0,3.
// Оспоренные и скрытые отзывы не считаются.

import type { Settings } from './defaults.ts';

export function authorWeight(cfg: Settings['reviews'], rating: number | null, ratingCount: number) {
  if (rating === null || ratingCount < cfg.newbieMinRatings) return cfg.newbieWeight;
  const w = (rating - 3) / 2;
  return Math.min(cfg.maxWeight, Math.max(cfg.minWeight, round3(w)));
}

export function weightedRating(reviews: { stars: number; weight: number; disputed?: boolean; hidden?: boolean }[]) {
  const valid = reviews.filter((r) => !r.disputed && !r.hidden);
  const wsum = valid.reduce((s, r) => s + r.weight, 0);
  if (!valid.length || wsum === 0) return { rating: null as number | null, count: 0 };
  const v = valid.reduce((s, r) => s + r.stars * r.weight, 0) / wsum;
  return { rating: Math.round(v * 100) / 100, count: valid.length };
}

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}
