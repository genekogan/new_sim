import { z } from 'zod';
import { stationEpochV1Schema } from './station-v1.ts';
import { stationRulesEraFactV1Schema,stationCommonsSourceV1Schema,initialStationPhysicalHeadV1,acceptStationPhysicalHeadV1 } from './station-era-v1.ts';
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const stationEraPageV1Schema=z.object({contract:z.literal('station-era-page/1'),worldId:z.string().min(1).max(128),
  station:stationEpochV1Schema,afterSeq:integer,sourceCutoff:z.object({seq:integer,tick:integer}).strict(),nextAfterSeq:integer.positive().nullable(),
  eras:z.array(z.object({fact:stationRulesEraFactV1Schema,source:stationCommonsSourceV1Schema}).strict()).max(64),
}).strict().superRefine((v,ctx)=>{
  const no=()=>ctx.addIssue({code:'custom',message:'station era page scope, cursor, predecessor or frontier differs'});
  if(v.worldId!==v.station.worldId||v.afterSeq>v.sourceCutoff.seq||v.sourceCutoff.tick<v.station.createdTick)no();
  let previous:typeof v.eras[number]|undefined;
  for(const entry of v.eras){const {fact,source}=entry,e=fact.payload;
    if(fact.seq<=v.afterSeq||source.seq<=v.afterSeq||fact.seq>v.sourceCutoff.seq||fact.tick>v.sourceCutoff.tick)no();
    try{acceptStationPhysicalHeadV1({contract:'station-physical-head/1',origin:initialStationPhysicalHeadV1(v.station).origin,
      rulesVersion:e.toRulesVersion,revision:e.revision,effectiveTick:e.effectiveTick,era:fact,source},v.station,
      {worldId:v.worldId,rulesVersion:e.toRulesVersion,dtSeconds:v.station.dtSeconds});}catch{no();}
    if(previous&&(source.seq<=previous.fact.seq||e.previousRevision!==previous.fact.payload.revision
      ||e.fromRulesVersion!==previous.fact.payload.toRulesVersion||fact.tick<previous.fact.tick))no();
    if(!previous&&v.afterSeq===0&&e.previousRevision!==0)no();
    previous=entry;
  }
  if(v.nextAfterSeq!==null&&(!previous||v.nextAfterSeq!==previous.fact.seq))no();
});
export type StationEraPageV1=z.infer<typeof stationEraPageV1Schema>;
