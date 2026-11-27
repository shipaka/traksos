/**
 * #324: conservative, deterministic classification of a single service-specific
 * attempt or interest chain. Inputs must already be deduplicated and separated
 * by the collector. Never call this directly on a client event payload: only
 * server-side joins may populate verified evidence. No identifiers or PII.
 */
export type IntentStage = 'view'|'interest'|'search'|'probable_request'|'submitted'|'assigned'|'completed';
export type AvailabilityCause = 'no_registered'|'no_qualified'|'outside_area'|'offline'|'busy'|'no_response'|'filter_mismatch'|'network_error'|'api_error'|'unknown';
export type DemandTiming = 'urgent'|'scheduled'|'unknown';

export interface IntentEvidence {
  viewed?: boolean;
  clicked?: boolean;
  searchStarted?: boolean;
  cardOpened?: boolean;
  formStarted?: boolean;
  callAttempted?: boolean;
  // Explicit selection only. Never infer urgency from dwell time or page exit.
  timing?: DemandTiming;
  // Only produced by trusted backend joins. Client "success" is not evidence.
  verified?: {
    order?: 'submitted'|'assigned'|'completed'|'cancelled';
    searchResult?: {count:number;cause?:AvailabilityCause};
    attemptAvailability?: {cause:AvailabilityCause};
  };
  // Inactivity after the observation window, not a known reason for exit.
  inactiveAfterWindow?: boolean;
}

const shortageCauses = new Set<AvailabilityCause>(['no_registered','no_qualified','outside_area','offline','busy','no_response']);
export function classifyIntent(e:IntentEvidence) {
  const order=e.verified?.order;
  const result=e.verified?.searchResult;
  const validCount=typeof result?.count==='number' && Number.isSafeInteger(result.count) && result.count>=0;
  const zeroResults=validCount && result!.count===0;
  const searchObserved=!!e.searchStarted || validCount;
  const probableRequest=!!e.formStarted || !!e.callAttempted;
  const confirmedDemand=order==='submitted'||order==='assigned'||order==='completed'||order==='cancelled';
  const stage:IntentStage=order==='completed'?'completed':order==='assigned'?'assigned':
    confirmedDemand?'submitted':probableRequest?'probable_request':searchObserved?'search':
    e.clicked||e.cardOpened?'interest':'view';
  // A zero result is not a confirmed failed call. Only a real attempted call
  // plus a trusted contemporaneous availability observation can support it.
  const cause=e.callAttempted ? e.verified?.attemptAvailability?.cause : undefined;
  const verifiedUnservedAttempt=!!cause && shortageCauses.has(cause);
  const timing:DemandTiming=e.timing==='urgent'||e.timing==='scheduled'?e.timing:'unknown';
  return {
    stage, timing, confirmedDemand,
    cancelled:order==='cancelled',
    zeroResults,
    zeroResultCause:zeroResults?(result?.cause??'unknown'):null,
    verifiedUnservedAttempt,
    attemptCause:cause??null,
    inactiveAfterSearch:searchObserved && !!e.inactiveAfterWindow && !probableRequest && !confirmedDemand,
    // These are evidence levels, never claims about a person's private motives.
    hasObservedActivity:!!(e.viewed||e.clicked||e.cardOpened||searchObserved||probableRequest||confirmedDemand),
  };
}
