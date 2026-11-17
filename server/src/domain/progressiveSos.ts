/**
 * #51. The staged SOS scheduler has NO approved production timing/radii yet.
 * It is disabled by default, and it MUST have a trusted server-side route
 * ETA provider before anyone can enable it.
 *
 * Haversine distance never stands in for a road ETA. The route provider
 * returns travel minutes along roads, excluding specialist preparation time.
 */
export interface SosSearchStage {
  radiusKm: number;
  maxRoadEtaMinutes: number;
  waitSeconds: number;
}
export interface SosSearchPolicy {
  enabled: boolean;
  stages: SosSearchStage[];
}
export type GeoPoint = {lat:number;lng:number};
export type VerifiedRoadEta = (from:GeoPoint,to:GeoPoint) => Promise<number|null>;

export function validStages(stages:unknown): stages is SosSearchStage[] {
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > 5) return false;
  let lastRadius=0,lastEta=0;
  for (const s of stages) {
    if (!s || typeof s !== 'object') return false;
    const v=s as Partial<SosSearchStage>;
    if (!Number.isInteger(v.radiusKm)|| v.radiusKm! < 1 || v.radiusKm! > 220 ||
        !Number.isInteger(v.maxRoadEtaMinutes)||v.maxRoadEtaMinutes! < 5||v.maxRoadEtaMinutes! > 180 ||
        !Number.isInteger(v.waitSeconds)||v.waitSeconds! < 10||v.waitSeconds! > 900 ||
        v.radiusKm! <= lastRadius || v.maxRoadEtaMinutes! <= lastEta) return false;
    lastRadius=v.radiusKm!;lastEta=v.maxRoadEtaMinutes!;
  }
  return true;
}

export function policyFor(order:{is_sos?:boolean;service?:string},policy:SosSearchPolicy|undefined,
  hasVerifiedEta:boolean):SosSearchStage[] | null {
  if (!order.is_sos || order.service==='consult' || !policy?.enabled ||
      !hasVerifiedEta || !validStages(policy.stages)) return null;
  return policy.stages;
}

/** Fail closed when no exact pickup/performer points or verified road ETA. */
export async function withinStage(
  stage:SosSearchStage,
  pickup:GeoPoint|null,
  performer:GeoPoint|null,
  distanceKm:number|null,
  prepMinutes:number,
  roadEta:VerifiedRoadEta|undefined,
):Promise<{travelMinutes:number;totalMinutes:number}|null>{
  if (!pickup||!performer||!roadEta||distanceKm===null||
      !Number.isFinite(distanceKm)||distanceKm > stage.radiusKm) return null;
  try {
    const travelMinutes=await roadEta(performer,pickup);
    if (travelMinutes===null||!Number.isFinite(travelMinutes)||travelMinutes<0) return null;
    const totalMinutes=Math.ceil(travelMinutes)+Math.max(0,Math.ceil(prepMinutes));
    if (totalMinutes>stage.maxRoadEtaMinutes) return null;
    return {travelMinutes:Math.ceil(travelMinutes),totalMinutes};
  }catch{return null}
}
