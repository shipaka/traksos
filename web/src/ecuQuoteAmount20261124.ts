/** Exact decimal ruble input for ECU diagnosis price. No exponent, sign,
 * fractional kopeck rounding or implicit acceptance of empty input.
 * Server contract: integer kopecks between 100 and 100,000,000.
 */
export function ecuDiagnosisKopecks(input:string):number|null{
  const clean=input.trim();
  if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(clean))return null;
  const [rub,kopecks='']=clean.replace(',','.').split('.');
  const total=Number(rub)*100+Number(kopecks.padEnd(2,'0'));
  return Number.isSafeInteger(total)&&total>=100&&total<=100_000_000?total:null;
}
