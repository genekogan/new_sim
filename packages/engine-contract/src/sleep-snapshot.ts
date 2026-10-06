import {z} from 'zod';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeSleepSnapshotPolicyV1Schema=z.strictObject({contract:z.literal('native-sleep-snapshot/1'),tick:z.number().int().nonnegative(),fromRulesVersion:z.string().min(1).max(200),toRulesVersion:z.string().min(1).max(200),fromStateHash:digest});
export type NativeSleepSnapshotPolicyV1=z.infer<typeof nativeSleepSnapshotPolicyV1Schema>;
