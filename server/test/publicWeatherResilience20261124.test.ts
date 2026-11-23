import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeYandexCondition, parseYandexWeather, PublicWeatherService,
} from '../src/services/publicWeather.ts';

const observedAt = new Date('2026-11-24T09:00:00.000Z').getTime();
const weather = (at=observedAt,condition='cloudy',temp=-2)=>
  ({fact:{condition,temp,obs_time:Math.floor(at/1000)}});
const fetcher=(fn:(url:string,init:RequestInit)=>Promise<Response>):typeof fetch =>
  (async (url,init)=>fn(String(url),init!)) as typeof fetch;

test('Yandex feed: never invent sunny weather for unknown codes, stale/future or invalid observations',()=>{
  assert.deepEqual(normalizeYandexCondition('wet-snow'),
    {condition:'snow',description:'Мокрый снег'});
  assert.equal(normalizeYandexCondition('not-snowing'),null);
  assert.equal(normalizeYandexCondition('thunderstorm-with-unknown'),null);
  assert.equal(normalizeYandexCondition('sunny'),null);
  assert.equal(normalizeYandexCondition({condition:'clear'}),null);
  assert.equal(parseYandexWeather(weather(observedAt,'clear',-4),observedAt)?.condition,'clear');
  assert.equal(parseYandexWeather(weather(observedAt,'light-rain',0),observedAt)?.description,'Дождь');
  assert.equal(parseYandexWeather(weather(observedAt-4*3600_000),observedAt),null);
  assert.equal(parseYandexWeather(weather(observedAt+2*60_000),observedAt),null);
  assert.equal(parseYandexWeather(weather(observedAt,'unknown'),observedAt),null);
  assert.equal(parseYandexWeather(weather(observedAt,'clear',100),observedAt),null);
  assert.equal(parseYandexWeather(weather(observedAt,'clear',Number.NaN),observedAt),null);
  assert.equal(parseYandexWeather({fact:{condition:'clear',temp:10,obs_time:123.5}},observedAt),null);
  assert.equal(parseYandexWeather(weather(),Number.NaN),null);
  assert.equal(parseYandexWeather({},observedAt),null);
});

test('public weather is fixed to Saint Petersburg, 24 simultaneous callers share a fetch and a truthful 20-minute cache',
  {timeout:30000},async()=>{
  let now=observedAt;
  let calls=0;
  const provider=fetcher(async(url,init)=>{
    calls++;
    assert.equal(url,
      'https://api.weather.yandex.ru/v2/informers?lat=59.9343&lon=30.3351&lang=ru_RU');
    assert.equal((init.headers as Record<string,string>)['X-Yandex-Weather-Key'],'fixture-only');
    assert.ok(init.signal,'the provider request must have an AbortSignal');
    return new Response(JSON.stringify(weather(now)),{status:200});
  });
  const service=new PublicWeatherService('fixture-only',provider,()=>now);
  const simultaneous=await Promise.all(Array.from({length:24},()=>service.current()));
  assert.equal(calls,1,'single-flight cache prevents a request storm');
  assert.ok(simultaneous.every(item=>item?.condition==='cloudy'));
  assert.ok(simultaneous.every(item=>item?.location==='Санкт-Петербург'));
  assert.ok(simultaneous.every(item=>item?.source==='yandex'));
  now+=19*60_000;
  assert.equal((await service.current())?.condition,'cloudy');
  assert.equal(calls,1,'fresh cache is not re-requested');
  now+=61_000;
  assert.equal((await service.current())?.condition,'cloudy');
  assert.equal(calls,2,'cache is refreshed after actual expiry');
  assert.equal((await new PublicWeatherService(' ',provider,()=>now).current()),null);
  assert.equal(calls,2,'missing key never calls external provider');
});

test('vendor failures and oversized streams are negative-cached, bounded and never become invented current weather',
  {timeout:30000},async()=>{
  let now=observedAt;
  let calls=0;
  let cancelled=0;
  let mode:'error'|'oversize'|'success'='error';
  const provider=fetcher(async()=>{
    calls++;
    if(mode==='error')return new Response('failure',{status:503});
    if(mode==='oversize'){
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(20_000)));},
        cancel(){cancelled++;}
      }),{status:200});
    }
    return new Response(JSON.stringify(weather(now,'light-snow',-5)),{status:200});
  });
  const service=new PublicWeatherService('fixture-only',provider,()=>now);
  assert.equal(await service.current(),null);
  mode='success';
  now+=4*60_000;
  assert.equal(await service.current(),null);
  assert.equal(calls,1,'failure cached for five minutes without extra vendor spending');
  now+=61_000;
  assert.equal((await service.current())?.condition,'snow');
  assert.equal(calls,2);

  // Oversized body is rejected while streaming, before JSON parse or memory growth.
  mode='oversize';
  const fresh=new PublicWeatherService('fixture-only',provider,()=>now);
  assert.equal(await fresh.current(),null);
  assert.equal(cancelled,1,'oversized third-party weather stream is cancelled');
  assert.equal(await fresh.current(),null);
  assert.equal(calls,3,'bad upstream JSON is negatively cached');
});
