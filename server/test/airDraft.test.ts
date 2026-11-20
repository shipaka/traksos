import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AIR_DRAFT_TTL_MS,readAirDraft,writeAirDraft,clearAirDraft}
  from '../../web/src/screens/airDraft.ts';

class FakeStorage{
 private map=new Map<string,string>();
 getItem(key:string){return this.map.get(key)??null}
 setItem(key:string,value:string){this.map.set(key,value)}
 removeItem(key:string){this.map.delete(key)}
 count(){return this.map.size}
}

test('opt-in draft is separated by account and chat without storing received messages',()=>{
 const storage=new FakeStorage();
 const userA='A-1',userB='B-2';
 const direct='/api/community/direct/thread-one/messages';
 const room='/api/community/rooms/room-two/messages';
 const now=Date.UTC(2026,10,17,12);
 assert.deepEqual(readAirDraft(storage,userA,direct,now),
   {enabled:false,text:'',nonce:null},'saving is disabled by default');
 const nonce='123e4567-e89b-42d3-a456-426614174000';
 assert.equal(writeAirDraft(storage,userA,direct,'Найденная диагностическая заметка',
   now,nonce),true);
 assert.deepEqual(readAirDraft(storage,userA,direct,now+200),
   {enabled:true,text:'Найденная диагностическая заметка',nonce});
 assert.deepEqual(readAirDraft(storage,userB,direct,now+200),
   {enabled:false,text:'',nonce:null},'another account cannot restore this draft');
 assert.deepEqual(readAirDraft(storage,userA,room,now+200),
   {enabled:false,text:'',nonce:null},'another chat cannot restore this draft');
 assert.equal(storage.count(),1);
 clearAirDraft(storage,userA,direct);
 assert.equal(storage.count(),0);
});

test('draft expires, malformed data does not crash the chat and large text is rejected',()=>{
 const storage=new FakeStorage(),now=Date.UTC(2026,10,17,12);
 assert.equal(writeAirDraft(storage,'u','/room','x'.repeat(2001),now),false);
 assert.equal(storage.count(),0);
 assert.ok(writeAirDraft(storage,'u','/room','Переносится только несохранённый текст',now));
 assert.equal(readAirDraft(storage,'u','/room',now+AIR_DRAFT_TTL_MS).enabled,false);
 assert.equal(storage.count(),0);
 storage.setItem('tracksos:air:opt-in-draft:v1:u:/room','{broken');
 assert.equal(readAirDraft(storage,'u','/room',now).enabled,false);
 assert.equal(storage.count(),0);
});

test('draft storage exceptions do not prevent typing and optional persistence',()=>{
 const inaccessible={
  getItem:(_key:string):string|null=>{throw new Error('restricted')},
  setItem:(_key:string,_value:string):void=>{throw new Error('restricted')},
  removeItem:(_key:string):void=>{throw new Error('restricted')}
 };
 assert.equal(readAirDraft(inaccessible,'u','room').enabled,false);
 assert.equal(writeAirDraft(inaccessible,'u','room','text'),false);
 assert.doesNotThrow(()=>clearAirDraft(inaccessible,'u','room'));
});
