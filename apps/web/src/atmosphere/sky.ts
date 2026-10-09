import * as THREE from 'three';
import {GRADE_GLSL,GRADE_A,GRADE_B} from './grade.ts';
/** Sky dome: the Daylight background colour as a gentle gradient, a warm horizon glow toward the sun at
 * dawn and dusk, the sun's disc and glare, the moon with its true phase and a soft halo, a slowly turning
 * star field (two magnitudes, a few coloured, a faint Milky Way) and a drifting, self-shaded cloud layer
 * whose cover follows the weather. One opaque draw, drawn LAST among opaques with depth test on, so only
 * uncovered sky pixels run its fragment shader. Follows the camera (no scene traversal). Graded like the
 * fogged scene materials (grade.ts) so sky and ground stay one picture. */
const VERT=/* glsl */`
varying vec3 vDir;
void main(){vDir=normalize((modelMatrix*vec4(position,1.0)).xyz-cameraPosition);vec4 p=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);gl_Position=p.xyww;gl_Position.z=gl_Position.w*.99999;}`;
const FRAG=/* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uCloud; // x cover 0..1, y drift x, z drift z, w daylight
uniform vec3 uSunDir;
uniform vec4 uBow; // x rainbow intensity, y star visibility, z time, w fog veil
uniform sampler2D uNoise;
uniform vec4 uFlash; // distant lightning: x intensity, yzw unit direction
uniform vec4 uSun; // xyz true sun direction (may be below the horizon), w disc visibility
uniform vec3 uSunColor;
uniform vec4 uMoon; // xyz moon direction, w visibility
uniform vec4 uMoonLight; // x lit fraction, y night (halo), z Milky Way strength
uniform vec4 uDusk; // rgb horizon glow colour, w strength
uniform mat3 uStarRot;
uniform vec4 uEdenGradeA;
uniform vec4 uEdenGradeB;
varying vec3 vDir;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float h3(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z);}
float fbm(vec2 p){return texture2D(uNoise,p*.25).r*.72+texture2D(uNoise,p*.83+.37).a*.28;}
// One star per lit 3D cell on the sphere: magnitude, colour and twinkle from the cell hash.
vec3 starLayer(vec3 s,float n,float keep,float bright){
 vec3 q=s*n,cell=floor(q);float hs=h3(cell);if(hs<keep)return vec3(0.0);
 vec3 at=cell+.5+(vec3(h3(cell+3.1),h3(cell+7.7),h3(cell+1.3))-.5)*.7;float r=length(q-at),w=length(fwidth(q))*.9+.03;
 float mag=pow(fract(hs*97.0),2.2);
 float tw=.8+.2*sin(uBow.z*(1.3+hs*3.0)+hs*40.0);
 vec3 tint=mix(vec3(.78,.86,1.0),vec3(1.0,.86,.7),step(.75,fract(hs*13.0))*fract(hs*29.0));
 return tint*smoothstep(w,0.0,r)*(.25+.75*mag)*bright*tw;
}
void main(){
 vec3 d=normalize(vDir);float up=max(d.y,0.0);
 vec3 col=mix(uHorizon,uZenith,pow(up,.55));
 // Dawn/dusk: a warm band low on the horizon, strongest toward the sun's azimuth.
 if(uDusk.w>0.0){
  vec2 sa=uSun.xz;float sl=length(sa);float side=sl>1e-4?max(dot(normalize(d.xz+1e-5),sa/sl),0.0):.5;
  float band=exp(-max(d.y+.02,0.0)*6.0);
  col+=uDusk.rgb*uDusk.w*band*(.2+.8*side*side);
 }
 float night=uBow.y;
 if(night>0.0&&d.y>-.02){
  vec3 s=uStarRot*d;
  vec3 stars=starLayer(s,95.0,.982,1.0)+starLayer(s,210.0,.972,.45);
  // Milky Way: a soft, mottled band on a fixed great circle of the field.
  float b=dot(s,normalize(vec3(.42,.55,-.72)));
  vec2 mp=vec2(atan(s.z,s.x)*2.0,b*6.0);
  float milky=exp(-b*b*18.0)*(.45+.9*texture2D(uNoise,mp*.37).r*texture2D(uNoise,mp*.9+.5).g);
  float horizonFade=smoothstep(.02,.25,d.y);
  col+=(stars*1.15+vec3(.5,.56,.72)*milky*.075*uMoonLight.z)*night*horizonFade;
 }
 // Sun: disc and glare (cloud and fog cover it below).
 if(uSun.w>0.0){
  float c=dot(d,uSun.xyz);
  float disc=smoothstep(.99985,.99993,c);
  float glare=pow(max(c,0.0),900.0)*.5+pow(max(c,0.0),24.0)*.12;
  col+=uSunColor*(disc*1.6+glare)*uSun.w;
 }
 // Moon: a sphere lit by the sun (so the phase and terminator are true), faint maria, earthshine and a halo.
 if(uMoon.w>0.0){
  vec3 m=uMoon.xyz;float c=dot(d,m);
  const float R=.0145;
  if(c>.995){
   vec3 o=(d-m*c)/R;float r2=dot(o,o);
   if(r2<1.08){
    float w=sqrt(max(0.0,1.0-r2));vec3 n=normalize(o-m*w);
    float lit=smoothstep(-.04,.12,dot(n,normalize(uSun.xyz)));
    vec3 e1=normalize(cross(m,vec3(0.0,1.0,0.0)+1e-4)),e2=cross(e1,m);
    vec2 uv=vec2(dot(o,e1),dot(o,e2));
    float maria=texture2D(uNoise,uv*.33+.21).b;
    float albedo=.78-.3*smoothstep(.45,.75,maria);
    vec3 moon=vec3(.96,.94,.88)*(albedo*lit+.035);
    float a=smoothstep(1.0,.92,r2)*uMoon.w;
    col=mix(col,moon*(1.0+.3*uMoonLight.y),a);
   }
  }
  float ang=sqrt(max(0.0,2.0*(1.0-c)));
  col+=vec3(.72,.78,.92)*uMoonLight.x*uMoonLight.y*uMoon.w*(exp(-ang*ang/.0016)*.22+exp(-ang/.18)*.05);
 }
 if(d.y>0.015){
  vec2 p=d.xz/(d.y+.06)*1.4+uCloud.yz;
  float f=fbm(p)*.82+texture2D(uNoise,p*2.3+.71).r*.18;float cover=uCloud.x;
  float c=smoothstep(1.0-cover*.95-.18,1.0-cover*.95+.22,f);
  float edge=smoothstep(.0,.07,d.y);c*=edge;
  // Self-shading: denser toward the sun means the near side is shadowed, the far side catches light.
  vec2 toSun=uSunDir.xz/max(length(uSunDir.xz),1e-3);
  float fs=fbm(p+toSun*.09);
  float shade=clamp(.5+(f-fs)*3.5,0.0,1.0);
  float sunSide=pow(max(dot(d,uSunDir),0.0),6.0);
  float thick=smoothstep(.45,1.0,f+cover*.3);
  vec3 cc=mix(uCloudLit,uCloudShade,thick*.75);
  cc*=mix(.86,1.1,mix(.5,shade,uCloud.w));
  cc+=uCloudLit*sunSide*.25*uCloud.w;
  // Low sun colours the exposed cloud edges, fading continuously with solar elevation/weather.
  cc+=uDusk.rgb*uDusk.w*pow(max(dot(normalize(d.xz+1e-5),normalize(uSun.xz+1e-5)),0.0),2.0)*(1.0-thick*.65)*.55;
  // Moonlight silvers thin cloud near the moon at night.
  cc+=vec3(.55,.6,.72)*uMoonLight.x*uMoonLight.y*uMoon.w*pow(max(dot(d,uMoon.xyz),0.0),10.0)*(1.0-thick)*.35;
  col=mix(col,cc,c*(.55+.45*cover));
 }
 if(uBow.x>0.0&&d.y>-.02){
  // primary bow 40.5..42.5 deg around the antisolar point (violet inside, red outside), faint secondary at ~51 deg
  float ang=degrees(acos(clamp(dot(d,-uSunDir),-1.0,1.0)));
  float t=(ang-40.4)/2.2,band=smoothstep(0.0,.15,t)*smoothstep(1.0,.85,t);
  float hue=.78*(1.0-clamp(t,0.0,1.0));vec3 spec=clamp(abs(fract(vec3(hue)+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,0.0,1.0);
  float t2=(ang-50.2)/3.0,band2=smoothstep(0.0,.2,t2)*smoothstep(1.0,.8,t2);vec3 spec2=clamp(abs(fract(vec3(.78*clamp(t2,0.0,1.0))+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,0.0,1.0);
  float fade=smoothstep(-.02,.08,d.y);
  col+=(spec*band*.22+spec2*band2*.04)*uBow.x*fade;
 }
 if(uFlash.x>0.0){
  // distant lightning lights the cloud deck from within, strongest toward the strike
  float edenTo=pow(max(dot(d,uFlash.yzw),0.0),3.0);
  col+=uCloudLit*uFlash.x*(.06+.6*edenTo)*smoothstep(-.05,.2,d.y);
 }
 // inside a fog layer the whole sky veils toward the fog colour
 col=mix(col,uHorizon,uBow.w*(1.0-.35*up));
 gl_FragColor=vec4(col,1.0);
 #include <colorspace_fragment>
 ${GRADE_GLSL}
}`;
export class SkyDome{
 readonly mesh:THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>;
 readonly uniforms={uZenith:{value:new THREE.Color()},uHorizon:{value:new THREE.Color()},uCloudLit:{value:new THREE.Color()},uCloudShade:{value:new THREE.Color()},uCloud:{value:new THREE.Vector4()},uSunDir:{value:new THREE.Vector3(0,1,0)},uBow:{value:new THREE.Vector4()},uFlash:{value:new THREE.Vector4()},uNoise:{value:null as THREE.Texture|null},
  uSun:{value:new THREE.Vector4(0,1,0,0)},uSunColor:{value:new THREE.Color(1,1,1)},uMoon:{value:new THREE.Vector4(0,1,0,0)},uMoonLight:{value:new THREE.Vector4()},uDusk:{value:new THREE.Vector4()},uStarRot:{value:new THREE.Matrix3()},
  uEdenGradeA:{value:GRADE_A},uEdenGradeB:{value:GRADE_B}};
 constructor(){
  const m=new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,side:THREE.BackSide,depthWrite:false,fog:false});
  this.mesh=new THREE.Mesh(new THREE.SphereGeometry(400,32,16),m);this.mesh.name='atmosphere: sky and clouds';
  this.mesh.frustumCulled=false;this.mesh.renderOrder=1e6;this.mesh.userData.cameraTransparent=true;this.mesh.raycast=()=>{};
  this.mesh.matrixAutoUpdate=false;
 }
 follow(camera:THREE.Camera){camera.getWorldPosition(this.mesh.position);this.mesh.updateMatrix();}
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
