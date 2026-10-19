import {FixtureViews} from '../../../mars/viewer/app/engine-view/fixtures.ts';
import {createCachedLiveNativeSocial12Controller} from '../../../mars/viewer/app/engine-view/content/assets/native-social-kit-actual/social.ts';
import type {TakePeople} from '../../../mars/viewer/app/engine-view/take-replay.ts';
import type {Take} from '../../../mars/viewer/engine/take/types.ts';
import type {TakeFrame} from '../../../mars/viewer/engine/take/replay.ts';
import type {Entity} from '../../../mars/viewer/engine/world/types.ts';

// Private copies leave the socket replica and the original body/contact records mutable
// under their existing owners. The helper audits these frozen copies once per chunk.
function frozenCopy<T>(value:T):T {
  const copy=structuredClone(value);
  const freeze=(v:unknown)=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};
  freeze(copy);return copy;
}
/** The one TakePeople method this draw uses (LiveWorld may hold a WorldLightPeople there on a phone's new world). */
type FixtureDraw=Pick<TakePeople,'setFixtureDrawReplacement'>;
/** Optional draw selection only. Unknown sources retain all original fixtures. */
export class WorldNativeSocialDraw {
  private controller=createCachedLiveNativeSocial12Controller({fixtureViewsSHA256:'fb2b9a53d7672a59d3edcf69735f44d86339b0f9bf9917579a7788684bb13d1b',createViews:()=>new FixtureViews()});
  private publication:unknown;
  private publicationCopy:unknown;
  private take:Take|null=null;
  private records:Record<string,Entity>|null=null;
  private source: {publication:unknown;take:Take;records:Record<string,Entity>;epoch:object}|null=null;
  private closed=false;
  reset(people:FixtureDraw|null){
    people?.setFixtureDrawReplacement(null);
    this.publication=undefined;this.publicationCopy=undefined;this.take=null;this.records=null;this.source=null;
    this.controller?.reset();
  }
  update(people:FixtureDraw,publication:unknown,take:Take,records:Record<string,Entity>,frame:TakeFrame,enabled=true){
    if(!enabled){if(this.publication!==undefined)this.reset(people);people.setFixtureDrawReplacement(null);return;}
    if(this.closed||!this.controller){people.setFixtureDrawReplacement(null);return;}
    try{
      if(publication!==this.publication||take!==this.take||records!==this.records){
        // Audit a new chunk synchronously while retaining the existing parent/mask.
        // This lets the controller validate the actual world transform before reuse.
        if(publication!==this.publication)this.reset(people);
        else this.source=null;
        this.publication=publication;this.take=take;this.records=records;
        if(publication){
          this.publicationCopy??=frozenCopy(publication);
          const source={publication:this.publicationCopy,take:frozenCopy(take),records:frozenCopy(records),epoch:Object.freeze({})};
          if(this.controller.bind(source.publication,source.take,source.records,frame,source.epoch).eligible)this.source=source;
        }
      }
      const source=this.source;
      if(!source){people.setFixtureDrawReplacement(null);return;}
      const decision=this.controller.update(source.epoch,source.publication,source.take,frame,source.records);
      people.setFixtureDrawReplacement(decision.group,decision.suppressOriginalDrawIds);
      if(decision.status==='direct-original')this.source=null;
    }catch{
      people.setFixtureDrawReplacement(null);this.source=null;
      try{this.controller.reset();}catch{/* Original fixture drawings are already restored. */}
    }
  }
  dispose(people:FixtureDraw|null){if(this.closed)return;this.closed=true;try{this.reset(people);}finally{this.controller?.dispose();}}
}
