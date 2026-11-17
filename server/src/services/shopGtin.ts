/** GS1 modulo-10 check digit. This confirms syntax only, never supplier identity. */
export function normalizeGtin(value:string){
  const gtin=value.trim();
  if(!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(gtin))return null;
  const body=gtin.slice(0,-1);
  let sum=0;
  for(let i=body.length-1,multiplier=3;i>=0;i--,multiplier=multiplier===3?1:3)
    sum+=Number(body[i])*multiplier;
  const digit=(10-(sum%10))%10;
  return digit===Number(gtin.at(-1))?gtin:null;
}
/** A HID scanner behaves like a keyboard: it does not prove a device was attached. */
export const traceInputIsHardwareAttested=false;
