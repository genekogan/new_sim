import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadCampusFile} from '../campus/history-node.ts';
import {loadCampusYear} from '../campus/history.ts';
import {yearBuildScene} from '../campus/sequence.ts';

test('pre-build removes explicitly attached occupied descendants and retains every independent neighbor',()=>{
 const file=loadCampusFile(2022),{base}=loadCampusYear(2022,file);
 assert.equal(base.meta.assemblyParents?.['2022-cahuilla-kitchen-detail'],'east-house');
 const bytes=JSON.stringify(base),build=yearBuildScene(base,'east-house',[0,0],1000);
 const absent=new Set(['east-house','2022-cahuilla-kitchen-detail']);
 assert.ok(base.obstacles.some(o=>o.assembly==='2022-cahuilla-kitchen-detail'),'occupied source keeps photographed furniture');
 assert.deepEqual(build.obstacles,base.obstacles.filter(o=>!absent.has(o.assembly)),'no nearby building, vehicle or furnishings are implicitly removed');
 assert.equal(build.regions.some(r=>absent.has(r.id)),false);
 assert.equal(JSON.stringify(base),bytes,'protected occupied source remains untouched');
 // Source-era files have no declared hierarchy and retain their prior behavior.
 const legacy={...base,meta:{...base.meta,assemblyParents:undefined}};
 assert.deepEqual(yearBuildScene(legacy,'east-house',[0,0],1000).obstacles,base.obstacles.filter(o=>o.assembly!=='east-house'));
});

test('attached descendants are resolved transitively without removing unrelated hierarchy',()=>{
 const {base}=loadCampusYear(2022,loadCampusFile(2022));
 const nested={...base,meta:{...base.meta,assemblyParents:{'2022-cahuilla-kitchen-detail':'room','room':'east-house','2022-hqb-upper-detail':'west-house'}}};
 const build=yearBuildScene(nested,'east-house',[0,0],1000);
 assert.equal(build.obstacles.some(o=>o.assembly==='2022-cahuilla-kitchen-detail'),false);
 assert.ok(build.obstacles.some(o=>o.assembly==='2022-hqb-upper-detail'));
});
