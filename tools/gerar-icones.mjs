// Gera os ícones PNG do app (sem dependências). Uso:  node tools/gerar-icones.mjs
// Desenho: cantos de visor de câmera + pino de localização, amarelo de obra sobre preto.
// Coordenadas em uma grade de 512×512.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const BG = [17, 17, 19];
const FG = [255, 196, 0];

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && Math.hypot(x - cx, y - cy) <= r;
}

// Pino: círculo + triângulo tangente até a ponta, menos o furo.
const PIN = { cx: 256, cy: 226, r: 80, tipY: 356, hole: 31 };
function inPin(x, y) {
  const { cx, cy, r, tipY, hole } = PIN;
  if (Math.hypot(x - cx, y - cy) <= hole) return false;
  if (Math.hypot(x - cx, y - cy) <= r) return true;
  if (y < cy || y > tipY) return false;
  // largura do cone: tangente do círculo até a ponta
  const d = tipY - cy;
  const tanLen = Math.sqrt(d * d - r * r);
  const ty = cy + (r * r) / d; // altura dos pontos de tangência
  const tx = (r * tanLen) / d; // meia-largura nos pontos de tangência
  if (y < ty) return Math.abs(x - cx) <= tx || Math.hypot(x - cx, y - cy) <= r;
  return Math.abs(x - cx) <= (tx * (tipY - y)) / (tipY - ty);
}

const CORNERS = (() => {
  const a = 112, b = 400, L = 70;
  const segs = [];
  for (const [x, y, dx, dy] of [[a, a, 1, 1], [b, a, -1, 1], [a, b, 1, -1], [b, b, -1, -1]]) {
    segs.push([x + dx * L, y, x, y], [x, y, x, y + dy * L]);
  }
  return segs;
})();
const inCorners = (x, y) => CORNERS.some(([ax, ay, bx, by]) => segDist(x, y, ax, ay, bx, by) <= 13);

/** Cor de um ponto da grade 512 (ou null = transparente). */
function shade(x, y, { full, safe }) {
  const inBg = full ? x >= 0 && x <= 512 && y >= 0 && y <= 512 : inRoundRect(x, y, 16, 16, 496, 496, 108);
  if (!inBg) return null;
  // aplica a escala da área segura em torno do centro
  const ux = 256 + (x - 256) / safe;
  const uy = 256 + (y - 256) / safe;
  return inCorners(ux, uy) || inPin(ux, uy) ? FG : BG;
}

function render(size, opts) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((i + (sx + 0.5) / SS) * 512) / size;
          const y = ((j + (sy + 0.5) / SS) * 512) / size;
          const c = shade(x, y, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const o = (j * size + i) * 4;
      const n = SS * SS;
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, px);
}

// ---- PNG ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const jobs = {
  'icon-192.png': [192, { full: false, safe: 1 }],
  'icon-512.png': [512, { full: false, safe: 1 }],
  'icon-maskable-512.png': [512, { full: true, safe: 0.78 }],
  'apple-touch-icon.png': [180, { full: true, safe: 0.86 }],
};
for (const [name, [size, opts]] of Object.entries(jobs)) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log('ok', name);
}
