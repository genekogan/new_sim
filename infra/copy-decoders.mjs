// Ship Three's matching Draco runtime with the same release; no external decoder origin.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const req = createRequire(new URL('../mars/viewer/package.json', import.meta.url));
const three = dirname(dirname(req.resolve('three')));
const dest = new URL('../mars/viewer/dist/client/draco/', import.meta.url);
mkdirSync(dest, {recursive:true});
cpSync(join(three,'examples/jsm/libs/draco/gltf'),dest,{recursive:true});
