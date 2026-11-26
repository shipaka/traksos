// One-use address transfer, not a persisted order draft or GPS consent.
export type OrderPrefill = { address?: string; destination?: string };
const KEY = 'traksos.prefill';
export function clearOrderPrefill() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
export function readOrderPrefill(userId: string | undefined): OrderPrefill {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!userId || v?.userId !== userId || v.version !== 1) {
      clearOrderPrefill();
      return {};
    }
    return {
      address: typeof v.address === 'string' ? v.address : undefined,
      destination: typeof v.destination === 'string' ? v.destination : undefined,
    };
  } catch { clearOrderPrefill(); return {}; }
}
export function saveOrderPrefill(userId: string | undefined, value: OrderPrefill): boolean {
  if (!userId) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...value, version: 1, userId }));
    return true;
  } catch { return false; }
}
