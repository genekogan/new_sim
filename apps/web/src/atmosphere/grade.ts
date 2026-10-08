/** Time-of-day colour grading folded into three's shared fog chunk (no extra pass): every fogged built-in
 * material — and the sky dome, which runs the same code — ends with the same gentle grade in display space.
 * x strength 0 (the default, and for any material without these uniforms) is the identity.
 *  - day: a soft S-curve and a touch of saturation;
 *  - golden hour: warm highlights, faintly teal shadows;
 *  - blue hour: a cool lift in the shadows;
 *  - night: dim areas desaturate toward moonlit blue (rod vision) while bright, warm lamplight keeps its
 *    colour, and the S-curve deepens the darks, so night stays night.
 * Shared plain uniform objects: one write per frame updates every material. */
export const GRADE_A={x:0,y:0,z:0,w:0}; // x strength, y S-curve amount, z saturation delta, w highlight warmth
export const GRADE_B={x:0,y:0,z:0,w:0}; // xyz shadow tint (added, display space), w night desaturation
export const GRADE_PARS='\nuniform vec4 uEdenGradeA;\nuniform vec4 uEdenGradeB;\n';
export const GRADE_GLSL=/* glsl */`
if(uEdenGradeA.x>0.0){
 vec3 edenC=clamp(gl_FragColor.rgb,0.0,1.0);
 float edenL=dot(edenC,vec3(.2126,.7152,.0722));
 edenC=mix(edenC,edenC*edenC*(3.0-2.0*edenC),uEdenGradeA.y);
 edenC=mix(vec3(edenL),edenC,1.0+uEdenGradeA.z);
 float edenSh=1.0-smoothstep(.0,.5,edenL),edenHi=smoothstep(.45,1.0,edenL);
 edenC+=uEdenGradeB.rgb*edenSh;
 edenC*=mix(vec3(1.0),vec3(1.0+.07*uEdenGradeA.w,1.0+.015*uEdenGradeA.w,1.0-.09*uEdenGradeA.w),edenHi);
 float edenNd=uEdenGradeB.w*(1.0-smoothstep(.12,.55,edenL))*(1.0-smoothstep(.05,.25,edenC.r-edenC.b));
 edenC=mix(edenC,vec3(edenL)*vec3(.82,.93,1.18),edenNd);
 gl_FragColor.rgb=mix(gl_FragColor.rgb,edenC,uEdenGradeA.x);
}
`;
const sm=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Grade for this moment: day 0..1 (Daylight), warmth/blueHour (sun elevation), cloud 0..1. */
export function setGrade(day:number,warmth:number,blueHour:number,cloud:number){
 const golden=warmth*sm(.05,.5,day),night=1-sm(.02,.35,day),clear=1-.6*cloud;
 GRADE_A.x=1;
 GRADE_A.y=(.1+.06*night)*clear+.04;
 GRADE_A.z=(.07*day+.08*golden)*clear-.05*cloud-.1*night;
 GRADE_A.w=golden*clear*1.0+.15*day*clear;
 // shadow tint: teal at golden hour, blue at blue hour/night (small additive amounts)
 GRADE_B.x=-.012*golden-.006*blueHour-.004*night;
 GRADE_B.y=.004*golden+.0*blueHour;
 GRADE_B.z=.01*golden+.022*blueHour+.012*night;
 GRADE_B.w=.55*night;
}
export function clearGrade(){GRADE_A.x=0;}
