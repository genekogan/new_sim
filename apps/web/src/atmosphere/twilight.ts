/** Decorative colour variation from the actual civil day and solar elevation. No clock/light authority. */
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function twilightColour(elevation:number,cloud:number,day:number){
 const strength=smooth(-7,-1,elevation)*(1-smooth(5,17,elevation));
 const variation=(Math.sin(Math.floor(day)*1.713+2.1)+1)/2;
 const rose=(1-smooth(-2,5,elevation))*(.25+.55*variation)*smooth(.08,.6,cloud);
 return{strength:strength*(1-smooth(.8,1,cloud)*.7),rgb:[1,.59-.17*rose,.31+.23*rose] as const};
}
