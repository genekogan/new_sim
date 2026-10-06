import {z} from 'zod';
export const edenLecturePlacementV1Schema=z.strictObject({worldEast:z.literal('world-v2').optional(),id:z.string().regex(/^eden-(?:lecture|classroom)-[a-z0-9-]+$/).max(48),origin:z.tuple([z.number().finite().min(-400).max(400),z.number().finite().min(-400).max(400)]),yaw:z.number().finite().min(-Math.PI).max(Math.PI),audienceSeats:z.union([z.literal(16),z.literal(20),z.literal(24)]),lesson:z.string().min(1).max(160)});
export type EdenLecturePlacementV1=z.infer<typeof edenLecturePlacementV1Schema>;
export const edenLectureTransitionV1Schema=z.strictObject({contract:z.literal('eden-lecture-transition/1'),placement:edenLecturePlacementV1Schema,tick:z.number().int().nonnegative(),fromRulesVersion:z.string().min(1).max(200),toRulesVersion:z.string().min(1).max(200),fromStateHash:z.string().regex(/^[a-f0-9]{64}$/),layoutHash:z.string().regex(/^[a-f0-9]{64}$/)});
export type EdenLectureTransitionV1=z.infer<typeof edenLectureTransitionV1Schema>;
