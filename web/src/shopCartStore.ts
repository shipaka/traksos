/**
 * Local cart is private to one authenticated account on this device.
 * The historic "traksos.cart" key has no owner identity and must NEVER be
 * copied into a new user's cart after a logout/account switch.
 */
export type Cart = Record<string,number>;

const PREFIX = 'traksos.cart.user.';
const LEGACY_KEY = 'traksos.cart';
const MAX_LINES = 250;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const UNSAFE_KEYS = new Set(['__proto__','prototype','constructor']);

export const cartStorageKey = (userId:string|null|undefined) =>
  userId ? PREFIX + encodeURIComponent(userId) : null;

/** Do not let corrupt/manual localStorage JSON produce NaN, debt or 0-qty orders. */
export function normalizeCart(raw:unknown):Cart {
  const result:Cart = {};
  if(!raw || typeof raw !== 'object' || Array.isArray(raw))return result;
  let count=0;
  for(const [id,quantity] of Object.entries(raw)){
    if(count>=MAX_LINES)break;
    if(!ID_PATTERN.test(id)||UNSAFE_KEYS.has(id))continue;
    if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<=0)continue;
    result[id]=Math.min(99,quantity);
    count++;
  }
  return result;
}

export function readCartFor(userId:string|null|undefined):Cart {
  try{
    // Ambiguous legacy data cannot safely be attributed to the new session.
    localStorage.removeItem(LEGACY_KEY);
    const key=cartStorageKey(userId);
    if(!key)return {};
    const raw=localStorage.getItem(key);
    return raw?normalizeCart(JSON.parse(raw)):{};
  }catch{return {};}
}

export function writeCartFor(userId:string|null|undefined,cart:Cart):Cart {
  const safe=normalizeCart(cart);
  const key=cartStorageKey(userId);
  if(!key)return {};
  try{localStorage.setItem(key,JSON.stringify(safe))}catch{/* Private mode/quota: in-memory cart remains usable. */}
  return safe;
}
