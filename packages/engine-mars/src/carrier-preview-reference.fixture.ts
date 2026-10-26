// Frozen previewCarrierV1 from 33326b047358a9be20fb626b41a3c3a31e704c8f, differential-test oracle only.
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import type {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import {clearanceAt} from '../../../mars/viewer/engine/spatial/grid.ts';
import {CATALOG,HUMAN_RADIUS} from '../../../mars/viewer/engine/world/catalog.ts';
import {listEntities} from '../../../mars/viewer/engine/world/entity-list.ts';
import {dcos,dsin} from '../../../mars/viewer/engine/core/math.ts';
import {previewPunt} from './punt.ts';

export function legacyPreviewCarrier(this:any,spec:CarrierInstallSpec):any{
    if(!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(String(spec?.id)))return {code:'carrier.bad-id',message:'carrier id must be a place-style id'};
    if(this.ents[spec.id])return this.ents[spec.id].carrier?null:{code:'carrier.id-taken',message:`${spec.id} already names another entity`};
    if(!Array.isArray(spec.at)||!spec.at.every(Number.isFinite))return {code:'carrier.bad-home',message:'at must be [x,z]'};
    const e=this.m.carrierEntity(spec,this.rt.tick);if('code' in e)return e;
    if(spec.def==='rowing-punt')return previewPunt(this.rt,spec,this.renderScene());
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const grid=spatial.levelAt(0,[spec.at[0],spec.at[1]]);
    const need=Math.hypot(0.75,0.6)+0.3;
    if(!grid||clearanceAt(grid,spec.at)<need)return {code:'carrier.home-blocked',message:'the carrier home is not clear level-0 ground'};
    for(const o of listEntities(this.ents) as any[])if(o.human&&Math.hypot(o.pose.p[0]-spec.at[0],o.pose.p[2]-spec.at[1])<2.5)return {code:'carrier.home-occupied',message:`${o.id} stands where the carrier would be`};
    const dp=e.pose,c=dcos(dp.yaw),sn=dsin(dp.yaw);
    const cd=CATALOG[spec.def]?.capabilities?.carrier!;for(const local of [cd.door,...cd.seats.map(x=>x.exit)]){const x=dp.p[0]+local[0]*c-local[1]*sn,z=dp.p[2]+local[0]*sn+local[1]*c;if(clearanceAt(grid,[x,z])<HUMAN_RADIUS+.3)return {code:'carrier.door-blocked',message:'the boarding step or exit spots are not clear ground'};}
    return null;
  }
