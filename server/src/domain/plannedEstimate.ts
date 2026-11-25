import type {Settings} from './defaults.ts';
import {estimate,isNight,type Tier} from './pricing.ts';
import {assertRegionalTariff,CoverageError,type ServiceRegion} from './regionalCoverage.ts';
import {cappedPct} from './money.ts';
import {bad} from '../http/router.ts';

export type PlannedEstimateSite={regionId:ServiceRegion;zoneId:string;address:string;tier:Tier};
export type PlannedEstimateSnapshot=ReturnType<typeof plannedEstimate>;

/** Existing call-out tariff, evaluated at the proposed start rather than now.
 * Not a final quote: excludes work duration, parts, waiting and any negotiated
 * performer price. No payment method, contract, hold or reserve is enabled.
 */
export function plannedEstimate(all:Settings,service:string,start:Date,input:PlannedEstimateSite,personalFee:number|null){
  if(!input||typeof input.address!=='string'||input.address.trim().length>500||
    typeof input.zoneId!=='string'||!['eco','comfort','pro'].includes(input.tier))
    throw bad('bad_planned_estimate','Укажите место и тариф выезда');
  const site={regionId:input.regionId,zoneId:input.zoneId,address:input.address.trim(),tier:input.tier};
  try{assertRegionalTariff({service,...site},true)}
  catch(e){if(e instanceof CoverageError)throw bad(e.code,e.message);throw e}
  if(!all.pricing.zones.some(z=>z.id===site.zoneId))throw bad('bad_planned_estimate','Тарифная зона отсутствует');
  const tariff=estimate(all.pricing,{service,tier:site.tier,zoneId:site.zoneId,night:isNight(all.pricing,start),group:false});
  const feePct=personalFee??all.fees.clientFeePct;
  if(!Number.isFinite(feePct)||feePct<0||!Number.isSafeInteger(tariff.callOut)||tariff.callOut<0||
    (tariff.hour!==null&&(!Number.isSafeInteger(tariff.hour)||tariff.hour<0)))
    throw bad('bad_planned_estimate','Тариф недоступен');
  const clientFee=cappedPct(tariff.callOut,feePct);
  return {site,service,startsAt:start.toISOString(),currency:'RUB',unit:'kopecks',
    tariff,feePct,clientFee,callOutWithFee:tariff.callOut+clientFee,
    preliminary:true,includesWork:false,includesParts:false,financialConsent:false} as const;
}
