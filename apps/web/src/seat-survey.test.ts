import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {findSeats,surveySeats,SEAT_NAME} from './WorldSeatSurvey.ts';
// W8 whole-map "sits on the ground" check: it must fail floating and buried seats and pass grounded ones.
const ground=()=>{const g=new THREE.PlaneGeometry(200,200);g.rotateX(-Math.PI/2);const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial());m.name='terrain';return m;};
const bench=(name:string,y:number,x=0)=>{const g=new THREE.Group();g.name=name;const seat=new THREE.Mesh(new THREE.BoxGeometry(1.6,.08,.4),new THREE.MeshBasicMaterial());seat.position.y=.45;
 const leg=new THREE.Mesh(new THREE.BoxGeometry(.08,.45,.08),new THREE.MeshBasicMaterial());leg.position.y=.225;g.add(seat,leg);g.position.set(x,y,0);return g;};
test('grounded, floating, buried and deck-standing seats are told apart; instanced seat rows per instance',()=>{
 const scene=new THREE.Scene(),floor=ground();scene.add(floor);
 const deck=new THREE.Mesh(new THREE.BoxGeometry(4,.2,4),new THREE.MeshBasicMaterial());deck.name='pier deck';deck.position.set(20,.9,0);scene.add(deck);
 scene.add(bench('park bench',0,0),bench('float bench',.4,5),bench('sunk chair',-.3,10),bench('deck bench',1,20));
 const row=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.5,.5),new THREE.MeshBasicMaterial(),2);row.name='street-props:bench (park benches)';
 row.setMatrixAt(0,new THREE.Matrix4().makeTranslation(40,.25,0));row.setMatrixAt(1,new THREE.Matrix4().makeTranslation(44,.75,0));scene.add(row);
 scene.updateMatrixWorld(true);
 const seats=findSeats(scene);assert.equal(seats.length,5);
 const r=surveySeats(seats,scene.children,(x,z)=>0);const v=Object.fromEntries(r.map(f=>[f.name,f.verdict]));
 assert.deepEqual(v,{'park bench':'ok','float bench':'floating','sunk chair':'buried','deck bench':'ok','street-props:bench (park benches) #0':'ok','street-props:bench (park benches) #1':'floating'});
});
test('seat names: underscores/digits count, vehicles and markers do not',()=>{
 for(const n of ['Bench_01','park_bench','eden-classroom-seat-02','Chair001','commons:bench','sofa'])assert.ok(SEAT_NAME.test(n),n);
 const s=new THREE.Scene(),car=new THREE.Group();car.name='car';const cs=new THREE.Group();cs.name='car seat';car.add(cs);s.add(car);
 const g=new THREE.Group();g.name='bench highlight';s.add(g);assert.equal(findSeats(s).length,0);
});
