/** Creates a cryptographically random RFC 4122 v4 request key.
 * Android 10's old WebView baseline lacks crypto.randomUUID(), but has
 * crypto.getRandomValues(). Never use Math.random for order retry keys.
 */
type SecureRandom={getRandomValues(bytes:Uint8Array):Uint8Array};

export function newOrderRequestKey(random:SecureRandom=crypto):string{
  const bytes=new Uint8Array(16);
  random.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
