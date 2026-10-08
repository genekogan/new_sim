import * as THREE from 'three';
import {solarPosition} from '../../../../mars/viewer/engine/env/sun.ts';
import {daylightFactors} from '../../../../mars/viewer/engine/env/daylight.ts';
/** Sky bodies for the dome (presentation only): the sun's true direction (Daylight clamps its light above the
 * horizon), the moon (phase from the synodic month, placed where the sun stood `elongation/15` hours earlier,
 * which is good to a few degrees), and the star field's rotation about the celestial pole (sidereal rate).
 * Pure functions of the world clock (civil "YYYY-MM-DDTHH:MM:SS", as Daylight reads it). */
export type SkyBodies={sun:THREE.Vector3;moon:THREE.Vector3;
 /** 0 new .. .5 full .. 1 new (synodic phase). */
 phase:number;
 /** Lit fraction of the disc, 0..1. */
 illumination:number;sunElevation:number;warmth:number;blueHour:number;
 /** Rotation taking a sky direction to fixed star-field coordinates. */
 starRotation:THREE.Matrix3};
const SYNODIC=29.530588853,NEW_MOON_MS=Date.UTC(2000,0,6,18,14);
const DEG=Math.PI/180;
/** Civil clock → ms (treated as UTC; only differences and the moon's slow phase use it). */
export function civilMs(iso:string):number|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(iso);if(!m)return null;
 const ms=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]??0),m[7]?Math.round(+('0.'+m[7])*1000):0);return Number.isFinite(ms)?ms:null;
}
export function civilIso(ms:number){return new Date(ms).toISOString().slice(0,19);}
/** Synodic phase 0..1 (California civil time is ~7–8 h behind UTC; the phase moves 0.4 % per hour, so it is folded in as 7.5 h). */
export function moonPhase(ms:number){const p=((ms+7.5*3600e3-NEW_MOON_MS)/86400e3/SYNODIC)%1;return p<0?p+1:p;}
const vec=(d:[number,number,number],out:THREE.Vector3)=>out.set(d[0],d[1],d[2]).normalize();
export function skyBodies(iso:string,out?:SkyBodies):SkyBodies|null{
 const ms=civilMs(iso);if(ms===null)return null;
 let s,m,a,b;
 const phase=moonPhase(ms),elong=phase*360;
 try{s=solarPosition(iso);m=solarPosition(civilIso(ms-elong/15*3600e3));a=solarPosition(civilIso(ms-3*3600e3));b=solarPosition(civilIso(ms+3*3600e3));}catch{return null;}
 if(![s,m,a,b].every(p=>p.direction.every(Number.isFinite)))return null;
 const o=out??{sun:new THREE.Vector3(),moon:new THREE.Vector3(),phase:0,illumination:0,sunElevation:0,warmth:0,blueHour:0,starRotation:new THREE.Matrix3()};
 vec(s.direction,o.sun);vec(m.direction,o.moon);o.phase=phase;o.illumination=.5*(1-Math.cos(phase*2*Math.PI));
 const f=daylightFactors(s.elevationDeg);o.sunElevation=s.elevationDeg;o.warmth=f.warmth;o.blueHour=f.blueHour;
 // Celestial pole: the axis the sun turns about over the day (its declination barely moves in 6 h).
 const da=vec(a.direction,new THREE.Vector3()),db=vec(b.direction,new THREE.Vector3()),pole=da.clone().cross(db).normalize();
 // Stars turn about the pole at the sidereal rate (15.041°/h); the sky coordinates are the field at angle 0.
 // The sun advances by +angle about cross(a, b); so do the stars, so the field is sampled at the inverse rotation.
 const angle=((ms/3600e3)*15.041*DEG)%(Math.PI*2),r=new THREE.Matrix4().makeRotationAxis(pole,-angle);
 o.starRotation.setFromMatrix4(r);
 return o;
}
