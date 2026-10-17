// Eden 2026 night lights and street life (gaps V9, V3): old /w/eden lit every district path with 3-4 m lamp posts and
// strung warm bulbs by the pond and over the market, and scattered ~290 small things along its streets (benches, bins,
// mailboxes, bikes, planters, swings, hammocks, barrels...). old-props.json (extract-old-props.mts) holds their old
// positions; here each becomes a real, editable core-kit thing where it stood. Every batch is optional (droppable).
import { readFileSync } from 'node:fs';
const OLD = JSON.parse(readFileSync(new URL('./old-props.json', import.meta.url)));
const r2 = n => Math.round(n * 100) / 100;
const put = (def, name, x, z, r = 0, extra = {}) => ({ op: 'place', def: `core/${def}@1`, name, p: [r2(x), r2(z)], ...(r ? { r: r2(r) } : {}), ...extra });

export function lightOps() {
  const ops = [];
  OLD.regionLights.filter(([k, , y]) => (k === 'lamp' || k === 'park-lamp') && y < 1.5).forEach(([, x, , z], i) => ops.push(put('lamp-post', `lamp-district-${i + 1}`, x, z)));
  [...OLD.streetLamps, ...OLD.parkLamps].forEach(([x, z], i) => ops.push(put('lamp-post', `lamp-street-${i + 1}`, x, z)));
  OLD.parkLanterns.forEach(([x, z], i) => ops.push(put('bollard-light', `lamp-lantern-${i + 1}`, x, z)));
  // warm bulbs: along the shore pond's north and south banks (old fairy lights in the bank trees) and over the
  // market kiosks and the social dining tables, as old Eden's bunting
  for (const [i, x, z, r] of [[1, -42, -13.5, 0.05], [2, -34, -13, -0.1], [3, -42, 13.5, -0.05], [4, -34, 13, 0.1]]) ops.push(put('twinkle-lights', `lights-pond-${i}`, x, z, r));
  ops.push(put('string-lights', 'lights-market-kiosks', 57.5, -24.2), put('string-lights', 'lights-social-dining', 23, 10.5));
  return ops;
}

const PROP = { bench: 'bench', bin: 'bin', mailbox: 'mailbox', wheelieBin: 'wheelie-bin', porchChair: 'chair', signpost: 'signpost', bikeRack: 'bike-rack', bike: 'bicycle',
  noticeBoard: 'notice-board', banner: 'banner', planterBox: 'planter-box', pot: 'flower-pot', flowerPot: 'flower-pot', flowerBuckets: 'flower-pot', rainBarrel: 'rain-barrel',
  stump: 'stump', fallenLog: 'log', mushrooms: 'mushrooms', bollard: 'bollard', birdBath: 'birdbath', swing: 'swings', sandbox: 'sandpit', hammock: 'hammock', easel: 'easel',
  wateringCan: 'watering-can', picnicTable: 'picnic-table', laundryLine: 'laundry-line', gardenTable: 'parasol-table', compost: 'compost-heap', wheelbarrow: 'wheelbarrow',
  toys: 'toy-blocks', sack: 'sack', crate: 'crate', barrel: 'barrel', chalkboard: 'chalkboard', phoneBox: 'phone-box', trough: 'trough', firewood: 'firewood', hydrant: 'hydrant',
  birdhouse: 'bird-table', leaves: 'leaf-litter' };
export function propOps() {
  const ops = [];
  for (const [kind, list] of Object.entries(OLD.props)) { const def = PROP[kind]; if (!def) continue; list.forEach(([x, z, r], i) => ops.push(put(def, `street-${def}-${kind === def ? '' : kind.toLowerCase() + '-'}${i + 1}`.slice(0, 48), x, z, r))); }
  return ops;
}
