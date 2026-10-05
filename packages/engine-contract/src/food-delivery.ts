import {z} from 'zod';
const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const commonsFoodDeliveryV1Schema=z.strictObject({contract:z.literal('commons-food-delivery/1'),deliveryId:id,batch:z.number().int().min(1).max(4),portions:z.literal(8),tick:z.number().int().nonnegative(),fromRulesVersion:z.string().min(1).max(200),toRulesVersion:z.string().min(1).max(200),fromStateHash:digest,additionsHash:digest,base:z.strictObject({campus:z.string().min(1).max(100),staticHash:digest})});
export type CommonsFoodDeliveryV1=z.infer<typeof commonsFoodDeliveryV1Schema>;
