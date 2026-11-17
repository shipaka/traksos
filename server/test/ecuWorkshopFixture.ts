import {ok,type T} from './helpers.ts';

/** Strict local-test station; no production account, SMS or outside coordinates. */
export async function publishedEcuWorkshop(t:T,phone:string){
  const admin=await t.login('+79990000001');
  const expert=await t.login(phone,'master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'ecu',name:'Проверенный тестовый специалист ЭБУ',
    specialties:['diag']
  },expert.token));
  ok(await t.api('POST','/api/admin/performers/'+expert.id+'/verify',
    {decision:'approved'},admin.token));
  ok(await t.api('PUT','/api/admin/ecu/stations/'+expert.id,{
    name:'Тестовая мастерская ЭБУ',address:'Санкт-Петербург, проверочная мастерская, 1',
    lat:59.94,lng:30.34,published:true,consentConfirmed:true,
    reason:'Синтетическая тестовая точка с согласованием для изолированного CI'
  },admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},expert.token));
  return expert;
}
