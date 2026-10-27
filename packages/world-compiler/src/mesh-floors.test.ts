import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldModel, coreLibrary} from './index.ts';
import {meshFloors,meshFloorLinks} from './mesh-floors.ts';
import overlays from './mesh-floor-overlays.json' with {type:'json'};

test('content-addressed floor supplements survive pinned-definition reloads and respect authored overrides', () => {
  const w = new WorldModel({constants:{extent:1000,ground:'land'},seed:'mesh-floors'}); w.library=coreLibrary();
  assert.equal(Object.keys(overlays.assets).length,9,'current, legacy and fidelity shipped meshes');
  for (const [hash, entry] of Object.entries(overlays.assets)) {
    const base=w.def(`${entry.name}@${entry.name.endsWith('west-racks')?1:2}`)!; assert.ok(base,entry.name);
    assert.equal(base.make.kind,'mesh');
    // An existing pinned revision may retain an old asset hash. The asset content,
    // not the catalogue's currently recommended revision, selects its supplement.
    const pinned=w.defineDef({...base,make:{...base.make,asset:hash},size:{...base.size,box:entry.box as [number,number,number]}},'fixture',0);
    const floors=w.bake(pinned,{},0).surfaces?.filter(s=>s.tag?.startsWith('mesh-floor:')) ?? [];
    assert.ok(floors.length>0,`${entry.name} ${hash.slice(0,8)} has supports`);
    assert.ok(floors.every(s=>s.y>=0&&(s.y<=.45||entry.name==='core-mars-chiba'&&s.y<=3.27)));
    const reload=WorldModel.fromSnapshot(w.snapshot());
    assert.deepEqual(reload.bake(reload.def(pinned.ref)!,{},0).surfaces,w.bake(pinned,{},0).surfaces);
    const links=w.bake(pinned,{},0).links??[];
    assert.deepEqual(reload.bake(reload.def(pinned.ref)!,{},0).links,links.length?links:undefined);
    if(links.length)assert.deepEqual(meshFloorLinks(hash,entry.box,[links[0]]),[],'authored circulation wins');
    const first=floors[0], authored={...first,tag:'authored-floor'};
    assert.equal(meshFloors(hash,entry.box,[authored]).some(s=>Math.abs(s.y-first.y)<.02),false);
    assert.deepEqual(meshFloors(hash,entry.box.map(v=>v*2)),[],'a different mesh fit requires extraction of its own');
  }
});


test('the live fidelity Chiba variant has exactly the extracted core geometry', () => {
  const assets=overlays.assets as Record<string,{geometryHash:string;surfaces:unknown}>;
  const core=assets['4b5e4508f40b98c7d30c5d7c4a45564bf09541032122104eef6c60ca209057be'];
  const live=assets['99d5c2f524280ef10ca5ef88e9095434ff30a177d42bc67ff5e8d451836e89af'];
  assert.equal(live.geometryHash,core.geometryHash);assert.deepEqual(live.surfaces,core.surfaces);
});

test('compact runtime data reconstructs every extracted surface and link exactly', () => {
  for(const [hash,entry] of Object.entries(overlays.assets)) {
    assert.deepEqual(meshFloors(hash,entry.box),entry.surfaces,hash);
    assert.deepEqual(meshFloorLinks(hash,entry.box),'links' in entry?entry.links:[],hash);
  }
});
