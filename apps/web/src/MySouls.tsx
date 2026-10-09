import {useEffect,useState} from 'react';
import type {PublicSoul} from '@sim/protocol';
import {worldKey,worldPath} from './world-path.ts';
import {requestSoulConversations} from './dialogue-speaking.ts';
import {soulAvatars} from './SoulAvatars.ts';
import {soulAvatarImage} from './soul-avatar-source.ts';
const ID=/^[a-zA-Z0-9_-]{1,100}$/;
export function mineIds(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string'&&ID.test(id)))].slice(0,24):[];}
const key='sim.mine.'+worldKey;
function stored(){try{return mineIds(JSON.parse(localStorage.getItem(key)??'[]'));}catch{return [];}}
function fragmentMine(){try{return mineIds(new URLSearchParams(location.hash.slice(1)).get('mine')?.split(','));}catch{return [];}}
/** Pins identify a browser's favourites; they confer no ownership or control authority. */
export function useMySouls(){
 const [ids,setIds]=useState(()=>mineIds([...stored(),...fragmentMine()]));
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(ids));}catch{}},[ids]);
 useEffect(()=>{const read=()=>{const add=fragmentMine();if(!add.length)return;setIds(prev=>mineIds([...prev,...add]));history.replaceState(null,'',location.pathname+location.search+'#watch');};read();addEventListener('hashchange',read);return()=>removeEventListener('hashchange',read);},[]);
 return {ids,toggle:(id:string)=>setIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):mineIds([...prev,id]))};
}
export function SoulAvatar({soul}:{soul:PublicSoul}){
 const [failedPhoto,setFailedPhoto]=useState<string|null>(null);
 const [,refresh]=useState(0);useEffect(()=>{const change=()=>refresh(n=>n+1);soulAvatars.events.addEventListener('change',change);return()=>soulAvatars.events.removeEventListener('change',change);},[]);
 const image=soulAvatarImage(soul,worldPath,soulAvatars.images.get(soul.id),failedPhoto),source=soulAvatars.sources.get(soul.id);let hash=0;for(const c of soul.id)hash=(hash*31+c.charCodeAt(0))>>>0;
 return image?<img key={image.key} className="soul-avatar" src={image.src} data-avatar-source={image.kind} data-profile-photo-hash={image.hash} data-avatar-entity={image.kind==='generated'?source?.entityId:undefined} data-avatar-model={image.kind==='generated'?source?.model:undefined} data-avatar-body-root={image.kind==='generated'?source?.bodyRoot:undefined} onError={image.kind==='profile-photo'?()=>setFailedPhoto(image.key):undefined} alt=""/>:<span className="soul-avatar initials" style={{background:`hsl(${hash%360} 38% 46%)`}} aria-hidden="true">{soul.name.split(/\s+/).slice(0,2).map(n=>n[0]).join('')}</span>;
}
export function MySouls({ids,souls,select,present}:{ids:readonly string[];souls:ReadonlyMap<string,PublicSoul>;select:(id:string)=>void;present?:ReadonlySet<string>}){
 const pinned=ids.flatMap(id=>{const soul=souls.get(id);return soul?[soul]:[];});const gone=ids.length-pinned.length;
 if(!ids.length)return null;
 return <div className="my-souls" aria-label="Your account Souls"><span className="my-souls-label">Your Souls</span>{pinned.slice(0,3).map(soul=><button key={soul.id} className={present&&!present.has(soul.id)?'my-souls-away':undefined} onContextMenu={e=>{e.preventDefault();select(soul.id);requestSoulConversations(soul.id);}} title={`Watch ${soul.name} · right-click for conversations`} aria-label={`Watch ${soul.name}`} onClick={()=>select(soul.id)}><SoulAvatar soul={soul}/></button>)}{pinned.length>3&&<details className="my-souls-more"><summary>+{pinned.length-3}</summary><div>{pinned.slice(3).map(soul=><button key={soul.id} onClick={()=>select(soul.id)}>{soul.name}</button>)}</div></details>}{gone>0&&<span className="my-souls-gone" title="Pinned Souls absent from this world">{gone} away</span>}</div>;
}
