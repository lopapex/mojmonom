import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const palette = {
  bg: [13, 31, 55, 255],
  bgLight: [22, 54, 94, 255],
  wood: [135, 73, 31, 255],
  woodLight: [190, 122, 52, 255],
  gold: [232, 172, 62, 255],
  goldLight: [255, 220, 132, 255],
  goldDark: [183, 116, 39, 255]
};

function createCanvas(size) {
  return new Uint8Array(size * size * 4).fill(0);
}

function blendPixel(data, size, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const a = Math.max(0, Math.min(1, alpha)) * (color[3] / 255);
  data[i] = Math.round(data[i] * (1 - a) + color[0] * a);
  data[i + 1] = Math.round(data[i + 1] * (1 - a) + color[1] * a);
  data[i + 2] = Math.round(data[i + 2] * (1 - a) + color[2] * a);
  data[i + 3] = 255;
}

function fillRoundedRect(data, size, x, y, w, h, r, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      const dx = Math.max(x - px, 0, px - (x + w - 1));
      const dy = Math.max(y - py, 0, py - (y + h - 1));
      const cornerX = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
      const cornerY = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
      const inCorner = Math.hypot(px - cornerX, py - cornerY) <= r;
      if ((dx === 0 && dy === 0 && inCorner) || (px >= x + r && px <= x + w - r) || (py >= y + r && py <= y + h - r)) {
        blendPixel(data, size, px, py, color);
      }
    }
  }
}

function drawCircleStroke(data, size, cx, cy, radius, width, color, opacity = 1) {
  const min = Math.floor(cx - radius - width);
  const max = Math.ceil(cx + radius + width);
  for (let y = min; y <= max; y += 1) {
    for (let x = min; x <= max; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const edge = Math.abs(d - radius);
      if (edge <= width / 2) {
        blendPixel(data, size, x, y, color, opacity * Math.min(1, width / 2 - edge + 1));
      }
    }
  }
}

function drawArcStroke(data, size, cx, cy, radius, width, start, end, color) {
  const min = Math.floor(cx - radius - width);
  const max = Math.ceil(cx + radius + width);
  for (let y = min; y <= max; y += 1) {
    for (let x = min; x <= max; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
      const inArc = normalized >= start && normalized <= end;
      const d = Math.hypot(x - cx, y - cy);
      const edge = Math.abs(d - radius);
      if (inArc && edge <= width / 2) {
        blendPixel(data, size, x, y, color, Math.min(1, width / 2 - edge + 1));
      }
    }
  }
}

function drawLine(data, size, x1, y1, x2, y2, width, color) {
  const minX = Math.floor(Math.min(x1, x2) - width);
  const maxX = Math.ceil(Math.max(x1, x2) + width);
  const minY = Math.floor(Math.min(y1, y2) - width);
  const maxY = Math.ceil(Math.max(y1, y2) + width);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSq));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d <= width / 2) {
        blendPixel(data, size, x, y, color, Math.min(1, width / 2 - d + 1));
      }
    }
  }
}

function drawQuadratic(data, size, x1, y1, cx, cy, x2, y2, width, color) {
  let prevX = x1;
  let prevY = y1;
  for (let i = 1; i <= 42; i += 1) {
    const t = i / 42;
    const mt = 1 - t;
    const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    drawLine(data, size, prevX, prevY, x, y, width, color);
    prevX = x;
    prevY = y;
  }
}

function drawFilledCircle(data, size, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) blendPixel(data, size, x, y, color, Math.min(1, radius - d + 1));
    }
  }
}

function fillBackground(data, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (size * 2);
      const color = [
        Math.round(palette.bgLight[0] * (1 - t) + palette.bg[0] * t),
        Math.round(palette.bgLight[1] * (1 - t) + palette.bg[1] * t),
        Math.round(palette.bgLight[2] * (1 - t) + palette.bg[2] * t),
        255
      ];
      blendPixel(data, size, x, y, color);
    }
  }
}

function drawRotatedRect(data, size, cx, cy, w, h, angle, radius, color) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = Math.ceil(Math.hypot(w, h) / 2 + radius);
  for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y += 1) {
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x += 1) {
      const rx = (x - cx) * cos + (y - cy) * sin;
      const ry = -(x - cx) * sin + (y - cy) * cos;
      const qx = Math.abs(rx) - w / 2 + radius;
      const qy = Math.abs(ry) - h / 2 + radius;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      if (outside + inside <= radius) {
        blendPixel(data, size, x, y, color);
      }
    }
  }
}

function crcTable() {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const table = crcTable();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function renderIcon(size, maskable = false) {
  const data = createCanvas(size);
  const s = size / 512;
  fillBackground(data, size);
  drawLine(data, size, 151 * s, 376 * s, 207 * s, 150 * s, 23 * s, palette.wood);
  drawQuadratic(data, size, 207 * s, 150 * s, 226 * s, 96 * s, 256 * s, 96 * s, 23 * s, palette.woodLight);
  drawQuadratic(data, size, 256 * s, 96 * s, 286 * s, 96 * s, 305 * s, 150 * s, 23 * s, palette.woodLight);
  drawLine(data, size, 305 * s, 150 * s, 361 * s, 376 * s, 23 * s, palette.wood);
  fillRoundedRect(data, size, 230 * s, 122 * s, 52 * s, 238 * s, 26 * s, palette.gold);
  fillRoundedRect(data, size, 154 * s, 351 * s, 204 * s, 50 * s, 12 * s, palette.wood);
  drawLine(data, size, 171 * s, 365 * s, 198 * s, 258 * s, 24 * s, palette.goldLight);
  drawLine(data, size, 198 * s, 258 * s, 256 * s, 376 * s, 24 * s, palette.gold);
  drawLine(data, size, 256 * s, 376 * s, 314 * s, 258 * s, 24 * s, palette.gold);
  drawLine(data, size, 314 * s, 258 * s, 342 * s, 365 * s, 24 * s, palette.goldLight);
  drawLine(data, size, 259 * s, 376 * s, 378 * s, 160 * s, 16 * s, palette.goldLight);
  drawRotatedRect(data, size, 354.5 * s, 260.5 * s, 39 * s, 39 * s, 25 * Math.PI / 180, 8 * s, palette.gold);
  drawLine(data, size, 166 * s, 405 * s, 201 * s, 405 * s, 13 * s, palette.gold);
  drawLine(data, size, 311 * s, 405 * s, 346 * s, 405 * s, 13 * s, palette.gold);
  return encodePng(size, size, data);
}

writeFileSync(join(outDir, 'icon-192.png'), renderIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), renderIcon(512));
writeFileSync(join(outDir, 'icon-maskable-512.png'), renderIcon(512, true));
writeFileSync(join(outDir, 'apple-touch-icon.png'), renderIcon(180));
