import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchAddress,endpoint} from '../src/ops/geocodeSto.ts';
const row={id:'directory:test',revision:1,address:'Московская область, Клин, ул. Ленина, 15А'};
const building={osm_type:'way',osm_id:123456,category:'building',addresstype:'building',lat:'56.33',lon:'36.72',display_name:'15А, улица Ленина, Клин, Московская область, Россия',address:{house_number:'15А',road:'улица Ленина',town:'Клин',state:'Московская область',country_code:'ru'}};
test('strict building match retains original revision and provenance',()=>{
 const r=matchAddress(row,[building]);assert.equal(r.reason,'candidate_needs_review');
 assert.equal(r.result?.id,row.id);assert.equal(r.result?.revision,1);assert.equal(r.result?.lat,56.33);
 assert.equal(r.result?.source,'https://www.openstreetmap.org/way/123456');
});
test('rejects wrong address, approximate centre, wrong country and ambiguity',()=>{
 for(const p of [{...building,address:{...building.address,house_number:'15'}},{...building,address:{...building.address,road:'улица Мира'}},{...building,address:{...building.address,town:'Истра'}},{...building,address:{...building.address,state:'Тверская область'}},{...building,category:'place',addresstype:'city'},{...building,address:{...building.address,country_code:'by'}}])assert.equal(matchAddress(row,[p]).result,null);
 assert.equal(matchAddress(row,[building,{...building,osm_id:123457}]).reason,'ambiguous_building');
 assert.equal(matchAddress({...row,address:'Московская область, М10, 85 км'},[building]).reason,'complex_address');
});
test('only operator local geocoder is supported',()=>{
 assert.equal(endpoint('http://127.0.0.1:7070').href,'http://127.0.0.1:7070/search');
 for(const url of ['https://nominatim.openstreetmap.org','https://example.com','http://127.0.0.1.evil.test','http://user:pass@localhost:7070','http://localhost:7070?key=secret'])assert.throws(()=>endpoint(url));
});
