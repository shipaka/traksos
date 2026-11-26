/** Pure reporting only. Inputs must be scoped to a single performer by the caller.
 * Presence intervals must have explicit bounded evidence, not an open status or GPS.
 * Supply the first dispatch (including before the window) or full retry history per order.
 * Completion is the outcome as of the report clock, not a completion-date cohort.
 */
export type PartnerOffer = {orderId:string; sentAtMs:number; completedAsOf:boolean};
export type PartnerPresence = {startMs:number; endMs:number};
const DAY=86400000, WEEK=7*DAY, HOUR=3600000;
function weekStart(ms:number):number {
  const d=new Date(ms);
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-((d.getUTCDay()+6)%7));
}
function dayKey(ms:number):string { return new Date(ms).toISOString().slice(0,10); }
export function partnerActivityReport(input:{
  nowMs:number;
  offers:readonly PartnerOffer[];
  boundedPresence:readonly PartnerPresence[];
  observedSinceMs:number|null;
}) {
  const end=input.nowMs;
  if(!Number.isFinite(end)||!Number.isFinite(new Date(end).getTime()))throw new RangeError('Invalid report clock');
  const begin=end-90*DAY;
  const weeks=new Map<number,{weekStart:string;personallyOffered:number;completedFromOffers:number;offersWhileObservedAvailable:number;observedAvailableMs:number}>();
  for(let w=weekStart(begin);w<end;w+=WEEK)
    weeks.set(w,{weekStart:dayKey(w),personallyOffered:0,completedFromOffers:0,offersWhileObservedAvailable:0,observedAvailableMs:0});
  // Clip and union overlapping intervals so overlapping evidence cannot inflate hours.
  const intervals=input.boundedPresence
    .filter(p=>Number.isFinite(p.startMs)&&Number.isFinite(p.endMs)&&p.endMs>p.startMs&&p.endMs<=end)
    .map(p=>({startMs:Math.max(begin,p.startMs),endMs:p.endMs}))
    .filter(p=>p.endMs>p.startMs)
    .sort((a,b)=>a.startMs-b.startMs);
  const merged:PartnerPresence[]=[];
  for(const p of intervals){
    const last=merged[merged.length-1];
    if(last&&p.startMs<=last.endMs)last.endMs=Math.max(last.endMs,p.endMs);
    else merged.push({...p});
  }
  for(const p of merged){
    for(let t=p.startMs;t<p.endMs;){
      const w=weekStart(t), stop=Math.min(w+WEEK,p.endMs);
      weeks.get(w)!.observedAvailableMs+=stop-t;
      t=stop;
    }
  }
  const first=new Map<string,PartnerOffer>();
  for(const o of input.offers){
    if(!o.orderId||!Number.isFinite(o.sentAtMs)||o.sentAtMs>=end)continue;
    const old=first.get(o.orderId);
    if(!old)first.set(o.orderId,{...o});
    else first.set(o.orderId,{orderId:o.orderId,sentAtMs:Math.min(old.sentAtMs,o.sentAtMs),completedAsOf:old.completedAsOf||o.completedAsOf});
  }
  const distinct=[...first.values()].filter(o=>o.sentAtMs>=begin).sort((a,b)=>a.sentAtMs-b.sentAtMs);
  let index=0;
  for(const o of distinct){
    const row=weeks.get(weekStart(o.sentAtMs))!;
    row.personallyOffered++;
    if(o.completedAsOf)row.completedFromOffers++;
    while(index<merged.length&&merged[index].endMs<=o.sentAtMs)index++;
    if(index<merged.length&&merged[index].startMs<=o.sentAtMs)row.offersWhileObservedAvailable++;
  }
  const rows=[...weeks.values()];
  const total=rows.reduce((s,w)=>({
    personallyOffered:s.personallyOffered+w.personallyOffered,
    completedFromOffers:s.completedFromOffers+w.completedFromOffers,
    offersWhileObservedAvailable:s.offersWhileObservedAvailable+w.offersWhileObservedAvailable,
    observedAvailableMs:s.observedAvailableMs+w.observedAvailableMs,
  }),{personallyOffered:0,completedFromOffers:0,offersWhileObservedAvailable:0,observedAvailableMs:0});
  const firstObserved=input.observedSinceMs;
  return {
    windowDays:90,windowStart:new Date(begin).toISOString(),windowEnd:new Date(end).toISOString(),
    weekTimezone:'UTC' as const,
    partialHistory:firstObserved===null||!Number.isFinite(firstObserved)||firstObserved>begin,
    weeks:rows.map(w=>({...w,observedAvailableHours:w.observedAvailableMs/HOUR})),
    total:{...total,observedAvailableHours:total.observedAvailableMs/HOUR},
    // Presence coverage is not proof of continuous availability or comparable demand.
    availabilityCaveat:'Только ограниченные подтверждённые интервалы. Не GPS и не доказательство физического присутствия.',
    comparisonCaveat:'Личный отчёт, не сравнение с другими исполнителями. Недостаток данных не является отказом от работы.',
    changesLevel:false,changesDispatch:false,changesCommission:false,
  };
}
