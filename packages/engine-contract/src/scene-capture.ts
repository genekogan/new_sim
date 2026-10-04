// An observation of the public render base, not a physical scene installation.
import { z } from 'zod';
import { hashOf } from './hash.ts';
/** Current public render base, without physical controller dependencies. */
export type RenderScene = {
  scene:unknown;
  buildings?:{file:string;p:[number,number,number];yaw?:number}[];
  kin?:{model:string;p:[number,number,number];yaw?:number;radius?:number;hoverHeight?:number;hover?:number}[];
  clock?:{origin:number;dayTicks:number}|null;
  ground?:'grass';
};

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const rulesVersion = z.string().min(1).max(200);
export const renderSceneRefV1Schema = z.object({
  contract: z.literal('render-scene-ref/1'), rulesVersion,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RenderSceneRefV1 = z.infer<typeof renderSceneRefV1Schema>;
const bodySchema = z.object({
  scene: z.unknown(),
  buildings: z.array(z.object({file:z.string(),p:vec3,yaw:finite.optional()}).strict()).optional(),
  kin: z.array(z.object({model:z.string(),p:vec3,yaw:finite.optional(),radius:finite.positive().optional(),hoverHeight:finite.optional(),hover:finite.optional()}).strict()).optional(),
  clock: z.object({origin:z.number().int().nonnegative(),dayTicks:z.number().int().positive()}).strict().nullable().optional(),
  ground: z.literal('grass').optional(),
}).strict();
export type RenderSceneCaptureV1 = {
  contract:'render-scene-capture/1'; ref:RenderSceneRefV1; body:RenderScene;
};
/** A detached, bounded JSON copy. Hashing first rejects non-finite numbers;
 * JSON encoding rejects cycles and excludes optional undefined fields. Only a
 * trusted engine's already-public renderScene() output belongs here. */
export function captureRenderScene(rules:string, scene:RenderScene):RenderSceneCaptureV1 {
  rulesVersion.parse(rules);
  if (!Object.hasOwn(scene,'scene')) throw new TypeError('render scene body is required');
  hashOf(scene);
  const json=JSON.stringify(scene);
  if (new TextEncoder().encode(json).length>1024*1024) throw new RangeError('render scene capture exceeds 1 MiB');
  const body=bodySchema.parse(JSON.parse(json)) as RenderScene;
  return {contract:'render-scene-capture/1',ref:{contract:'render-scene-ref/1',rulesVersion:rules,
    hash:hashOf({contract:'render-scene-capture/1',rulesVersion:rules,body})},body};
}
export function parseRenderSceneCapture(raw:unknown):RenderSceneCaptureV1 {
  const shape=z.object({contract:z.literal('render-scene-capture/1'),ref:renderSceneRefV1Schema,body:bodySchema}).strict().parse(raw);
  const capture=captureRenderScene(shape.ref.rulesVersion,shape.body as RenderScene);
  if (capture.ref.hash!==shape.ref.hash) throw new TypeError('render scene capture hash mismatch');
  return capture;
}
