// Conservative, snapshot-friendly explanation after ALL real SOS/search waves have ended.
// Never infer absence from the order status alone or from an empty nearby preview.
import { haversineKm } from './geo.ts';
import { performerKindFor } from './dispatch.ts';

export type NoPerformerReason =
  | 'not_connected'
  | 'temporarily_unavailable'
  | 'no_response'
  | 'unknown';

export interface PartnerPresence {
  kind: string;
  specialties: string[] | null;
  user_status: string;
  verification: string;
  line_status: string;
  paused: boolean;
  extras?: { vacation?: boolean } | null;
  lat: number | null;
  lng: number | null;
}

export function classifyNoPerformerReason(p: {
  service: string;
  verifiedOnly: boolean;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  invited: boolean;
  profiles: PartnerPresence[];
}): NoPerformerReason {
  // A recorded incoming-call invitation proves that at least one worker was
  // actually invited, even if the profile has since been deleted/disabled.
  if (p.invited) return 'no_response';

  const kind = performerKindFor(p.service);
  const connected = p.profiles.filter(x =>
    x.user_status === 'active' && x.kind === kind &&
    (kind !== 'master' || p.service === 'consult' ||
      (Array.isArray(x.specialties) && x.specialties.includes(p.service))));

  // This is a nationwide proof, not a guess from GPS or an unverified badge.
  if (connected.length === 0) return 'not_connected';

  const hasLocation = p.lat != null && p.lng != null &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  if (!hasLocation || !Number.isFinite(p.radiusKm) || p.radiusKm <= 0) return 'unknown';

  // Only make a temporary unavailability claim if matching workers actually
  // have recorded positions within the configured dispatch radius.
  const local = connected.filter(x =>
    (!p.verifiedOnly || x.verification === 'approved') &&
    x.lat != null && x.lng != null && Number.isFinite(x.lat) &&
    Number.isFinite(x.lng) &&
    haversineKm({ lat: p.lat!, lng: p.lng! }, { lat: x.lat, lng: x.lng }) <= p.radiusKm);
  if (local.length > 0 && local.every(x =>
    x.paused || !!x.extras?.vacation ||
    !['online', 'on_call'].includes(x.line_status))) {
    return 'temporarily_unavailable';
  }
  return 'unknown';
}
