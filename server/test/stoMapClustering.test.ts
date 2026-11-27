import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterScreenPoints,fitRussiaView,mustExpandCluster,geographicCenter} from '../../web/src/screens/partnerNetworkGeometry20261123.ts';
import {directoryPoints,directDirectoryDial} from '../../web/src/screens/stoDirectoryPilot20261127.ts';

test('map clusters across grid boundaries and expands on zoom',()=>{
  const points=[{x:89,y:90,point:'a'},{x:91,y:91,point:'b'},{x:300,y:300,point:'c'}];
  const grouped=clusterScreenPoints(points,90);
  assert.deepEqual(grouped.map(g=>g.members),[['a','b'],['c']]);
  assert.equal(clusterScreenPoints(points.map(p=>({...p,x:p.x*64,y:p.y*64})),54).length,3);
});
test('dense federal overview counts each location exactly once',()=>{
  const points=Array.from({length:1500},(_,i)=>({x:i%50*8,y:Math.floor(i/50)*8,point:i}));
  const groups=clusterScreenPoints(points,90);
  assert.ok(groups.length<100);
  assert.equal(new Set(groups.flatMap(g=>g.members)).size,1500);
  assert.equal(groups.flatMap(g=>g.members).length,1500);
});
test('country fit is smaller on mobile; exact shared coordinates remain selectable',()=>{
  assert.ok(fitRussiaView(360,500).zoom<fitRussiaView(1000,650).zoom);
  const same=[{lat:60,lng:30},{lat:60,lng:30}];
  assert.equal(mustExpandCluster(same,4,18),true);
  assert.equal(mustExpandCluster([{lat:60,lng:179},{lat:60,lng:-179}],4,18),false);
  assert.ok(Math.abs(geographicCenter([{lat:60,lng:179},{lat:60,lng:-179}]).lng)>179);
});
test('directory entries stay unverified and direct dialing rejects other URI schemes',()=>{
  assert.equal(new Set(directoryPoints.map(p=>p.id)).size,directoryPoints.length);
  for(const p of directoryPoints){assert.equal(p.directory,true);assert.ok(p.id.startsWith('directory:'));assert.match(directDirectoryDial(p.phone)??'',/^tel:\+7\d{10}$/);}
  for(const invalid of ['javascript:alert(1)','+71234567890#','*100#','+71234567890;ext=1'])assert.equal(directDirectoryDial(invalid),undefined);
});
