import assert from 'node:assert/strict';
import { geographicCenter, mustExpandCluster } from '../web/src/screens/partnerNetworkGeometry20261123.ts';

const at=(lat,lng)=>({lat,lng});
function angularDistance(a,b){
  const raw=Math.abs(a-b)%360;
  return Math.min(raw,360-raw);
}
const dateline=geographicCenter([at(65,179),at(65,-179)]);
assert.equal(dateline.lat,65);
assert.ok(angularDistance(dateline.lng,180)<.000001,
  'two Chukotka points must not send users to Greenwich');
const ordinary=geographicCenter([at(60,30),at(60,32)]);
assert.equal(ordinary.lng,31,'ordinary Russian longitude must average normally');
assert.equal(ordinary.lat,60);
const justOne=geographicCenter([at(59.9,30.3)]);
assert.ok(Math.abs(justOne.lng-30.3)<1e-9);
assert.throws(()=>geographicCenter([]),/empty/);

assert.equal(mustExpandCluster([at(60,31),at(60,31)],5,12),true,
  'identical approved workshops must open a chooser immediately');
assert.equal(mustExpandCluster([at(65,179),at(65,-181)],5,12),true,
  'longitude wrap does not make identical workshops seem separated');
assert.equal(mustExpandCluster([at(60,30),at(60,30.0005)],12,12),true,
  'max zoom must not allow an endless cluster zoom');
assert.equal(mustExpandCluster([at(60,30),at(60,30.0005)],3,12),false,
  'separate workshop positions must still permit regular zoom');
assert.equal(mustExpandCluster([at(60,30)],12,12),false,
  'a single workshop should open its own card');
console.log('Partner network geometry PASS: dateline, ordinary, co-located, max zoom, single');
