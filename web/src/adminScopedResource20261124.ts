import {useEffect,useRef,useState} from 'react';
import {get} from './api.ts';

/**
 * Private admin GET: a response is valid only for the account/scope and
 * request generation that initiated it. Offline never keeps old account
 * data or grants old controls. Read retry is manual, writes never auto-retry.
 */
export function useAdminScopedResource<T>(path:string,scope:string,enabled:boolean) {
  const [sequence,setSequence]=useState(0);
  const [state,setState]=useState<{
    key:string;data:T|null;error:string;loading:boolean;
  }>({key:'',data:null,error:'',loading:true});
  const serial=useRef(0);
  const key=scope+'|'+path;
  const liveKey=useRef(key);
  liveKey.current=key;
  const reload=()=>setSequence(v=>v+1);
  useEffect(()=>{
    const current=++serial.current;
    const expected=key;
    setState({key:expected,data:null,error:'',loading:enabled});
    if(enabled) {
      get<T>(path).then(data=>{
        if(current!==serial.current||liveKey.current!==expected)return;
        if(data===null||data===undefined)
          throw new Error('Сервер вернул пустой ответ');
        setState({key:expected,data,error:'',loading:false});
      }).catch(e=>{
        if(current!==serial.current||liveKey.current!==expected)return;
        setState({key:expected,data:null,loading:false,
          error:e instanceof Error?e.message:'Ошибка получения данных'});
      });
    }
    return ()=>{serial.current++;};
  },[key,enabled,sequence]);
  const current=state.key===key&&enabled?state:null;
  return {
    data:current?.data??null,
    loading:current?.loading??enabled,
    error:current?.error??'',
    reload,
  };
}
