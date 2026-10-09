import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {PublicSoul} from '@sim/protocol';
import {SoulAvatar} from './MySouls.tsx';
import {WORLD_PLACES,REGION_PLACES_FOR_TOUR,INTERIOR_PLACES_FOR_TOUR,type WorldPlaceId} from './WorldPlaces.ts';
import './Explore.css';
import {exploreSoulRoster,type ExplorePresence} from './explore-data.ts';
/** Explore selects a camera view; it never moves or controls a Soul. */
export type EdenTourPlace=WorldPlaceId;
const locations=[...WORLD_PLACES,...INTERIOR_PLACES_FOR_TOUR,...REGION_PLACES_FOR_TOUR];
function PlacePicture({id,preview}:{id:WorldPlaceId;preview?:(id:WorldPlaceId)=>Promise<string|null>}){
 const host=useRef<HTMLSpanElement>(null),[image,setImage]=useState<string|null>(null);
 useEffect(()=>{const el=host.current;if(!el||!preview)return;let gone=false,started=false;
  const load=()=>{if(started)return;started=true;void preview(id).then(src=>{if(!gone)setImage(src);}).catch(()=>{});};
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}},{root:el.closest('.explore-scroll'),rootMargin:'80px'});observer.observe(el);
  return()=>{gone=true;observer.disconnect();};
 },[id,preview]);
 return <span ref={host} className="explore-picture" aria-hidden="true">{image?<img src={image} alt=""/>:<svg viewBox="0 0 64 48"><path d="M10 37V18l15-9 15 9v19M40 37V24l14-8v21M20 37V26h10v11" fill="none" stroke="currentColor" strokeWidth="2"/></svg>}</span>;
}
export function EdenTour({onView,souls=new Map(),present=new Set(),onSoul,preview,onOpen,presence=new Map(),room}:{onView:(place:EdenTourPlace)=>boolean;souls?:ReadonlyMap<string,PublicSoul>;present?:ReadonlySet<string>;onSoul?:(id:string)=>boolean;preview?:(id:WorldPlaceId)=>Promise<string|null>;onOpen?:()=>void;presence?:ReadonlyMap<string,ExplorePresence>;room?:{name:string;soulIds:readonly string[]}|null}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[unavailable,setUnavailable]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),openReader=useRef(onOpen);openReader.current=onOpen;
 const close=()=>{setOpen(false);setUnavailable('');};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='k'||e.altKey||e.shiftKey)return;if(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')&&!dialog.current?.open)return;e.preventDefault();setOpen(o=>!o);};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[]);
 useLayoutEffect(()=>{if(!open)return;const node=dialog.current,button=trigger.current;openReader.current?.();setQuery('');node?.showModal();search.current?.focus();const backdrop=(e:PointerEvent)=>{if(e.target!==node||!node)return;const b=node.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom){setOpen(false);setUnavailable('');}};node?.addEventListener('pointerdown',backdrop);return()=>{node?.removeEventListener('pointerdown',backdrop);node?.close();button?.focus();};},[open]);
 const shownLocations=useMemo(()=>locations.filter(p=>p.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[query]);
 const roster=exploreSoulRoster(souls,presence,query,room),shownSouls=roster.souls;
 return <span className="eden-tour explore-control"><button ref={trigger} type="button" className="explore-open" aria-haspopup="dialog" aria-expanded={open} title="Explore Eden (⌘K / Ctrl+K)" onClick={()=>setOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="m12.5 12.5 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg><span>Explore Eden</span><kbd>⌘K</kbd></button>
  {open&&<dialog ref={dialog} aria-modal="true" className="frosted-modal explore-modal" aria-labelledby="explore-title" onCancel={e=>{e.preventDefault();close();}}>
   <header className="explore-heading"><h2 id="explore-title">Explore Eden</h2><button type="button" aria-label="Close Explore" onClick={close}>×</button></header>
   <input ref={search} className="explore-search" type="search" aria-label="Search locations and Souls" placeholder="Find a location or Soul…" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="explore-scroll">
    {!!shownSouls.length&&<section aria-labelledby="explore-souls"><h3 id="explore-souls">Souls in Eden</h3>{room&&<p className="dim">{room.name}: {roster.inRoom.size} {roster.inRoom.size===1?'Soul':'Souls'} here</p>}<div className="explore-souls">{shownSouls.map(s=><button type="button" key={s.id} className={'explore-soul '+(presence.get(s.id)??'unknown')} onClick={()=>{if(present.has(s.id)&&onSoul?.(s.id))close();else setUnavailable(`${s.name} is away from this world.`);}}><SoulAvatar soul={s}/><span><b>{s.name}</b><small><i/>{presence.get(s.id)==='active'?'Active':presence.get(s.id)==='fading'?'Fading':presence.get(s.id)==='departed'?'Away':'Presence unknown'}{roster.inRoom.has(s.id)&&' · In this room'}</small></span></button>)}</div></section>}
    <section aria-labelledby="explore-locations"><h3 id="explore-locations">Locations</h3><div className="explore-locations">{shownLocations.map(p=><button type="button" key={p.id} onClick={()=>{if(onView(p.id))close();else setUnavailable('This view is unavailable right now.');}}><PlacePicture id={p.id} preview={preview}/><span>{p.label}</span></button>)}</div>{!shownLocations.length&&!shownSouls.length&&<p className="dim">No matching locations or Souls.</p>}</section>
   </div>{unavailable&&<p role="status" className="explore-note">{unavailable}</p>}
  </dialog>}
 </span>;
}
