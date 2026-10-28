import test from 'node:test';
import assert from 'node:assert/strict';
import furniture from './furniture.json' with { type: 'json' };
import { CORE_KIT, coreRef } from '../core-kit.ts';
import { WorldModel } from '../model.ts';
import { applyBatch } from '../compile.ts';
import { PAINTING_EASEL_DEF } from './painting-easel.ts';

test('published core/easel@2 preserves frozen v1 and supplies a square media face plus bounded provenance state', () => {
  const old = furniture.find(d=>d.name==='core-easel')!;
  assert.deepEqual(CORE_KIT.find(d=>d.name==='core-easel'&&d.version===1), old);
  assert.equal(coreRef('easel'), 'core/easel@1', 'legacy defaults do not migrate placed easels');
  assert.equal(CORE_KIT.find(d=>d.name==='core-easel'&&d.version===2), PAINTING_EASEL_DEF);
  const m = new WorldModel({constants:{ground:'land'},seed:'painting-easel'});
  const v1 = m.defineDef(old as never,'core',0), v2 = m.defineDef(PAINTING_EASEL_DEF,'core',0);
  assert.notEqual(v1.hash,v2.hash); assert.equal(m.def(coreRef('easel',1))!.hash,v1.hash); assert.equal(m.def(coreRef('easel',2))!.hash,v2.hash);
  assert.equal(v1.state?.media,undefined); assert.equal(v2.state!.maker.type,'string');
  assert.ok(v2.make.kind==='gen');
  const faces = v2.make.args!.faces as {w:number;h:number;media:boolean;at:number[]}[];
  assert.equal(faces.length,1); assert.equal(faces[0].media,true); assert.equal(faces[0].w,faces[0].h); assert.ok(faces[0].at[2]>0.1925);
  const place = applyBatch(m,{ops:[{op:'place',def:coreRef('easel',2),name:'paintable',p:[0,0]}]},'god',1); assert.equal(place.result.accepted,true);
  const e = m.get('paintable')!; assert.deepEqual(e.state,{media:'',title:'',maker:''});
  assert.equal(applyBatch(m,{ops:[{op:'set',id:e.id,state:{media:'/art/one.png',title:'One',maker:'soul:s_ana:Ana'}}]},'engine',2,{trusted:true}).result.accepted,true);
});
