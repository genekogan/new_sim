import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {createEdenExpansionLandscape} from './landscape.mjs';
import {createExpansionBankEnrichment} from './bank-enrichment.mjs';
import {inWater,inNative,reserved} from './layout.mjs';
assert.equal(createExpansionBankEnrichment(null,[]),null);
const empty=createExpansionBankEnrichment(()=>null,[]);assert.equal(empty.inspection.kept.length,0);assert.equal(empty.group.children.length,0);empty.dispose();empty.dispose();
const owner=createEdenExpansionLandscape(true),inspection=owner.bankEnrichment,group=owner.group.children.find(g=>g.name==='Continuous NEW lake and river stone/grass/fern/wetland edge'),v=new THREE.Vector3(),matrix=new THREE.Matrix4();let vertices=0,wetHits=0,nativeHits=0,reserveHits=0,calls=0,triangles=0,minActualBase=Infinity,maxActualBase=-Infinity;
assert.ok(inspection.minBaseRelativeY>-.001&&inspection.maxBaseRelativeY<.001);
for(const type of['grass','fern','stone','wetland'])assert.ok(inspection.kept.some(p=>p.type===type));
group.updateMatrixWorld(true);group.traverse(m=>{if(!m.isMesh)return;calls++;triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*m.count;for(let k=0;k<m.count;k++){m.getMatrixAt(k,matrix);matrix.premultiply(m.matrixWorld);const p=m.geometry.attributes.position,minimum=Math.min(...Array.from({length:p.count},(_,n)=>p.getY(n)));for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(matrix);assert.ok(v.toArray().every(Number.isFinite));vertices++;
if(Math.abs(p.getY(j)-minimum)<1e-7&&!m.name.includes('leaf blades')&&!m.name.includes('leaves')){const bankY=owner.sampleVisibleBank(v.x,v.z);assert.ok(bankY!==null);minActualBase=Math.min(minActualBase,v.y-bankY);maxActualBase=Math.max(maxActualBase,v.y-bankY);}
if(inWater(v.x,v.z))wetHits++;if(inNative(v.x,v.z))nativeHits++;if(reserved(v.x,v.z,0))reserveHits++;}}});
assert.equal(wetHits+nativeHits+reserveHits,0);assert.ok(minActualBase>-.001&&maxActualBase<.001);assert.ok(calls<=10&&triangles<=100_000);
const record={groups:4,candidates:inspection.candidateCount,accepted:inspection.kept.length,types:Object.fromEntries(['grass','fern','stone','wetland'].map(t=>[t,inspection.kept.filter(p=>p.type===t).length])),calls,triangles,actualVerticesChecked:vertices,wetHits,nativeHits,reserveHits,minBaseRelativeY:inspection.minBaseRelativeY,maxBaseRelativeY:inspection.maxBaseRelativeY,minActualFloat32BaseRelativeY:minActualBase,maxActualFloat32BaseRelativeY:maxActualBase,rendered:false,sourceGeometryClones:0,scope:inspection.scope};
owner.dispose();owner.dispose();assert.equal(group.children.length,0);writeFileSync(new URL('./bank-enrichment-receipt.json',import.meta.url),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
