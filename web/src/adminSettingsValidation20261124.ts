/** Strict client-side validation; server remains the source of truth.
 * The UI never silently clamps percentage settings or converts blank to zero.
 */
export type AdminSettingKind='rub'|'pct'|'num'|'text'|'bool'|'share';
type Result={ok:true;value:string|number|boolean}|{ok:false;error:string};

function decimal(input:unknown,integer:boolean):number|null {
  const raw=String(input??'').trim().replace(',','.');
  const pattern=integer?/^\d+$/:/^\d+(?:\.\d{1,2})?$/;
  if(!pattern.test(raw))return null;
  const number=Number(raw);
  return Number.isFinite(number)?number:null;
}
export function parseAdminSetting(kind:AdminSettingKind,input:unknown):Result {
  if(kind==='bool')return typeof input==='boolean'?{ok:true,value:input}:
    {ok:false,error:'Ожидалось подтверждённое логическое значение.'};
  if(kind==='text'){
    const value=String(input??'').trim();
    return value.length<=2000?{ok:true,value}:
      {ok:false,error:'Текст должен быть не длиннее 2000 символов.'};
  }
  if(kind==='rub')return typeof input==='number'&&Number.isSafeInteger(input)&&input>=0?
    {ok:true,value:input}:{ok:false,error:'Укажите корректную сумму в рублях и копейках.'};
  const number=decimal(input,kind==='num');
  if(number===null)return {ok:false,error:'Введите число без экспоненты, с допустимым количеством знаков.'};
  if(kind==='num')return Number.isSafeInteger(number)&&number>=0?
    {ok:true,value:number}:{ok:false,error:'Введите целое неотрицательное число.'};
  if(number<0||number>100)return {ok:false,error:'Процент должен быть от 0 до 100.'};
  return {ok:true,value:kind==='share'?number/100:number};
}
