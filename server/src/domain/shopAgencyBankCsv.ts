import { bad, conflict } from '../http/router.ts';

type BankDirection = 'in' | 'out';
export type BankRow = {
  lineNo:number;transactionRef:string;occurredAt:string;
  direction:BankDirection;amount:number;note:string;
};

function strictInstant(v:string):string {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))
    throw bad('bank_bad_timestamp','В CSV нужен ISO-8601 с явным часовым поясом');
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v)!;
  const dateOnly=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  if(dateOnly.getUTCFullYear()!==+m[1]||dateOnly.getUTCMonth()+1!==+m[2]||
    dateOnly.getUTCDate()!==+m[3]||!Number.isFinite(Date.parse(v)))
    throw bad('bank_bad_timestamp','Дата банковской операции недействительна');
  return new Date(v).toISOString();
}
/** Strict semicolon format, single physical line per transaction.
 * Doubled quotes are permitted; newline inside a quoted field is forbidden.
 * Import is normalized by an operator; this parser does NOT recognize
 * arbitrary vendor bank statement schemas. */
function parseFields(line:string):string[] {
  const fields:string[]=[];
  let value='',quoted=false,closed=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(quoted){
      if(char==='"'&&line[i+1]==='"'){value+='"';i++;}
      else if(char==='"'){quoted=false;closed=true;}
      else value+=char;
    }else if(char===';'){fields.push(value);value='';closed=false;}
    else if(char==='"'&&!value&&!closed){quoted=true;}
    else if(char==='"'||closed)throw bad('bank_bad_csv','Неверное экранирование кавычек в CSV');
    else value+=char;
  }
  if(quoted)throw bad('bank_bad_csv','Многострочные значения CSV не поддерживаются');
  fields.push(value);
  return fields;
}
export function parseNormalizedBankCsv(csv:string):BankRow[] {
  if(typeof csv!=='string'||csv.length>450_000)
    throw bad('bank_bad_csv','Файл должен быть текстовым CSV до 450 КБ');
  if(csv.includes('\0')||csv.includes('\uFFFD')||csv.includes('\u2028'))
    throw bad('bank_bad_csv','Недопустимые символы CSV');
  const lines=csv.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  if(lines.at(-1)==='')lines.pop();
  if(!lines.length||lines[0]!=='transaction_ref;occurred_at;direction;amount_kopecks;note')
    throw bad('bank_bad_header',
      'Ожидаются колонки transaction_ref;occurred_at;direction;amount_kopecks;note');
  if(lines.length<2||lines.length>1001)
    throw bad('bank_bad_rows','Нужно от 1 до 1000 банковских строк');
  const used=new Set<string>();
  return lines.slice(1).map((raw,i)=>{
    const a=parseFields(raw);
    if(a.length!==5)throw bad('bank_bad_csv','В строке '+(i+2)+' требуется ровно 5 колонок');
    const [ref,at,dir,kop,note]=a.map(x=>x.trim());
    if(ref.length<2||ref.length>160||/[\x00-\x1f]/.test(ref))
      throw bad('bank_bad_reference','Некорректный банковский идентификатор, строка '+(i+2));
    if(used.has(ref))throw conflict('bank_duplicate_transaction','Повтор ID операции внутри CSV: '+ref);
    used.add(ref);
    if(dir!=='in'&&dir!=='out')
      throw bad('bank_bad_direction','Направление должно быть in или out, строка '+(i+2));
    if(!/^[1-9]\d{0,11}$/.test(kop)||!Number.isSafeInteger(Number(kop)))
      throw bad('bank_bad_amount','Нужна положительная сумма в копейках, строка '+(i+2));
    if(note.length>300||/[\x00-\x08\x0b-\x1f]/.test(note))
      throw bad('bank_bad_note','Описание слишком длинное или содержит управляющие символы');
    return {lineNo:i+2,transactionRef:ref,occurredAt:strictInstant(at),
      direction:dir,amount:Number(kop),note};
  });
}
