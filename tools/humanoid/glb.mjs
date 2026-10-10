// Minimal glTF 2.0 binary writer for the humanoid kit: nodes, meshes (one primitive), one skin, animations.
// Byte-identical buffer views are stored once (clip tracks repeat a lot); everything is 4-byte aligned.
// Integer/normalized vertex attributes use KHR_mesh_quantization (supported by three's GLTFLoader).
import {createHash} from 'node:crypto';

const GL = {BYTE: 5120, UNSIGNED_BYTE: 5121, SHORT: 5122, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125, FLOAT: 5126};
const TYPE = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'};
const componentOf = a => a instanceof Float32Array ? GL.FLOAT : a instanceof Int8Array ? GL.BYTE : a instanceof Uint8Array ? GL.UNSIGNED_BYTE
  : a instanceof Int16Array ? GL.SHORT : a instanceof Uint16Array ? GL.UNSIGNED_SHORT : a instanceof Uint32Array ? GL.UNSIGNED_INT : null;

export class GlbWriter {
  constructor(generator = 'eden humanoid kit') {
    this.json = {asset: {version: '2.0', generator}, scene: 0, scenes: [{nodes: []}], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{byteLength: 0}]};
    this.chunks = []; this.length = 0; this.views = new Map(); this.accessors = new Map(); this.quantized = false;
  }
  /** One buffer view per distinct byte content (and target / stride). */
  view(bytes, {target, byteStride} = {}) {
    const key = createHash('sha1').update(bytes).digest('hex') + ':' + (target ?? '') + ':' + (byteStride ?? '');
    if (this.views.has(key)) return this.views.get(key);
    const pad = (4 - (this.length % 4)) % 4; if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const bv = {buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? {target} : {}), ...(byteStride ? {byteStride} : {})};
    this.chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); this.length += bytes.byteLength;
    const i = this.json.bufferViews.push(bv) - 1; this.views.set(key, i); return i;
  }
  /** Raw bytes in the BIN chunk (deduplicated, 4-byte aligned) with no buffer view; returns the byte offset.
   *  Used for the rig's compact clip table, which the composer decodes itself. */
  raw(bytes) {
    const b = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), key = 'raw:' + createHash('sha1').update(b).digest('hex');
    if (this.views.has(key)) return this.views.get(key);
    const pad = (4 - (this.length % 4)) % 4; if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const off = this.length; this.chunks.push(b); this.length += b.byteLength; this.views.set(key, off); return off;
  }
  /** Accessor over a typed array with `size` components per element. Vertex attributes of 1/2-byte components
   *  with sizes not filling 4 bytes are padded into a strided view. min/max only where glTF requires them. */
  accessor(array, size, {normalized = false, minmax = false, target, vertex = false} = {}) {
    const componentType = componentOf(array); if (!componentType) throw Error('unsupported array type');
    const count = array.length / size; if (!Number.isInteger(count)) throw Error('array length not a multiple of size');
    let bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength), byteStride;
    const elem = array.BYTES_PER_ELEMENT * size;
    if (vertex && elem % 4) { // pad each element to a multiple of 4 bytes (glTF vertex stride rule)
      byteStride = Math.ceil(elem / 4) * 4; const out = new Uint8Array(byteStride * count);
      for (let i = 0; i < count; i++) out.set(bytes.subarray(i * elem, (i + 1) * elem), i * byteStride);
      bytes = out;
    }
    const acc = {bufferView: this.view(bytes, {target, byteStride}), componentType, count, type: TYPE[size], ...(normalized ? {normalized: true} : {})};
    const key = JSON.stringify(acc) + minmax; // identical data → one accessor (clip channels share their key times)
    if (this.accessors.has(key)) return this.accessors.get(key);
    if (minmax) {
      const min = new Array(size).fill(Infinity), max = new Array(size).fill(-Infinity);
      for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) { const v = array[i * size + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
      acc.min = min; acc.max = max;
    }
    if (vertex && componentType !== GL.FLOAT) this.quantized = true;
    const i = this.json.accessors.push(acc) - 1; this.accessors.set(key, i); return i;
  }
  node(n) { return this.json.nodes.push(n) - 1; }
  /** mesh: {name, attributes: {NAME: {array, size, normalized?}}, indices: Uint16Array|Uint32Array, material?} */
  mesh({name, attributes, indices, extras}) {
    const attrs = {};
    for (const [k, a] of Object.entries(attributes)) attrs[k] = this.accessor(a.array, a.size, {normalized: !!a.normalized, minmax: k === 'POSITION', target: 34962, vertex: true});
    const prim = {attributes: attrs, indices: this.accessor(indices, 1, {target: 34963}), mode: 4};
    return this.json.meshes.push({name, primitives: [prim], ...(extras ? {extras} : {})}) - 1;
  }
  skin({joints, inverseBindMatrices, name}) {
    this.json.skins ??= [];
    return this.json.skins.push({name, joints, inverseBindMatrices: this.accessor(inverseBindMatrices, 16)}) - 1;
  }
  /** animation: {name, channels: [{node, path, interpolation, times: Float32Array, values: TypedArray, size, normalized?}]} */
  animation({name, channels}) {
    this.json.animations ??= [];
    const samplers = [], out = [];
    for (const c of channels) {
      const input = this.accessor(c.times, 1, {minmax: true}), output = this.accessor(c.values, c.size, {normalized: !!c.normalized});
      const s = samplers.push({input, output, interpolation: c.interpolation}) - 1;
      out.push({sampler: s, target: {node: c.node, path: c.path}});
    }
    return this.json.animations.push({name, samplers, channels: out}) - 1;
  }
  finish(extras) {
    const j = this.json; if (!j.meshes.length) delete j.meshes; if (extras) j.extras = extras;
    if (this.quantized) { j.extensionsUsed = ['KHR_mesh_quantization']; j.extensionsRequired = ['KHR_mesh_quantization']; }
    const pad = (4 - (this.length % 4)) % 4; if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    j.buffers[0].byteLength = this.length;
    let text = new TextEncoder().encode(JSON.stringify(j)); const tpad = (4 - (text.length % 4)) % 4;
    if (tpad) { const t = new Uint8Array(text.length + tpad).fill(0x20); t.set(text); text = t; }
    const total = 12 + 8 + text.length + 8 + this.length, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, text.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
    let o = 20 + text.length; dv.setUint32(o, this.length, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
    for (const c of this.chunks) { out.set(c, o); o += c.byteLength; }
    return out;
  }
}
