import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {parseBackdropHide,applyBackdropVisibility} from '../src/WorldBackdropVisibility.ts';
test('captured campus context-people exclusions hide only archive figures, preserving campus and separate actual Soul',()=>{
 const backdrop=new THREE.Group(),reference=new THREE.Group();reference.userData={kind:'context_person'};reference.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));backdrop.add(reference);
 const chiba=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());chiba.userData={assembly_id:'chiba'};backdrop.add(chiba);
 const actualSoul=new THREE.Group();actualSoul.userData={entityId:'h_actual',soulId:'s_actual'};const scene=new THREE.Group();scene.add(backdrop,actualSoul);
 assert.equal(applyBackdropVisibility(backdrop,parseBackdropHide({kind:['context_person','context_group','reference'],assembly:['people','reference-ground'],layer:['Aerial reference']})),1);assert.equal(reference.visible,false);assert.equal(chiba.visible,true);assert.equal(actualSoul.visible,true);
 assert.equal(applyBackdropVisibility(backdrop,undefined),0);assert.equal(parseBackdropHide({kind:[''] }),undefined);
 for(const mesh of [chiba,reference.children[0] as THREE.Mesh]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
});
