// Isolated reads for private account/order screens. Unlike the generic
// useLoad, a failed request cannot keep showing previously fetched private
// data, and a late response cannot cross user, order or filter boundaries.
import {useCallback,useEffect,useRef,useState} from 'react';
import {onEvent} from '../api.ts';

type ReadState<T>={key:string;data:T|null;error:string|null;loading:boolean};
export function usePrivateRead<T>(
  fetchCurrent:()=>Promise<T>,key:string,refreshOn?:(event:any)=>boolean
){
  const fetchRef=useRef(fetchCurrent);
  fetchRef.current=fetchCurrent;
  const eventRef=useRef(refreshOn);
  eventRef.current=refreshOn;
  const requestRef=useRef(0);
  const [snapshot,setSnapshot]=useState<ReadState<T>>({
    key,data:null,error:null,loading:true,
  });
  const reload=useCallback(async()=>{
    const serial=++requestRef.current;
    // Explicitly discard cached account/order values before every refresh.
    setSnapshot({key,data:null,error:null,loading:true});
    try{
      const data=await fetchRef.current();
      if(serial===requestRef.current)
        setSnapshot({key,data,error:null,loading:false});
    }catch(error){
      if(serial===requestRef.current)
        setSnapshot({key,data:null,error:error instanceof Error?error.message:'Ошибка загрузки',loading:false});
    }
  },[key]);

  useEffect(()=>{
    void reload();
    return ()=>{requestRef.current++;};
  },[reload]);
  useEffect(()=>{
    if(!refreshOn)return;
    return onEvent((e:any)=>{
      if(eventRef.current?.(e))void reload();
    });
  },[reload,Boolean(refreshOn)]); // eslint-disable-line react-hooks/exhaustive-deps

  // A changed key hides a previous account's response even before the effects
  // run, so no one-frame leak occurs during a React route/session switch.
  const view=snapshot.key===key?snapshot:null;
  return {data:view?.data??null,error:view?.error??null,loading:view?.loading??true,reload};
}
