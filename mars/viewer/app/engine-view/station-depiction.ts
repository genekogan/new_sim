// Renderer consumer only. The injected Core codecs remain the wire authority.
export type DepictionBeat = Readonly<{ cueId:string; beat:number }>;
type Scope = Readonly<{worldId:string;epoch:string;rulesVersion:string;dtSeconds:number}>;
type Cue = Scope & {cueId:string;sequence:number};
type Anchor = Scope & {revision:number;sourceTick:number;cueId:string|null;paused:boolean;clockRate:number;availability:string};
type Live = {worldId:string;station:Scope|null;cue:Cue|null;anchor:Anchor|null;fresh:boolean};
type History = {worldId:string;epoch:string;rulesVersion:string;tick:number;cue:Cue|null;phase:{beat:number}|null};
/** Structural consumer types, not a second parser or a released protocol. */
export type StationDepictionCodecs = {
  live:{parse(raw:unknown):Live}; history:{parse(raw:unknown):History};
  phase(cue:unknown,tick:number):{beat:number}|null;
};
const matching=(a:Scope,b:Scope)=>a.worldId===b.worldId&&a.epoch===b.epoch&&a.rulesVersion===b.rulesVersion&&a.dtSeconds===b.dtSeconds;
const validTick=(tick:number)=>Number.isFinite(tick)&&tick>=0&&tick<=Number.MAX_SAFE_INTEGER;
const beat=(cue:Cue,p:{beat:number}|null):DepictionBeat|null=>p&&Number.isFinite(p.beat)&&p.beat>=0&&p.beat<128
  ? Object.freeze({cueId:cue.cueId,beat:p.beat}):null;

/** Bind one depicted world/history to the recorded station epoch explicitly.
 * Live music is sampled at the body tick, never a predicted wall-clock tick.
 * Recreate on a different epoch; there is no station reset or selection here. */
export function createStationDepiction(binding:Scope,codecs:StationDepictionCodecs){
  const scope={...binding};let current:Live|null=null,lastRevision=0,lastSourceTick=-1,lastCueSequence=0,lastCueId:string|null=null;
  if(!scope.worldId||!scope.epoch||!scope.rulesVersion||!Number.isFinite(scope.dtSeconds)||scope.dtSeconds<=0)throw Error('Invalid depiction binding');
  return {
    acceptLive(raw:unknown):boolean{
      let view:Live;try{view=codecs.live.parse(raw);}catch{return false;}
      if(view.worldId!==scope.worldId||!view.station||!matching(scope,view.station)
        ||view.cue&&!matching(scope,view.cue)||view.anchor&&!matching(scope,view.anchor))return false;
      if((view.cue?.sequence??0)<lastCueSequence||view.cue?.sequence===lastCueSequence&&view.cue.cueId!==lastCueId)return false;
      if(view.anchor){
        // Reconnect/pause can invalidate an otherwise identical recorded
        // anchor. This only stops depiction; resuming requires a newer anchor.
        if(current?.anchor&&view.fresh===false&&view.cue?.cueId===current.cue?.cueId
          &&JSON.stringify(view.anchor)===JSON.stringify(current.anchor)){
          current=structuredClone(view);return true;
        }
        if(view.anchor.revision<=lastRevision||view.anchor.sourceTick<lastSourceTick)return false;
        lastRevision=view.anchor.revision;lastSourceTick=view.anchor.sourceTick;
      }else if(current?.anchor){
        // A cue transition without its new anchor is an explicit unavailable
        // view. An older same-cue null-anchor view cannot erase current input.
        if(view.cue?.cueId===current.cue?.cueId)return false;
      }
      if(view.cue){lastCueSequence=view.cue.sequence;lastCueId=view.cue.cueId;}
      current=structuredClone(view);return true;
    },
    liveAtTick(tick:number):DepictionBeat|null{
      if(!validTick(tick)||!current?.station||!current.cue||!current.anchor||!current.fresh)return null;
      const a=current.anchor;
      if(a.paused||a.clockRate!==1||a.availability!=='supported'||a.cueId!==current.cue.cueId)return null;
      return beat(current.cue,codecs.phase(current.cue,tick));
    },
    historyAtTick(raw:unknown,tick:number):DepictionBeat|null{
      if(!validTick(tick))return null;
      let view:History;try{view=codecs.history.parse(raw);}catch{return null;}
      if(view.tick!==tick||view.worldId!==scope.worldId||view.epoch!==scope.epoch||view.rulesVersion!==scope.rulesVersion
        ||!view.cue||!matching(scope,view.cue))return null;
      return beat(view.cue,view.phase);
    },
    clearLive(){current=null;},
  };
}
