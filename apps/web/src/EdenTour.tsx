import {useState} from 'react';
/** IDs from World's framePlace seam. These are camera views, not native goals. */
const places=[['overview','All of Eden'],['commons','Commons'],['classroom','Classroom'],['presentation','Presentation screen'],['homes','Homes'],['homecourtyard','Courtyard home interior (visual preview)'],['library','Library'],['libraryroom','Library reading interior (visual preview)'],['market','Market'],['farm','Farm and gardens'],['forest','Forest'],['lake','Lake and river'],['bridge','River crossing'],['rural','Southern village'],['courtyard','Stone courtyard'],['fountain','Library fountain'],['dock','Lake pier'],['rooftops','Roof gardens'],['roofseating','Front roof table (visual preview)'],['lookout','Northern lookout'],['craft','Craft courtyard'],['performance','Outdoor performance'],['domequarter','Dome quarter'],['amphitheatre','Amphitheatre'],['observatory','Observatory'],['stonegarden','Stone garden gate'],['windmill','Windmill and greenhouse'],['bandstand','Bandstand'],['kiosks','Market kiosks'],['cabins','A-frame cabin and yurt'],['teahouse','Tea house'],['muralwall','Mural wall'],['towerhouse','Tower house']] as const;
import {REGION_PLACES_FOR_TOUR,INTERIOR_PLACES_FOR_TOUR,type RegionPlaceId,type InteriorPlaceId} from './WorldPlaces.ts';
export type EdenTourPlace=typeof places[number][0]|RegionPlaceId|InteriorPlaceId;
export function EdenTour({onView}:{onView(place:EdenTourPlace):boolean}){
 const [unavailable,setUnavailable]=useState(false);
 return <span className="eden-tour"><select aria-label="Explore Eden" defaultValue="" title="Camera view only; does not move a Soul." onChange={event=>{const v=event.target.value,place=places.find(p=>p[0]===v)?.[0]??REGION_PLACES_FOR_TOUR.find(r=>r.id===v)?.id??INTERIOR_PLACES_FOR_TOUR.find(r=>r.id===v)?.id;if(place)setUnavailable(!onView(place));}}>
  <option value="" disabled>Explore Eden…</option>{places.map(([id,label])=><option key={id} value={id}>{label}</option>)}
  {INTERIOR_PLACES_FOR_TOUR.length>0&&<optgroup label="Inside buildings (visual preview)">{INTERIOR_PLACES_FOR_TOUR.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>}
  {REGION_PLACES_FOR_TOUR.length>0&&<optgroup label="New regions (scenery)">{REGION_PLACES_FOR_TOUR.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>}
 </select>{unavailable&&<span role="status" className="small dim">This view is unavailable right now.</span>}</span>;
}
