import {useState} from 'react';

export function validInnLength(value:string,personal:boolean) {
  return personal?/^[0-9]{12}$/.test(value):/^(?:[0-9]{10}|[0-9]{12})$/.test(value);
}

// Keep identifiers as text (leading zero is significant). Reject invalid
// pastes as a whole rather than silently truncating them to another number.
export function InnInput({value,onChange,personal=false,placeholder}:{
  value:string;onChange:(value:string)=>void;personal?:boolean;placeholder?:string;
}) {
  const [rejected,setRejected]=useState(false);
  const invalid=!!value&&!validInnLength(value,personal);
  const hint=personal?'ИНН физлица или ИП — ровно 12 цифр.':'ИНН организации — 10 цифр, физлица или ИП — 12 цифр.';
  return <>
    <input className="field" inputMode="numeric" type="text" maxLength={12}
      aria-label={personal?'ИНН физлица или ИП':'ИНН компании'}
      aria-invalid={invalid||rejected||undefined}
      placeholder={placeholder} value={value}
      onChange={e=>{
        const next=e.target.value;
        if(!/^[0-9]{0,12}$/.test(next)){setRejected(true);return;}
        setRejected(false);onChange(next);
      }}
      onPaste={e=>{
        const input=e.currentTarget, pasted=e.clipboardData.getData('text');
        const start=input.selectionStart??value.length,end=input.selectionEnd??start;
        const next=value.slice(0,start)+pasted+value.slice(end);
        if(!/^[0-9]{0,12}$/.test(next)){
          e.preventDefault();setRejected(true);
        }
      }}/>
    {(invalid||rejected)&&<span className="note" role="alert">{rejected?'Ввод не принят: только цифры, не более 12. ':''}{hint}</span>}
  </>;
}
