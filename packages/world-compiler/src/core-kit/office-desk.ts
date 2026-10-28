// A desk used with a separately authored, functional office-chair. Frozen v1 keeps its built-in scenery chair.
import vocab from './vocab-w3.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

export const OFFICE_DESK_DEF: DefInput = /* @__PURE__ */ (() => {
  const old = structuredClone(vocab.find(def => def.name === 'core-office-desk')!) as unknown as DefInput;
  if (old.make.kind !== 'gen') throw new Error('core/office-desk@1 must remain a kit definition');
  const args = old.make.args as { shapes: { at?: number[]; a?: number[]; b?: number[] }[] };
  // v1's chair is exactly the final five base spokes, pedestal, cushion and back. The desk and computer
  // shapes before them are byte-identical; fail loudly if that source layout ever changes.
  if (args.shapes.length !== 23 || args.shapes[21].at?.[2] !== .62 || args.shapes[22].at?.[2] !== .84) throw new Error('unexpected frozen office-desk chair geometry');
  return { ...old, version: 2,
    size: { ...old.size, box: [1.4, 1.25, .7] },
    description: 'An office desk with a computer, keyboard, mouse and drawer unit. Pair it with a separate office chair; work at it and switch the computer on and off.',
    make: { ...old.make, args: { ...old.make.args, shapes: args.shapes.slice(0, -8) } },
    // Keep the authored surface/user anchors and workstation component unchanged.
  };
})();
