// core/humanoid@2 on its own (lane PERF2): the viewer's look module (apps/web/src/humanoid/look.ts) needs only this def,
// and importing CORE_KIT for it put the whole core kit (~2 MB of defs) into the web bundle. core-kit.ts still lists it.
// Subpath export: `@sim/world-compiler/humanoid2`.
import type { DefInput } from '../schemas.ts';

export const HUMANOID2_DEF: DefInput = { schema: 'def/1', name: 'core-humanoid', version: 2, extends: 'core/humanoid@1', description: 'A human body on the humanoid rig whose look (frame, face, hair, clothes, hat, glasses, bag, colours, head size, height, build, walking speed) is composed from the shared humanoid kit.', tags: ['body'], form: 'point', make: { kind: 'none' }, size: { box: [0.56, 1.8, 0.56] }, layer: 'solid', anchor: 'base',
    params: {
      preset: { type: 'enum', values: ['none', 'casual', 'punk', 'woman'], default: 'none' },
      frame: { type: 'enum', values: ['masc', 'fem'], default: 'masc' },
      face: { type: 'enum', values: ['open', 'pierced', 'soft', 'adventurer', 'beach', 'casual-hoodie', 'farmer', 'king', 'spacesuit', 'suit', 'swat', 'woman-adventurer', 'woman-formal', 'woman-medieval', 'woman-punk', 'woman-scifi', 'woman-soldier', 'woman-suit', 'woman-witch', 'woman-worker', 'worker'], default: 'open' },
      hair: { type: 'enum', values: ['short', 'mohawk', 'bob', 'adventurer', 'beach', 'casual-hoodie', 'king', 'suit', 'woman-adventurer', 'woman-formal', 'woman-medieval', 'woman-punk', 'woman-scifi', 'woman-soldier', 'woman-suit', 'woman-witch', 'woman-worker', 'worker', 'bald'], default: 'short' },
      top: { type: 'enum', values: ['shirt', 'jacket', 'tank', 'adventurer', 'beach', 'casual-hoodie', 'farmer', 'king', 'spacesuit', 'suit', 'swat', 'woman-adventurer', 'woman-formal', 'woman-medieval', 'woman-punk', 'woman-scifi', 'woman-soldier', 'woman-suit', 'woman-witch', 'woman-worker', 'worker'], default: 'shirt' },
      bottom: { type: 'enum', values: ['jeans', 'ripped', 'slacks', 'adventurer', 'beach', 'casual-hoodie', 'farmer', 'king', 'spacesuit', 'suit', 'swat', 'woman-adventurer', 'woman-formal', 'woman-medieval', 'woman-punk', 'woman-scifi', 'woman-soldier', 'woman-suit', 'woman-witch', 'woman-worker', 'worker'], default: 'jeans' },
      shoes: { type: 'enum', values: ['sneakers', 'boots', 'flats', 'adventurer', 'beach', 'casual-hoodie', 'farmer', 'king', 'spacesuit', 'suit', 'swat', 'woman-adventurer', 'woman-formal', 'woman-medieval', 'woman-punk', 'woman-scifi', 'woman-soldier', 'woman-suit', 'woman-witch', 'woman-worker', 'worker'], default: 'sneakers' },
      hat: { type: 'enum', values: ['none', 'cap', 'beanie', 'sunhat'], default: 'none' },
      glasses: { type: 'enum', values: ['none', 'round', 'square', 'shades'], default: 'none' },
      bag: { type: 'enum', values: ['none', 'backpack', 'satchel'], default: 'none' },
      pattern: { type: 'enum', values: ['plain', 'stripes', 'checks', 'knit'], default: 'plain' },
      headSize: { type: 'number', min: 0.94, max: 1.08, default: 1 },
      height: { type: 'number', min: 1.65, max: 1.85, default: 1.75 }, build: { type: 'number', min: 0.92, max: 1.1, default: 1 }, walkSpeed: { type: 'number', min: 0.9, max: 1.4, default: 1.35 },
      skin: { type: 'color', default: '#cead86' }, hair1: { type: 'color', default: '#492e18' }, brows: { type: 'color', default: '#3e3429' }, eyes: { type: 'color', default: '#31251c' },
      top1: { type: 'color', default: '#969083' }, top2: { type: 'color', default: '#b4b4b4' }, bottom1: { type: 'color', default: '#333f47' },
      shoes1: { type: 'color', default: '#7d2734' }, soles: { type: 'color', default: '#b4b4b4' }, accent: { type: 'color', default: '#af8749' }, gear: { type: 'color', default: '#3c5a6e' },
    } };
