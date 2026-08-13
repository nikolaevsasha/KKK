#!/usr/bin/env node
/*
 * Generates the app icons (PNG) with no dependencies.
 * Draws the Finch mark — navy rounded square, coral trend line — by
 * evaluating signed distances per pixel, then encodes PNG via zlib.
 * Run: node tools/make-icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

const BG = [0x0c, 0x1f, 0x30];
const CORAL = [0xeb, 0x68, 0x34];

// Geometry in a 48x48 design space (matches icon.svg).
const LINE = [[10, 32], [18, 23], [25, 27], [38, 13]];
const DOT = { x: 38, y: 13, r: 3.4 };
const STROKE = 3.5 / 2;

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size, { corner = true } = {}) {
  const scale = size / 48;
  const radius = 11 * scale;
  const px = Buffer.alloc(size * size * 4);
  const aa = 1.0; // antialias band in pixels

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;

      // Rounded-rect coverage (alpha) — or full square for maskable/apple.
      let cover = 1;
      if (corner) {
        const rx = Math.max(0, Math.max(radius - cx, cx - (size - radius)));
        const ry = Math.max(0, Math.max(radius - cy, cy - (size - radius)));
        if (rx > 0 && ry > 0) {
          const d = Math.hypot(rx, ry) - radius;
          cover = Math.max(0, Math.min(1, 0.5 - d / aa));
        }
      }

      // Design-space coordinates.
      const dxp = cx / scale, dyp = cy / scale;

      // Trend line distance.
      let d = Infinity;
      for (let i = 0; i < LINE.length - 1; i++) {
        d = Math.min(d, distToSegment(dxp, dyp, LINE[i][0], LINE[i][1], LINE[i + 1][0], LINE[i + 1][1]));
      }
      const lineA = Math.max(0, Math.min(1, (STROKE - d) * scale / aa + 0.5));

      // End dot (with a bg-colored ring so it reads at the line end).
      const dd = Math.hypot(dxp - DOT.x, dyp - DOT.y);
      const dotA = Math.max(0, Math.min(1, (DOT.r - dd) * scale / aa + 0.5));
      const ringA = Math.max(0, Math.min(1, (DOT.r + 1.0 - dd) * scale / aa + 0.5)) - dotA;

      // Composite: bg -> line -> ring(bg) -> dot
      let r = BG[0], g = BG[1], b = BG[2];
      const mix = (c, a) => { r = r * (1 - a) + c[0] * a; g = g * (1 - a) + c[1] * a; b = b * (1 - a) + c[2] * a; };
      mix(CORAL, lineA);
      mix(BG, ringA);
      mix(CORAL, dotA);

      const o = (y * size + x) * 4;
      px[o] = Math.round(r); px[o + 1] = Math.round(g); px[o + 2] = Math.round(b);
      px[o + 3] = Math.round(cover * 255);
    }
  }
  return px;
}

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [size, corner, name] of [
  [180, false, 'icon-180.png'], // apple-touch-icon: iOS rounds it itself
  [192, true, 'icon-192.png'],
  [512, true, 'icon-512.png'],
]) {
  const png = encodePNG(render(size, { corner }), size);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
