// Compatibility entry for the focused browser regression; production callers
// use the existing API module so first logout works even without a new chunk.
import {logoutSession as logout} from './api.ts';
import {native} from './native.ts';
export function logoutSession() {
  return logout(origin=>{void native.setSession(origin,null).catch(()=>{});});
}
