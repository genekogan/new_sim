import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validatePainting, rasterizePainting, PAINTING_RENDERER } from './painting.ts';
import { imageSize, validateUpload } from './validate.ts';

export const picture = { title: 'Dusk', background: '#101020', shapes: [
  { kind: 'rect', x: 0, y: 0.5, width: 1, height: 0.5, colour: '#203060' },
  { kind: 'ellipse', cx: 0.5, cy: 0.4, rx: 0.2, ry: 0.2, colour: '#ffcc00' },
  { kind: 'line', x1: 0.1, y1: 0.8, x2: 0.9, y2: 0.8, width: 0.02, colour: '#ffffff' },
] };
test('painting/1 validates/copies bounded data and rejects code, spoofed credit, nonfinite values and oversized JSON', () => {
  const copy = validatePainting(picture); assert.notEqual(copy, picture); assert.equal(copy.title, 'Dusk');
  for (const raw of [null, {}, { ...picture, maker: 'Ana' }, { ...picture, title: 'bad\ncredit' }, { ...picture, background: 'url(https://evil)' }, { ...picture, title: '' },
    { ...picture, shapes: Array(65).fill(picture.shapes[0]) }, { ...picture, shapes: [{...picture.shapes[0], x: NaN}] }, { ...picture, shapes: [{...picture.shapes[0], width: 0}] },
    { ...picture, shapes: [{ kind: 'svg', data: '<script/>' }] }, { ...picture, shapes: [{...picture.shapes[2], width: 0.3}] }, { ...picture, other: 'x'.repeat(16 * 1024) },
    { ...picture, shapes: [{...picture.shapes[0], x: -0.1}] }, { ...picture, shapes: [{...picture.shapes[0], x: Infinity}] }]) assert.throws(() => validatePainting(raw), /painting|title|expected|colour|shape|size|coordinate/);
  assert.deepEqual(validatePainting({title:'Blank',background:'#FFFFFF',shapes:[]}), {title:'Blank',background:'#ffffff',shapes:[]});
});
test('painting-rgb/1 emits deterministic valid 512 PNG with ordered shapes, clipping and line coverage', () => {
  assert.equal(PAINTING_RENDERER, 'painting-rgb/1');
  const a = rasterizePainting(picture), b = rasterizePainting(picture); assert.deepEqual(a, b);
  assert.deepEqual(imageSize(a, 'png'), [512, 512]); assert.equal(validateUpload(a).kind, 'image');
  const data: Buffer[] = []; let at = 8;
  while (at < a.length) { const length = a.readUInt32BE(at), kind = a.toString('ascii', at + 4, at + 8); if (kind === 'IDAT') data.push(a.subarray(at + 8, at + 8 + length)); at += length + 12; }
  const scan = inflateSync(Buffer.concat(data)), pixel = (x: number, y: number) => [...scan.subarray(y * 1537 + 1 + x * 3, y * 1537 + 4 + x * 3)];
  assert.equal(scan.length, 512 * 1537); assert.deepEqual(pixel(10, 10), [16, 16, 32]);
  assert.deepEqual(pixel(256, 205), [255, 204, 0]); assert.deepEqual(pixel(10, 500), [32, 48, 96]); assert.deepEqual(pixel(256, 410), [255, 255, 255]);
  assert.ok(a.length < 10 * 1024, `small simple PNG: ${a.length}`);
});
test('server world/receipt metadata isolates identical pixels without changing their deterministic appearance', () => {
  const a=rasterizePainting(picture,{worldId:'one',receiptId:'r_one'}),again=rasterizePainting(picture,{worldId:'one',receiptId:'r_one'}),b=rasterizePainting(picture,{worldId:'one',receiptId:'r_two'}),c=rasterizePainting(picture,{worldId:'two',receiptId:'r_one'});
  assert.deepEqual(a,again);
  const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');assert.notEqual(hash(a),hash(b));assert.notEqual(hash(a),hash(c));
  const pixels=(v:Buffer)=>{const data:Buffer[]=[];for(let at=8;at<v.length;){const size=v.readUInt32BE(at);if(v.toString('ascii',at+4,at+8)==='IDAT')data.push(v.subarray(at+8,at+8+size));at+=size+12;}return inflateSync(Buffer.concat(data));};
  assert.deepEqual(pixels(a),pixels(b));assert.deepEqual(pixels(a),pixels(c));
  assert.match(a.toString('latin1'),/Painting\x00\{"worldId":"one","receiptId":"r_one","renderer":"painting-rgb\/1"\}/);
});
