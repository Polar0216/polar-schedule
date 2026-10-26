// Deterministic raster versions of public/favicon.svg. No remote assets/dependency.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
const crc = (bytes) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
function chunk(name, data) { const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, checksum]); }
const star = [[32, 11], [37, 27], [53, 32], [37, 37], [32, 53], [27, 37], [11, 32], [27, 27]];
function inside(x, y) { let found = false; for (let i = 0, j = star.length - 1; i < star.length; j = i++) { const a = star[i], b = star[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) found = !found; } return found; }
await mkdir('public/icons', { recursive: true });
for (const [size, maskable] of [[180, false], [192, false], [512, false], [512, true]]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const channels = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) * 64 / size, py = (y + (sy + .5) / 4) * 64 / size;
      const dx = Math.max(18 - px, 0, px - 46), dy = Math.max(18 - py, 0, py - 46);
      if (!maskable && dx * dx + dy * dy > 18 * 18) continue;
      const color = inside(px, py) ? [255, 255, 255] : [105, 97, 217];
      for (let i = 0; i < 3; i++) channels[i] += color[i]; channels[3] += 255;
    }
    const index = y * (size * 4 + 1) + 1 + x * 4;
    for (let i = 0; i < 3; i++) raw[index + i] = channels[3] ? Math.round(channels[i] * 255 / channels[3]) : 0;
    raw[index + 3] = Math.round(channels[3] / 16);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(`public/icons/${maskable ? 'maskable-' : 'icon-'}${size}.png`, png);
}
