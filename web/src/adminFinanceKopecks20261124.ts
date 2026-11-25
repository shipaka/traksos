/** Exact, money-safe parsing for admin manual bank/partner ledger entries.
 * Never round a user-entered value to a different amount or accept exponents.
 * This function performs no API request and does not initiate a payment.
 */
export function parseAdminRubles(value:string):number|null {
  const normalized=value.replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  const match=/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if(!match)return null;
  const [rubles='0']=normalized.split('.');
  const cents=(match[1]??'').padEnd(2,'0');
  const number=BigInt(rubles)*100n+BigInt(cents||'0');
  if(number<=0n||number>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return Number(number);
}

/** Text of the exact positive kopeck amount used in a confirmation. */
export function displayAdminRubles(kopecks:number):string {
  if(!Number.isSafeInteger(kopecks)||kopecks<=0)return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.floor(kopecks/100))
    +','+String(kopecks%100).padStart(2,'0')+' ₽';
}
