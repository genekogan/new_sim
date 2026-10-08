import {createServerClock} from './server-clock.mjs';
/** Public consumer of the existing Connection hooks. One retained clock per
 * Connection lifetime; no sockets, cue selection, audio startup or private data. */
export function createStationConnection({worldId,now=()=>performance.now(),onChange=()=>{},codec=null}){
  const clock=createServerClock({worldId});let session=null,view=null,error=null,disposed=false;
  let selectedContract='station-live/1',startBinding=null,acceptedV2=null,lastAnchorV2=null;
  const listeners=new Set();
  function estimate(){try{return session?clock.estimate(now()):null;}catch{return null;}}
  function snapshot(){return {session:session?{...session}:null,view:view?structuredClone(view):null,clock:estimate(),error};}
  function publish(kind){const event={kind,state:snapshot()};onChange(event);for(const listener of listeners)listener(event);}
  function clear(reason,kind='session'){clock.disconnect();session=null;view=null;selectedContract='station-live/1';startBinding=null;acceptedV2=null;lastAnchorV2=null;error=reason;publish(kind);}
  function matches(candidate){return !!session&&candidate?.generation===session.generation&&candidate.worldId===worldId&&candidate.epoch===session.epoch;}
  return Object.freeze({snapshot,estimate,
    contract(){return selectedContract;},
    physicalBinding(){return acceptedV2?.physical?{worldId,rulesVersion:acceptedV2.physical.rulesVersion,dtSeconds:acceptedV2.station.dtSeconds}:startBinding?{...startBinding}:null;},
    onWelcome(w){if(disposed||!session)return;
      const selected=w.stationContract===undefined?'station-live/1':w.stationContract;
      if(w.worldId!==worldId||!['station-live/1','station-live/2',null].includes(selected)||typeof w.rulesVersion!=='string'||!Number.isFinite(w.dt)||w.dt<=0){clear('World music negotiation is unavailable.','unavailable');return;}
      selectedContract=selected;startBinding={worldId,rulesVersion:w.rulesVersion,dtSeconds:w.dt};publish('welcome');
    },
    onStationV2(next,receipt){if(disposed)return;
      if(!next||!matches(receipt?.session)||selectedContract!=='station-live/2'||!startBinding||typeof codec?.acceptStationLiveProgressV2!=='function'){clear('A negotiated world music update is needed.','unavailable');return;}
      try{const accepted=codec.acceptStationLiveProgressV2(acceptedV2,next,startBinding,lastAnchorV2);acceptedV2=structuredClone(accepted);if(accepted.anchor)lastAnchorV2=structuredClone(accepted.anchor);view=structuredClone(accepted);error=null;publish('station');}
      catch{clear('World music needs a fresh session.','unavailable');}
    },
    onSession(next){if(disposed)return;if(!next){clear(null);return;}
      if(next.worldId!==worldId||typeof next.epoch!=='string'||!next.epoch){clear('World music session is unavailable.');return;}
      clock.connect({t:'welcome',worldId,epoch:next.epoch});session={...next};view=null;selectedContract='station-live/1';startBinding=null;acceptedV2=null;lastAnchorV2=null;error=null;publish('session');
    },
    onStation(next,receipt){if(disposed)return;if(!next||!matches(receipt?.session)||selectedContract!=='station-live/1'){view=null;error='A fresh world music update is needed.';publish('unavailable');return;}
      if(next.worldId!==worldId){view=null;error='World music scope differs.';publish('unavailable');return;}
      view=structuredClone(next);error=null;publish('station');
    },
    onPong(pong,receipt){if(disposed||receipt?.automatic||!matches(receipt?.session))return;
      let result;try{result=clock.accept(pong,receipt.receivedAtMs);}catch{view=null;error='World music clock measurement is unavailable.';publish('unavailable');return;}
      if(result.kind==='accepted'){error=null;publish('clock');}
      else if(result.kind==='expired'||result.kind==='discontinuity'){view=null;error='World music clock needs a fresh measurement.';publish('unavailable');}
    },
    probe(connection){if(disposed||!session)return null;
      try{const sent=connection.probe(at=>clock.begin(at));if(sent)return sent;
        clock.connect({t:'welcome',worldId,epoch:session.epoch});view=null;error='World music clock probe was not sent.';publish('unavailable');return null;
      }catch{return null;}
    },
    subscribe(listener){if(disposed)throw Error('Station connection disposed.');listeners.add(listener);return()=>listeners.delete(listener);},
    dispose(){if(disposed)return;clear(null);disposed=true;listeners.clear();},
  });
}
