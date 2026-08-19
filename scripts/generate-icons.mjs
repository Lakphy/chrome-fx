import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/icon');
const SIZES = [16, 32, 48, 96, 128];
const MASTER = 512;

function fillRect(grid, size, x, y, w, h) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(size, Math.ceil(x + w));
  const y1 = Math.min(size, Math.ceil(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) grid[py * size + px] = 255;
  }
}

function fillThickSegment(grid, size, x0, y0, x1, y1, thickness) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - thickness));
  const maxX = Math.min(size, Math.ceil(Math.max(x0, x1) + thickness));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - thickness));
  const maxY = Math.min(size, Math.ceil(Math.max(y0, y1) + thickness));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const half = thickness / 2;
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (len * len)));
      const dist = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      if (dist <= half) grid[y * size + x] = 255;
    }
  }
}

function drawFx(size) {
  const grid = new Uint8Array(size * size);
  const u = size / 32;
  fillRect(grid, size, 4.2 * u, 7 * u, 3.1 * u, 18 * u);
  fillRect(grid, size, 4.2 * u, 7 * u, 10.2 * u, 3.1 * u);
  fillRect(grid, size, 4.2 * u, 14.45 * u, 7.8 * u, 3.1 * u);
  fillThickSegment(grid, size, 18.4 * u, 8.2 * u, 27.8 * u, 23.8 * u, 3.2 * u);
  fillThickSegment(grid, size, 27.8 * u, 8.2 * u, 18.4 * u, 23.8 * u, 3.2 * u);
  return grid;
}

function downsample(src, srcSize, destSize) {
  const dest = new Uint8Array(destSize * destSize);
  const scale = srcSize / destSize;
  for (let y = 0; y < destSize; y += 1) {
    for (let x = 0; x < destSize; x += 1) {
      const x0 = Math.floor(x * scale);
      const y0 = Math.floor(y * scale);
      const x1 = Math.floor((x + 1) * scale);
      const y1 = Math.floor((y + 1) * scale);
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          sum += src[sy * srcSize + sx];
          count += 1;
        }
      }
      dest[y * destSize + x] = count === 0 ? 0 : Math.round(sum / count);
    }
  }
  return dest;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const header = Buffer.from(type);
  const payload = Buffer.concat([header, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  payload.copy(out, 4);
  out.writeUInt32BE(crc32(payload), 8 + data.length);
  return out;
}

function encodePng(mask, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const ink = mask[y * size + x];
      const i = row + 1 + x * 4;
      raw[i] = ink;
      raw[i + 1] = ink;
      raw[i + 2] = ink;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const master = drawFx(MASTER);
await mkdir(OUT, { recursive: true });
for (const size of SIZES) {
  const mask = size === MASTER ? master : downsample(master, MASTER, size);
  await writeFile(join(OUT, `${size}.png`), encodePng(mask, size));
}

await writeFile(
  join(ROOT, 'public/icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#000"/>
  <g fill="#fff">
    <rect x="4.2" y="7" width="3.1" height="18"/>
    <rect x="4.2" y="7" width="10.2" height="3.1"/>
    <rect x="4.2" y="14.45" width="7.8" height="3.1"/>
  </g>
  <g stroke="#fff" stroke-width="3.2" stroke-linecap="square">
    <line x1="18.4" y1="8.2" x2="27.8" y2="23.8"/>
    <line x1="27.8" y1="8.2" x2="18.4" y2="23.8"/>
  </g>
</svg>
`,
);

console.log(`wrote ${SIZES.map((size) => `icon/${size}.png`).join(', ')}`);
