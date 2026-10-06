import {z} from 'zod';
export const edenLecturePlacementV1Schema=z.strictObject({id:z.string().regex(/^eden-lecture-[a-z0-9-]+$/).max(48),origin:z.tuple([z.number().finite().min(-400).max(400),z.number().finite().min(-400).max(400)]),yaw:z.number().finite().min(-Math.PI).max(Math.PI),audienceSeats:z.union([z.literal(16),z.literal(20),z.literal(24)]),lesson:z.string().min(1).max(160)});
export type EdenLecturePlacementV1=z.infer<typeof edenLecturePlacementV1Schema>;
