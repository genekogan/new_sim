/** DLG3 head pop-ups: who is speaking right now, published by the dialogue dock (which owns threads and
 * their colours) and painted by LiveWorld inside each Soul's name tag. A fresh line from a nearby, on-screen
 * speaker shows for a few seconds as a compact pop-up in the tag (above the head, so it moves with the tag and
 * the label packing keeps pop-ups apart); afterwards, or for distant speakers, only a small dot remains.
 * Clicking the pop-up or the dot opens that conversation in the dock. */
export type Speaking={colour:string;since:number;thread:string;
 /** The line itself (DLG3 pop-up); absent for older publishers. */
 text?:string;private?:boolean;key?:string};
/** soulId → latest spoken line, `since` on the performance.now() clock. */
export const speakingNow=new Map<string,Speaking>();
/** Dot stays this long after a line; pulses for the first PULSE_MS. */
export const SPEAKING_SHOW_MS=15_000;
export const SPEAKING_PULSE_MS=3_500;
/** Speakers farther from the camera than this get no pop-up (the dot and the thread only). */
export const POPUP_NEAR_M=48;
/** At most this many pop-ups at once (newest first); phones get fewer. */
export const POPUP_MAX=4,POPUP_MAX_PHONE=2;
/** How long a line stays up: ~4.5 s, a little longer for long lines, never more than ~6.5 s. */
export const popupMs=(text:string)=>Math.min(6_500,4_500+Math.max(0,text.length-40)*30);
const POPUP_FADE_MS=600;

/** Requests from a pop-up or dot click: open the dock on this thread. */
export const dialogueRequests=new EventTarget();
export const requestSoulConversations=(soulId:string)=>dialogueRequests.dispatchEvent(new CustomEvent('open-soul',{detail:soulId}));
export const requestThread=(thread:string)=>dialogueRequests.dispatchEvent(new CustomEvent('open-thread',{detail:thread}));

/** Where each painted speaker was last seen (near and drawn), so the per-pass cap can prefer the newest lines. */
const seen=new Map<string,{at:number;eligible:boolean}>();
let pass={at:-Infinity,chosen:new Set<string>()};
const phone=()=>{try{return matchMedia('(max-width: 700px)').matches;}catch{return false;}};
/** The pop-ups allowed this pass: newest live lines whose speakers were near and drawn on the previous pass. */
function chosen(now:number){
 if(now-pass.at<120)return pass.chosen;
 const live=[...speakingNow].filter(([id,s])=>s.text&&now-s.since<popupMs(s.text)&&seen.get(id)?.eligible&&now-seen.get(id)!.at<1_000)
  .sort((a,b)=>b[1].since-a[1].since).slice(0,phone()?POPUP_MAX_PHONE:POPUP_MAX);
 pass={at:now,chosen:new Set(live.map(([id])=>id))};return pass.chosen;
}
const clip=(text:string)=>text.length>160?text.slice(0,157).trimEnd()+'…':text;

/** Paint (or clear) the pop-up and the small speaking dot in one name tag. Cheap when nothing changed; one
 * style read. `distance` is the camera distance in metres (unknown = near). */
export function paintSpeakingDot(label:HTMLElement,soulId:string,enabled:boolean,now=performance.now(),distance?:number){
 let dot=label.querySelector<HTMLElement>(':scope > [data-speaking-dot]'),pop=label.querySelector<HTMLElement>(':scope > [data-speech-popup]');
 const s=enabled?speakingNow.get(soulId):undefined,age=s?now-s.since:Infinity;
 const drawn=label.style.display!=='none'&&label.style.visibility!=='hidden';
 seen.set(soulId,{at:now,eligible:drawn&&(distance===undefined||!Number.isFinite(distance)||distance<=POPUP_NEAR_M)});
 if(seen.size>400)for(const [id,v] of seen)if(now-v.at>5_000)seen.delete(id);
 const showPop=!!s?.text&&age<popupMs(s.text)&&chosen(now).has(soulId);
 if(showPop&&s?.text){
  if(!pop){pop=document.createElement('span');pop.dataset.speechPopup='';pop.className='dialogue-popup';pop.setAttribute('role','button');pop.tabIndex=0;
   pop.title='Open this conversation';const open=(e:Event)=>{e.stopPropagation();e.preventDefault();if(pop!.dataset.thread)requestThread(pop!.dataset.thread);};
   pop.addEventListener('click',open);pop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open(e);});label.append(pop);}
  const key=s.key??`${s.since}`;
  if(pop.dataset.key!==key){pop.dataset.key=key;pop.dataset.thread=s.thread;pop.style.setProperty('--thread',s.colour);pop.classList.toggle('private',!!s.private);
   pop.textContent=(s.private?'🔒 ':'')+clip(s.text);pop.classList.remove('fading');pop.classList.remove('in');void pop.offsetWidth;pop.classList.add('in');}
  pop.classList.toggle('fading',age>popupMs(s.text)-POPUP_FADE_MS);
  if(pop.hidden){pop.hidden=false;}label.classList.add('dialogue-popping');label.classList.toggle('dialogue-popping-private',!!s.private);label.style.setProperty('--thread',s.colour);
 }else if(pop&&!pop.hidden){pop.hidden=true;label.classList.remove('dialogue-popping','dialogue-popping-private');}
 // The dot marks a recent speaker while no pop-up is up (distant speakers, or after the pop-up fades).
 if(!s||age>SPEAKING_SHOW_MS||showPop){if(dot&&!dot.hidden)dot.hidden=true;return;}
 if(!dot){dot=document.createElement('span');dot.dataset.speakingDot='';dot.className='dialogue-head-dot';dot.title='Speaking: click to see the conversation';
  dot.addEventListener('click',e=>{e.stopPropagation();if(dot!.dataset.thread)requestThread(dot!.dataset.thread);});label.append(dot);}
 const pulse=age<SPEAKING_PULSE_MS,state=`${s.colour}|${pulse}`;dot.dataset.thread=s.thread;
 if(dot.dataset.state!==state){dot.dataset.state=state;dot.style.setProperty('--thread',s.colour);dot.classList.toggle('pulse',pulse);}
 if(dot.hidden)dot.hidden=false;
}
