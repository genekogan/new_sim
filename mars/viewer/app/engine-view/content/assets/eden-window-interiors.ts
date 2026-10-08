/** Lit windows with a room behind them, without geometry: "interior mapping" in the glass shader. A ray from
 * the eye through the glass pane is traced into a box room (width × height × depth) behind the facade and the
 * wall, floor or ceiling it hits is shaded: wall paint per room, a wooden floor, a warm lamp near the ceiling,
 * a picture or a shelf on the back wall, now and then a person's soft silhouette moving slowly across it, and
 * curtains or a net curtain at the glass. Rooms switch on and off through the evening (uEdenWindows.x =
 * fraction lit; each room keeps its own threshold), so streets are never uniformly lit. Night only; the day
 * reflection of the glass is untouched. Presentation only.
 *
 * Shared by the Regions window glass (merged facades; rooms on a world grid) and the neighbourhood houses'
 * facade windows (one room per window, curtains framed to the pane). Needs the viewer's night lighting
 * (vEdenNightWorld, uEdenNight) and uEdenWindows ([lit fraction, time s, -, -]). */
export const EDEN_ROOM_GLSL=/* glsl */`
float edenRh(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z);}
// o: entry point on the glass in room coordinates (x along the facade from the room's left wall, y up from the
// floor, z = 0 at the glass), d: ray direction in the same frame (z into the room), R: room size, seed: room id.
vec3 edenRoom(vec3 o,vec3 d,vec3 R,float seed,float t){
 vec3 dd=d;dd.z=max(dd.z,.05);
 float tx=((dd.x>0.0?R.x:0.0)-o.x)/(abs(dd.x)>1e-4?dd.x:1e-4);
 float ty=((dd.y>0.0?R.y:0.0)-o.y)/(abs(dd.y)>1e-4?dd.y:1e-4);
 float tz=R.z/dd.z;
 float tt=min(min(max(tx,0.0),max(ty,0.0)),tz);vec3 h=o+dd*tt;
 float s2=fract(seed*13.7),s3=fract(seed*71.3),s4=fract(seed*5.91);
 vec3 paint=s2<.25?vec3(.93,.86,.72):s2<.45?vec3(.95,.78,.66):s2<.62?vec3(.74,.82,.68):s2<.78?vec3(.7,.78,.88):vec3(.96,.93,.86);
 vec3 c;
 if(tt==tz){c=paint;
  // back wall: a picture (or a shelf of books), a dark doorway on some walls
  vec2 b=h.xy;float px=R.x*(.3+.4*s3);
  if(s4<.5){if(abs(b.x-px)<.32&&abs(b.y-1.55)<.24)c=mix(vec3(.25,.2,.15),vec3(.55+.4*s3,.45,.3+.4*s4),step(abs(b.x-px),.27)*step(abs(b.y-1.55),.19));}
  else if(abs(b.y-1.2)<.55&&abs(b.x-px)<.6){float row=fract(b.y*3.4);c=row<.18?vec3(.35,.25,.17):mix(vec3(.55,.2,.18),vec3(.2,.35,.5),step(.5,fract(b.x*9.0+s3)))*.9;}
  if(s3>.8&&abs(b.x-R.x*.85)<.38&&b.y<2.05)c*=.35;
  // a person now and then, drifting across the back wall
  if(s4>.82){float px2=R.x*(.5+.32*sin(t*.07+seed*20.0));vec2 q=b-vec2(px2,0.0);
   float body=length(vec2(q.x/.22,(q.y-1.0)/.62));float head=length(vec2(q.x,q.y-1.72))/.13;
   float sh=1.0-smoothstep(.85,1.1,min(body,head));c*=1.0-.75*sh;}
 }else if(tt==max(ty,0.0)&&dd.y<0.0){ // floor: boards and a rug
  c=vec3(.42,.28,.17)*(.85+.15*step(.5,fract(h.x*4.0+s2)));
  if(abs(h.x-R.x*.5)<R.x*.3&&h.z>R.z*.25&&h.z<R.z*.8)c=mix(vec3(.55,.18,.16),vec3(.2,.32,.45),step(.5,s3))*.9;
 }else if(tt==max(ty,0.0)){c=vec3(.95,.92,.86); // ceiling
 }else c=paint*.92; // side walls
 // a warm lamp hanging near the ceiling, toward the middle of the room
 vec3 lamp=vec3(R.x*.5,R.y*.82,R.z*.55);float dl=length(h-lamp);
 float k=.35+1.15/(1.0+dl*dl*.55);
 vec3 tint=mix(vec3(1.0,.78,.5),vec3(1.0,.9,.75),s2);
 return c*tint*k;
}
// Net or drawn curtains at the glass: a: across the pane 0..1, y: up 0..1, seed.
vec3 edenCurtain(float a,float y,float seed,vec3 room,out float cover){
 float s=fract(seed*31.7);cover=0.0;
 vec3 col=s<.33?vec3(.75,.22,.18):s<.66?vec3(.92,.86,.7):vec3(.38,.55,.42);
 float fold=.82+.18*sin(a*60.0+seed*9.0);
 if(s<.55){float w=.16+.14*fract(seed*7.3);float side=max(1.0-smoothstep(w-.03,w,a),smoothstep(1.0-w,1.0-w+.03,a));cover=side*.92;}
 else{cover=.45;col=vec3(.95,.92,.85);}
 return mix(room,col*(.35+.65*dot(room,vec3(.33)))*fold*1.3,cover);
}
`;
