/** Расстояние по прямой, км */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}


/**
 * Conservative server-side sanity filter for a stream of GPS samples.
 * It is NOT proof of route progress or arrival: a plausible coordinate may
 * still be spoofed. Missing/stale previous samples reset the speed check.
 */
export function plausibleGpsStep(
  previous: { lat: number; lng: number; at: Date | string | number } | null,
  current: { lat: number; lng: number },
  receivedAt: Date | string | number,
): boolean {
  if (!Number.isFinite(current.lat) || !Number.isFinite(current.lng) ||
      Math.abs(current.lat) > 90 || Math.abs(current.lng) > 180) return false;
  if (!previous) return true;
  if (!Number.isFinite(previous.lat) || !Number.isFinite(previous.lng) ||
      Math.abs(previous.lat) > 90 || Math.abs(previous.lng) > 180) return true;
  const elapsedMs = new Date(receivedAt).getTime() - new Date(previous.at).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return false;
  // Do not infer speed across long offline gaps (e.g. backgrounded APK).
  if (elapsedMs > 15 * 60_000) return true;
  const km = haversineKm(previous, current);
  // 300m urban GPS noise + generous 180km/h travel limit.
  return km <= 0.3 + (elapsedMs / 3_600_000) * 180;
}
