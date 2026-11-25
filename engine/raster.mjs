import zlib from 'node:zlib';

/* ---------- 极简 PNG 编码器（RGBA8，无第三方依赖） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

export function encodePNG(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 像素画布 ---------- */
export function canvas(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function fillSolid(cv, rgba) {
  const [r, g, b, a] = rgba;
  const d = cv.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
}

export function fillLinear(cv, stops, angleDeg = 135) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const W = cv.width, H = cv.height, d = cv.data;
  const proj = (x, y) => (x * dx + y * dy);
  let min = Infinity, max = -Infinity;
  for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const v = proj(px, py); min = Math.min(min, v); max = Math.max(max, v);
  }
  const span = max - min || 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (proj(x, y) - min) / span;
      const c = sampleStops(stops, t);
      const i = (y * W + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
}

export function sampleStops(stops, t) {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < stops.length; i++) {
    if (tt <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const k = (tt - a[0]) / (b[0] - a[0] || 1);
      return [
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
        Math.round(a[3] + (b[3] - a[3]) * k)
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

/** 径向光斑叠加（screen 混合） */
export function addGlow(cv, cx, cy, radius, rgb, strength = 1) {
  const W = cv.width, H = cv.height, d = cv.data;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(H - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > r2) continue;
      const falloff = Math.pow(1 - Math.sqrt(dist2) / radius, 2.2) * strength;
      const i = (y * W + x) * 4;
      d[i] = Math.min(255, d[i] + rgb[0] * falloff);
      d[i + 1] = Math.min(255, d[i + 1] + rgb[1] * falloff);
      d[i + 2] = Math.min(255, d[i + 2] + rgb[2] * falloff);
    }
  }
}

/** 暗角 */
export function addVignette(cv, strength = 0.55) {
  const W = cv.width, H = cv.height, d = cv.data;
  const cx = W / 2, cy = H / 2, maxD = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = Math.hypot(x - cx, y - cy) / maxD;
      const k = 1 - strength * Math.pow(Math.max(0, t - 0.35) / 0.65, 1.8);
      const i = (y * W + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
}

/** 胶片颗粒 */
export function addNoise(cv, amount = 10, rnd = Math.random) {
  const d = cv.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount * 2;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
}

/** 半透明矩形（alpha 混合） */
export function rect(cv, x, y, w, h, rgba) {
  const W = cv.width, H = cv.height, d = cv.data;
  const [r, g, b, a] = rgba;
  const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(W, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4;
      d[i] = d[i] * (1 - a) + r * a;
      d[i + 1] = d[i + 1] * (1 - a) + g * a;
      d[i + 2] = d[i + 2] * (1 - a) + b * a;
    }
  }
}

/** 电视扫描线 */
export function scanlines(cv, step = 3, alpha = 0.12) {
  const W = cv.width, H = cv.height, d = cv.data;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      d[i] *= 1 - alpha; d[i + 1] *= 1 - alpha; d[i + 2] *= 1 - alpha;
    }
  }
}

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mixRGB(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
