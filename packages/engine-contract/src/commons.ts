// Optional public metadata inside the existing opaque captured scene. This
// describes the five installed authored fixtures; it does not grant activity,
// move a body, revise an old capture or authorize a history transition.
import { z } from 'zod';

const finite=z.number().finite();
const placement=(id:string,kind:string,def:string)=>z.object({
  id:z.literal(id),kind:z.literal(kind),def:z.literal(def),
  p:z.tuple([finite,finite,finite]),yaw:finite,
}).strict();
export const commonsSceneMetadataV1Schema=z.object({
  version:z.literal('commons/1'),source:z.string().regex(/^[a-f0-9]{40}$/),
  layout:z.tuple([
    placement('commons-pavilion','pavilion','eden-commons-pavilion'),
    placement('commons-platform','presentation-platform','eden-commons-platform'),
    placement('commons-bench-west','bench','eden-commons-bench'),
    placement('commons-bench-east','bench','eden-commons-bench'),
    placement('commons-table','table','eden-commons-table'),
  ]),
}).strict();
export type CommonsSceneMetadataV1=z.infer<typeof commonsSceneMetadataV1Schema>;
