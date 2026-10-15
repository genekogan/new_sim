# Kit authoring helpers

Existing core-kit snippets work locally from the repository (metres, +y up, +z front):

```js
import { limb, mirror } from '../../../packages/world-compiler/src/core-kit/authoring/dsl.mjs';
const left = [limb([-0.4, 1, 0], [-0.7, 0.2, 0.1], 0.08, '#665544', { role: 'arm.l' })];
const arms = [...left, ...mirror(left)];
```

`limb(a,b,r,color,{kind:'cyl'})` spans endpoints with a cylinder; the default capsule includes its end caps.
`mirror(shapes)` returns the reflected copies across x, swaps left/right roles and reflects pivots.
The source helper rounds positions and rotations to three decimals.
