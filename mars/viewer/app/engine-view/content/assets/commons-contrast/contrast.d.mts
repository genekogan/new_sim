import type {Group} from 'three';
export const COMMONS_FACTORY_SHA256:string;
export const FROZEN_FIXTURE_DISPATCH_SHA256:string;
export type CommonsContrastBinding={factorySHA256:string;createOriginal:(kind:'bench'|'pavilion')=>{group:Group;dispose():void}};
export type CommonsContrastView={group:Group;syncNativeFixture(fixture:unknown,binding?:CommonsContrastBinding):boolean;dispose():void};
export function commonsContrastEligible(fixture:unknown,binding:CommonsContrastBinding):boolean;
export function createCommonsContrast(fixture:unknown,binding:CommonsContrastBinding):CommonsContrastView|null;
