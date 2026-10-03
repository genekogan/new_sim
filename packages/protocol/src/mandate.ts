import {z} from 'zod';
import type {AgendaStep} from './index.ts';

export const mandateTriggerSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('none')}),
 z.object({kind:z.literal('now')}),
 z.object({kind:z.literal('time'),hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59)}),
 z.object({kind:z.literal('gathering'),host:z.string().min(1).max(100)}),
]);
export type MandateTrigger=z.infer<typeof mandateTriggerSchema>;
export type MandateRule={
 id:string;words:string;strict:boolean;understanding:string;agenda:AgendaStep[];
 trigger:MandateTrigger;status:'active'|'done'|'blocked';report:string|null;
 lastFiredDay?:number;conditionMatched?:boolean;lastReportDay?:number;
};
export const steerSchema=z.object({words:z.string().min(1).max(2000).refine(words=>words.trim().length>0),strict:z.boolean().default(false),id:z.string().max(100).optional()});
export type Alignment={understanding:string;trigger:MandateTrigger};
