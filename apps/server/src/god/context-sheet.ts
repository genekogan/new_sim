// Compose only our bounded renderer PNGs. No browser, asset fetch or image inference.
import { inflateSync, deflateSync } from 'node:zlib';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++)
        c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
} return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const name = Buffer.from(type), b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); name.copy(b, 4); data.copy(b, 8); b.writeUInt32BE(crc(Buffer.concat([name, data])), data.length + 8); return b; }
export function encodeContextPng(width: number, height: number, pixels: Uint8Array) {
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width);
    head.writeUInt32BE(height, 4);
    head[8] = 8;
    head[9] = 6;
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++)
        rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    return Buffer.concat([signature, chunk('IHDR', head), chunk('IDAT', deflateSync(rows, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
export function decodeContextPng(bytes: Uint8Array) {
    const png = Buffer.from(bytes);
    if (!png.subarray(0, 8).equals(signature) || png.length < 33)
        throw new Error('invalid context PNG');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
    if (width < 1 || height < 1 || width > 640 || height > 448 || png[24] !== 8 || !channels || png[28] !== 0)
        throw new Error('unsupported context PNG');
    const pieces: Buffer[] = [];
    for (let at = 8; at + 12 <= png.length;) {
        const length = png.readUInt32BE(at);
        if (at + length + 12 > png.length)
            throw new Error('truncated context PNG');
        if (png.toString('ascii', at + 4, at + 8) === 'IDAT')
            pieces.push(png.subarray(at + 8, at + 8 + length));
        at += length + 12;
    }
    const stride = width * channels, raw = inflateSync(Buffer.concat(pieces), { maxOutputLength: (stride + 1) * height });
    if (raw.length !== (stride + 1) * height)
        throw new Error('invalid context rows');
    const decoded = Buffer.alloc(stride * height), pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        if (filter > 4)
            throw new Error('invalid PNG filter');
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? decoded[y * stride + x - channels] : 0, b = y ? decoded[(y - 1) * stride + x] : 0, c = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0, p = a + b - c;
            const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
            decoded[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
        }
    }
    for (let i = 0; i < width * height; i++) {
        pixels[i * 4] = decoded[i * channels];
        pixels[i * 4 + 1] = decoded[i * channels + 1];
        pixels[i * 4 + 2] = decoded[i * channels + 2];
        pixels[i * 4 + 3] = channels === 4 ? decoded[i * channels + 3] : 255;
    }
    return { width, height, pixels };
}
// Tiny built-in glyphs keep labels deterministic without fonts or extra rendering.
const indexDigits = ['010111010010111', '111001111100111', '111001111001111',
    '101101111001001', '111100111001111', '111100111101111'];
function indexBadge(pixels: Buffer, width: number, x: number, y: number, index: number) {
    const glyph = indexDigits[index];
    for (let row = 0; row < 24; row++) {
        for (let col = 0; col < 24; col++) {
            const gx = Math.floor((col - 8) / 3), gy = Math.floor((row - 4) / 3);
            const ink = gx >= 0 && gx < 3 && gy >= 0 && gy < 5 && glyph[gy * 3 + gx] === '1';
            const border = row === 0 || col === 0 || row === 23 || col === 23;
            const value = ink || border ? 255 : 24;
            const at = ((y + row) * width + x + col) * 4;
            pixels.set([value, value, value, 255], at);
        }
    }
}
export function contextSheet(images: readonly Uint8Array[]) {
    if (!images.length || images.length > 6)
        throw new Error('one to six pictures required');
    const cols = Math.min(3, images.length), width = cols * 320, height = Math.ceil(images.length / cols) * 224, pixels = Buffer.alloc(width * height * 4, 255);
    const tiles = images.map((image, index) => {
        const decoded = decodeContextPng(image), x = (index % cols) * 320, y = Math.floor(index / cols) * 224;
        for (let row = 0; row < 224; row++)
            for (let col = 0; col < 320; col++) {
                const from = (Math.floor(row * decoded.height / 224) * decoded.width + Math.floor(col * decoded.width / 320)) * 4, to = ((y + row) * width + x + col) * 4;
                pixels.set(decoded.pixels.subarray(from, from + 4), to);
            }
        indexBadge(pixels, width, x + 6, y + 6, index);
        return { index: index + 1, x, y, width: 320, height: 224 };
    });
    return { png: encodeContextPng(width, height, pixels), tiles, width, height };
}
