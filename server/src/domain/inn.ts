// INN is an identifier, not a number. A checksum proves only structural
// consistency, never registration, ownership or a verified taxpayer status.
const digit=(s:string,weights:readonly number[]) =>
  weights.reduce((sum,w,i)=>sum+Number(s[i])*w,0)%11%10;

export function validInn(value:string,personal=false):boolean {
  if(!/^(?:[0-9]{10}|[0-9]{12})$/.test(value)||/^0+$/.test(value))return false;
  if(value.length===10)
    return !personal&&digit(value,[2,4,10,3,5,9,4,6,8])===Number(value[9]);
  return digit(value,[7,2,4,10,3,5,9,4,6,8])===Number(value[10])
    &&digit(value,[3,7,2,4,10,3,5,9,4,6,8])===Number(value[11]);
}
