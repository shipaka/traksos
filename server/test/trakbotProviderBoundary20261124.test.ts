import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeLocalLlmUrl, providerReady, makeLlmRequest,
  decodeLlmAnswer, requestGeneratedText,
} from '../src/services/trakbotProvider.ts';

const settings = { enabled:true, apiKey:'test-not-real', model:'mock-provider', transport:'api' as const };
const body = { output:[{content:[{type:'output_text',text:'Обратитесь к мастеру для проверки датчика.'}]}] };

test('model adapter sends only to trusted endpoint and defaults to no saved provider state',()=>{
  const request=makeLlmRequest('Не давай выдуманных цен','Что проверить?',900,settings);
  assert.ok(request);
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  const payload=JSON.parse(String(request.init.body));
  assert.equal(payload.store,false);
  assert.equal(payload.max_output_tokens,900);
  assert.equal(payload.instructions,'Не давай выдуманных цен');
  for(const url of [
    'http://169.254.169.254:8000/v1/chat/completions',
    'http://8.8.8.8:8000/v1/chat/completions',
    'http://user:pass@127.0.0.1:8000/v1/chat/completions',
    'http://localhost:8000/v1/other',
    'http://127.0.0.1:8000/v1/chat/completions?x=1',
    'https://127.0.0.1:8000/v1/chat/completions',
  ]) assert.equal(safeLocalLlmUrl(url),null,'not a trusted private LLM URL: '+url);
  assert.equal(providerReady({...settings,transport:'local',localUrl:'http://169.254.169.254:8000/v1/chat/completions'}),false);
  assert.equal(providerReady({...settings,enabled:false}),false);
});

test('streaming LLM result is bounded by bytes despite absent or forged Content-Length',
  {timeout:30000},async()=>{
  const old=globalThis.fetch;
  try{
    let cancelled=0;
    let emitted=0;
    globalThis.fetch=(async (_url:unknown,init?:RequestInit)=>{
      assert.ok(init?.signal);
      const source=new ReadableStream<Uint8Array>({
        pull(c){
          emitted++;
          c.enqueue(new TextEncoder().encode('x'.repeat(10_000)));
        },
        cancel(){cancelled++;}
      });
      return new Response(source,{status:200});
    }) as typeof fetch;
    assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),null);
    assert.ok(emitted<=5,'large body should stop before unbounded provider stream');
    assert.equal(cancelled,1,'oversized stream is cancelled');

    globalThis.fetch=(async()=>new Response(JSON.stringify(body),{
      status:200,headers:{'content-length':'9999999999'},
    })) as typeof fetch;
    assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),null,
      'a declared oversize body is rejected before reading');

    globalThis.fetch=(async()=>new Response(new Uint8Array([0xff,0xfe]),{
      status:200,
    })) as typeof fetch;
    assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),null,
      'invalid UTF-8 must never enter a customer-facing answer');
  }finally{globalThis.fetch=old;}
});

test('valid provider output stays readable, malformed JSON and non-text content never leak',
  {timeout:30000},async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=(async()=>new Response(JSON.stringify(body),{status:200})) as typeof fetch;
    assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),
      'Обратитесь к мастеру для проверки датчика.');
    assert.equal(decodeLlmAnswer({output:'not an array'},'api'),'');
    assert.equal(decodeLlmAnswer({output:[{content:'not an array'}]},'api'),'');
    assert.equal(decodeLlmAnswer({output:[{content:[{type:'output_text',text:{secret:'no'}}]}]},'api'),'');
    assert.equal(decodeLlmAnswer({choices:[{message:{content:{secret:'hidden'}}}]},'local'),'');
    assert.equal(decodeLlmAnswer({choices:[{message:{content:'Надёжный ответ'}}]},'local'),'Надёжный ответ');

    globalThis.fetch=(async()=>new Response('not json',{status:200})) as typeof fetch;
    assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),null);
    globalThis.fetch=(async()=>new Response(JSON.stringify(body),{status:502})) as typeof fetch;
    assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),null);
  }finally{globalThis.fetch=old;}
});

test('LLM transport refuses redirects and cancels rejected bodies before reading', async()=>{
  const old=globalThis.fetch;
  const local={...settings,transport:'local' as const,localUrl:'http://127.0.0.1:8000/v1/chat/completions'};
  try{
    for(const cfg of [settings,local]){
      assert.equal(makeLlmRequest('safe','private input',256,cfg)?.init.redirect,'error');
      let calls=0;
      globalThis.fetch=(async (_url:unknown,init?:RequestInit)=>{
        calls++;
        assert.equal(init?.redirect,'error');
        throw new TypeError('redirect blocked');
      }) as typeof fetch;
      assert.equal(await requestGeneratedText('safe','private input',256,2500,cfg),null);
      assert.equal(calls,1);
    }
    for(const [status,headers] of [[503,{}],[200,{'content-length':'32769'}]] as [number,Record<string,string>][]){
      let cancelled=0;
      globalThis.fetch=(async()=>new Response(new ReadableStream<Uint8Array>({
        cancel(){cancelled++;}
      }),{status,headers})) as typeof fetch;
      assert.equal(await requestGeneratedText('safe','hello',256,2500,settings),null);
      assert.equal(cancelled,1);
    }
    assert.equal(decodeLlmAnswer({choices:{0:{message:{content:'invalid'}}}},'local'),'');
  }finally{globalThis.fetch=old;}
});
