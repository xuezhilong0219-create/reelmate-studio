import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, ROOT, uid } from '../server/db.mjs';
import { runFF } from './ffmpeg.mjs';
import { hashSeed } from '../server/util.mjs';
import {
  canvas, fillLinear, addGlow, addVignette, addNoise, rect,
  scanlines, encodePNG, hexToRgb, mixRGB
} from './raster.mjs';

export const PALETTES = [
  { name: '午夜蓝', bg: ['#03060f', '#12306b', '#04070e'], accent: '#5ec8ff', warm: '#ffd166' },
  { name: '赛博紫', bg: ['#100418', '#5c1f74', '#130520'], accent: '#ff6b9d', warm: '#ffd93d' },
  { name: '幽绿', bg: ['#02100d', '#0d5241', '#02110e'], accent: '#2dd4bf', warm: '#fbbf24' },
  { name: '暗红', bg: ['#110407', '#5f1023', '#120408'], accent: '#f43f5e', warm: '#fde68a' },
  { name: '灰阶', bg: ['#08080a', '#2f2f39', '#09090b'], accent: '#a5b4fc', warm: '#f472b6' },
  { name: '钢青', bg: ['#08101c', '#2b3f57', '#070d16'], accent: '#38bdf8', warm: '#e2e8f0' },
  { name: '暖褐', bg: ['#140f0b', '#483528', '#150f0b'], accent: '#d6a86b', warm: '#f59e0b' },
  { name: '深海', bg: ['#000c14', '#00435f', '#000d16'], accent: '#00c2a8', warm: '#ffeb99' },
  { name: '晨曦', bg: ['#180e2b', '#8e4d6d', '#f3ab6b'], accent: '#ffe3b3', warm: '#ff8a5c' },
  { name: '雪原', bg: ['#0a131c', '#4f6f86', '#cbdcEC'.toLowerCase()], accent: '#ffffff', warm: '#8fd3ff' },
  { name: '夜火', bg: ['#0c0603', '#5a2a08', '#0b0503'], accent: '#ff9f1c', warm: '#ffd60a' },
  { name: '薄雾', bg: ['#0e1418', '#5b6c74', '#0d1215'], accent: '#cfe8f3', warm: '#9fb8c4' },
];

const STYLE = {
  cinematic: { glow: 7, grain: 8, vig: 0.58, scan: 0, rain: 0, stars: 3 },
  anime: { glow: 9, grain: 3, vig: 0.32, scan: 0, rain: 0, stars: 4 },
  ink: { glow: 3, grain: 12, vig: 0.62, scan: 0, rain: 0, stars: 2 },
  cyber: { glow: 10, grain: 11, vig: 0.64, scan: 0.13, rain: 26, stars: 2 },
  warm: { glow: 6, grain: 6, vig: 0.44, scan: 0, rain: 0, stars: 2 },
  noir: { glow: 4, grain: 15, vig: 0.72, scan: 0.06, rain: 12, stars: 1 },
  retro: { glow: 6, grain: 17, vig: 0.52, scan: 0.18, rain: 0, stars: 2 },
  clean: { glow: 4, grain: 2, vig: 0.26, scan: 0, rain: 0, stars: 1 },
  horror: { glow: 3, grain: 16, vig: 0.8, scan: 0.04, rain: 18, stars: 1 },
  romance: { glow: 8, grain: 4, vig: 0.34, scan: 0, rain: 0, stars: 3 },
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function pickPalette(text, style) {
  return PALETTES[hashStr(String(text || '') + '|' + style) % PALETTES.length];
}

function lerpRow(cv, y, color, alpha = 1) {
  const W = cv.width, d = cv.data;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    d[i] = d[i] * (1 - alpha) + color[0] * alpha;
    d[i + 1] = d[i + 1] * (1 - alpha) + color[1] * alpha;
    d[i + 2] = d[i + 2] * (1 - alpha) + color[2] * alpha;
  }
}

/** 城市天际线剪影 */
function skyline(cv, rnd, baseY, color, scale) {
  const W = cv.width, H = cv.height;
  let x = -20;
  while (x < W + 20) {
    const w = Math.round(W * (0.015 + rnd() * 0.05) * scale);
    const h = Math.round(H * (0.05 + rnd() * 0.3) * scale);
    rect(cv, x, baseY - h, w, h + 2, [...color, 0.92]);
    if (rnd() > 0.55) {
      // 楼顶天线
      rect(cv, x + w / 2, baseY - h - H * 0.03, Math.max(1, w * 0.06), H * 0.03, [...color, 0.9]);
    }
    // 窗户点点
    const cols = Math.max(1, Math.floor(w / 8));
    const rows = Math.max(1, Math.floor(h / 12));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() > 0.22) continue;
        const wx = x + 3 + c * 8, wy = baseY - h + 4 + r * 12;
        if (wy > baseY - 3) continue;
        rect(cv, wx, wy, 2, 3, [255, 233, 180, 0.5 + rnd() * 0.5]);
      }
    }
    x += w + Math.round(rnd() * W * 0.02);
  }
}

/** 山脊线（平滑起伏 + 雾化） */
function ridge(cv, rnd, baseY, color, amp, alpha, smooth) {
  const W = cv.width, H = cv.height;
  const step = Math.max(3, Math.floor(W / 160));
  const ctrl = [];
  for (let x = 0; x <= W + step; x += step) {
    ctrl.push([x, baseY - (Math.sin(x / W * Math.PI * 1.7 + rnd() * 0.9) * 0.55 + Math.sin(x / W * Math.PI * 4.3 + rnd() * 2.1) * 0.3 + rnd() * 0.15) * amp]);
  }
  const yAt = (x) => {
    let i = Math.min(ctrl.length - 2, Math.floor(x / step));
    const [x0, y0] = ctrl[i], [x1, y1] = ctrl[i + 1];
    const t = (x - x0) / Math.max(1, x1 - x0);
    const tt = t * t * (3 - 2 * t);
    return y0 + (y1 - y0) * tt;
  };
  for (let x = 0; x < W; x++) {
    const yTop = Math.round(yAt(x));
    const fade = Math.round(H * 0.012);
    for (let y = Math.max(0, yTop - fade); y < H; y++) {
      const a = y < yTop ? alpha * (1 - (yTop - y) / fade) : alpha;
      if (a <= 0) continue;
      const i = (y * W + x) * 4;
      cv.data[i] = cv.data[i] * (1 - a) + color[0] * a;
      cv.data[i + 1] = cv.data[i + 1] * (1 - a) + color[1] * a;
      cv.data[i + 2] = cv.data[i + 2] * (1 - a) + color[2] * a;
    }
  }
}

/** 雨丝 */
function rain(cv, rnd, count, color) {
  const W = cv.width, H = cv.height;
  for (let i = 0; i < count; i++) {
    const x = rnd() * W, y = rnd() * H;
    const len = 12 + rnd() * 46;
    const a = 0.10 + rnd() * 0.30;
    for (let k = 0; k < len; k++) {
      const px = Math.round(x + k * 0.28), py = Math.round(y + k);
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const idx = (py * W + px) * 4;
      cv.data[idx] = cv.data[idx] * (1 - a) + color[0] * a;
      cv.data[idx + 1] = cv.data[idx + 1] * (1 - a) + color[1] * a;
      cv.data[idx + 2] = cv.data[idx + 2] * (1 - a) + color[2] * a;
    }
  }
}

/** 星点 */
function stars(cv, rnd, density, color) {
  const W = cv.width, H = cv.height;
  const n = Math.round(W * H * density / 100000);
  for (let i = 0; i < n; i++) {
    const x = Math.round(rnd() * W), y = Math.round(rnd() * H * 0.62);
    const b = 0.3 + rnd() * 0.7;
    const idx = (y * W + x) * 4;
    cv.data[idx] = cv.data[idx] * (1 - b) + color[0] * b;
    cv.data[idx + 1] = cv.data[idx + 1] * (1 - b) + color[1] * b;
    cv.data[idx + 2] = cv.data[idx + 2] * (1 - b) + color[2] * b;
  }
}

/** 镜头光晕 */
function lensFlare(cv, rnd, accent, warm) {
  const W = cv.width, H = cv.height;
  const fx = W * (0.2 + rnd() * 0.6), fy = H * (0.12 + rnd() * 0.3);
  addGlow(cv, fx, fy, Math.min(W, H) * 0.34, accent, 0.7);
  addGlow(cv, fx, fy, Math.min(W, H) * 0.10, [255, 255, 255], 0.75);
  for (let i = 1; i <= 4; i++) {
    const cx = fx - (fx - W / 2) * (i * 0.55);
    const cy = fy - (fy - H / 2) * (i * 0.55);
    addGlow(cv, cx, cy, Math.min(W, H) * (0.05 + i * 0.02), i % 2 ? warm : accent, 0.16);
  }
}

function compose(cv, rnd, pal, style, opts) {
  const W = cv.width, H = cv.height;
  const bg = pal.bg.map(hexToRgb);
  const accent = hexToRgb(pal.accent), warm = hexToRgb(pal.warm);
  const hint = STYLE[style] || STYLE.cinematic;

  fillLinear(cv, [[0, ...bg[0]], [0.55, ...bg[1]], [1, ...bg[2]]], 115 + rnd() * 70);

  if (hint.stars) stars(cv, rnd, hint.stars, [220, 235, 255]);

  // 大范围氛围光
  for (let i = 0; i < 3 + Math.floor(rnd() * 3); i++) {
    addGlow(cv, rnd() * W, rnd() * H * 0.8, (0.2 + rnd() * 0.4) * Math.min(W, H), rnd() > 0.62 ? accent : warm, 0.10 + rnd() * 0.20);
  }

  const mode = opts.scene || ['city', 'nature', 'abstract', 'interior'][Math.floor(rnd() * 4)];

  if (mode === 'city') {
    const hy = Math.round(H * (0.66 + rnd() * 0.1));
    // 远景雾
    for (let y = Math.round(H * 0.3); y < hy; y++) {
      const t = 1 - Math.abs(y - H * 0.3) / (hy - H * 0.3);
      lerpRow(cv, y, mixRGB(bg[1], accent, 0.35), 0.03 + t * 0.1);
    }
    skyline(cv, rnd, hy, [3, 5, 9], 0.7);
    skyline(cv, rnd, hy + Math.round(H * 0.03), [1, 2, 5], 1.25);
  } else if (mode === 'nature') {
    ridge(cv, rnd, Math.round(H * 0.52), mixRGB(bg[1], accent, 0.45), H * 0.10, 0.32);
    ridge(cv, rnd, Math.round(H * 0.68), mixRGB(bg[0], bg[1], 0.45), H * 0.07, 0.62);
    ridge(cv, rnd, Math.round(H * 0.85), mixRGB(bg[0], [0, 0, 0], 0.4), H * 0.05, 0.94);
    // 水面反光
    for (let y = Math.round(H * 0.86); y < H; y++) {
      const t = (y - H * 0.86) / (H * 0.14);
      lerpRow(cv, y, mixRGB(bg[1], warm, 0.35), 0.25 * (1 - t) * 0.7);
    }
  } else if (mode === 'interior') {
    // 室内：墙面渐变 + 窗框 + 地板反光 + 家具块
    const wx = W * (0.10 + rnd() * 0.10), wy = H * 0.14, ww = W * 0.24, wh = H * 0.38;
    const feather = Math.min(ww, wh) * 0.30;
    for (let y = Math.floor(wy - feather); y < wy + wh + feather; y++) {
      for (let x = Math.floor(wx - feather); x < wx + ww + feather; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = Math.max(0, Math.max(wx - x, x - (wx + ww)));
        const dy = Math.max(0, Math.max(wy - y, y - (wy + wh)));
        const d = Math.hypot(dx, dy);
        if (d > feather) continue;
        const fall = 1 - d / feather;
        const b = 0.42 * fall * fall;
        const i = (y * W + x) * 4;
        cv.data[i] = cv.data[i] * (1 - b) + warm[0] * b;
        cv.data[i + 1] = cv.data[i + 1] * (1 - b) + warm[1] * b;
        cv.data[i + 2] = cv.data[i + 2] * (1 - b) + warm[2] * b;
      }
    }
    // 窗芯高光
    for (let y = Math.floor(wy); y < wy + wh; y++) {
      for (let x = Math.floor(wx); x < wx + ww; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        const b = 0.30;
        cv.data[i] = cv.data[i] * (1 - b) + Math.min(255, warm[0] * 1.25) * b;
        cv.data[i + 1] = cv.data[i + 1] * (1 - b) + Math.min(255, warm[1] * 1.2) * b;
        cv.data[i + 2] = cv.data[i + 2] * (1 - b) + Math.min(255, warm[2] * 1.1) * b;
      }
    }
    // 窗框（十字 + 外框）
    const frameCol = [8, 9, 14, 0.9];
    rect(cv, wx - 4, wy - 4, ww + 8, 5, frameCol);
    rect(cv, wx - 4, wy + wh - 1, ww + 8, 5, frameCol);
    rect(cv, wx - 4, wy - 4, 5, wh + 8, frameCol);
    rect(cv, wx + ww - 1, wy - 4, 5, wh + 8, frameCol);
    rect(cv, wx + ww / 2 - 2, wy, 4, wh, frameCol);
    rect(cv, wx, wy + wh / 2 - 2, ww, 4, frameCol);
    // 地板
    const floorY = Math.round(H * 0.70);
    for (let y = floorY; y < H; y++) {
      const t = (y - floorY) / Math.max(1, H - floorY);
      lerpRow(cv, y, mixRGB(bg[0], [0, 0, 0], 0.35), 0.55 + t * 0.4);
    }
    rect(cv, 0, floorY, W, 2, [255, 255, 255, 0.06]);
    // 地板上的窗户反光
    const rx = wx + (rnd() - 0.5) * W * 0.05;
    for (let y = floorY; y < H; y++) {
      const t = (y - floorY) / Math.max(1, H - floorY);
      const spread = ww * (0.9 + t * 0.8);
      const cx = rx + ww / 2 + (rnd() - 0.5) * 3;
      for (let x = Math.floor(cx - spread / 2); x < cx + spread / 2; x++) {
        if (x < 0 || x >= W) continue;
        const k = 1 - Math.abs(x - cx) / (spread / 2);
        const b = 0.10 * k * k * (1 - t);
        const i = (y * W + x) * 4;
        cv.data[i] = cv.data[i] * (1 - b) + warm[0] * b;
        cv.data[i + 1] = cv.data[i + 1] * (1 - b) + warm[1] * b;
        cv.data[i + 2] = cv.data[i + 2] * (1 - b) + warm[2] * b;
      }
    }
    // 家具剪影
    const nF = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nF; i++) {
      const bw = W * (0.07 + rnd() * 0.15), bh = H * (0.06 + rnd() * 0.16);
      const bx = rnd() * (W - bw);
      rect(cv, bx, floorY - bh, bw, bh, [2, 3, 6, 0.86]);
      rect(cv, bx, floorY - bh, bw, 2, [255, 255, 255, 0.07]);
    }
  } else {
    // 抽象：斜向光带 + 同心弧 + 网格
    const cx = rnd() * W, cy = rnd() * H;
    for (let i = 0; i < 7; i++) {
      const ang = (rnd() * 180) * Math.PI / 180;
      const len = Math.max(W, H) * 1.6;
      const th = Math.max(1, Math.round(Math.min(W, H) * (0.002 + rnd() * 0.014)));
      const c = rnd() > 0.5 ? accent : warm;
      const alpha = 0.05 + rnd() * 0.16;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const px = -dy, py = dx;
      const ox = rnd() * W, oy = rnd() * H;
      for (let t = -len / 2; t < len / 2; t += 1) {
        for (let s2 = -th; s2 <= th; s2++) {
          const x = Math.round(ox + dx * t + px * s2);
          const y = Math.round(oy + dy * t + py * s2);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = (y * W + x) * 4;
          cv.data[i] = cv.data[i] * (1 - alpha) + c[0] * alpha;
          cv.data[i + 1] = cv.data[i + 1] * (1 - alpha) + c[1] * alpha;
          cv.data[i + 2] = cv.data[i + 2] * (1 - alpha) + c[2] * alpha;
        }
      }
    }
    const rings = 4 + Math.floor(rnd() * 5);
    for (let i = 1; i <= rings; i++) {
      const r = (Math.min(W, H) * 0.06) * i * (0.8 + rnd() * 0.6);
      const th = Math.max(1, Math.round(r * 0.02));
      const c = i % 2 ? accent : warm;
      const alpha = 0.10 + rnd() * 0.14;
      for (let y = Math.floor(cy - r - th); y <= cy + r + th; y++) {
        for (let x = Math.floor(cx - r - th); x <= cx + r + th; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (Math.abs(d - r) > th) continue;
          const i2 = (y * W + x) * 4;
          cv.data[i2] = cv.data[i2] * (1 - alpha) + c[0] * alpha;
          cv.data[i2 + 1] = cv.data[i2 + 1] * (1 - alpha) + c[1] * alpha;
          cv.data[i2 + 2] = cv.data[i2 + 2] * (1 - alpha) + c[2] * alpha;
        }
      }
    }
    // 细网格
    const gridC = accent;
    for (let x = 0; x < W; x += Math.round(W / 24)) rect(cv, x, 0, 1, H, [...gridC, 0.035]);
    for (let y = 0; y < H; y += Math.round(H / 14)) rect(cv, 0, y, W, 1, [...gridC, 0.035]);
  }

  if (hint.rain) rain(cv, rnd, hint.rain * 12, [200, 225, 255]);
  lensFlare(cv, rnd, accent, warm);
  addVignette(cv, hint.vig);
  if (hint.scan) scanlines(cv, 3, hint.scan);
  addNoise(cv, hint.grain, rnd);

  // 胶片划痕
  if (rnd() > 0.6) {
    const nScratch = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nScratch; i++) {
      const x = Math.round(rnd() * W);
      rect(cv, x, 0, 1, H, [255, 255, 255, 0.04 + rnd() * 0.06]);
    }
  }
}

/** 字幕条 + 安全框 */
function overlayGuides(cv, rnd, accent, opts) {
  const W = cv.width, H = cv.height;
  if (opts.safeFrame) {
    const m = Math.round(Math.min(W, H) * 0.045);
    rect(cv, m, m, W - m * 2, 1, [255, 255, 255, 0.18]);
    rect(cv, m, H - m - 1, W - m * 2, 1, [255, 255, 255, 0.18]);
    rect(cv, m, m, 1, H - m * 2, [255, 255, 255, 0.18]);
    rect(cv, W - m - 1, m, 1, H - m * 2, [255, 255, 255, 0.18]);
  }
  if (opts.withBar) {
    const barH = Math.round(H * 0.12);
    for (let y = H - barH; y < H; y++) {
      const t = (y - (H - barH)) / barH;
      lerpRow(cv, y, [0, 0, 0], 0.62 * Math.pow(1 - t, 1.5));
    }
    const mx = Math.round(W * 0.055);
    const by = H - barH;
    // 顶部渐隐分隔线 + 左侧强调段
    rect(cv, mx, by, W - mx * 2, 1, [255, 255, 255, 0.14]);
    rect(cv, mx, by, Math.round(W * 0.07), 2, [...accent, 0.9]);
    // 右侧角标刻度，填补空白
    const tickY = H - Math.round(barH * 0.34);
    for (let i = 0; i < 5; i++) {
      const th = Math.round(barH * (i === 4 ? 0.34 : 0.16 + i * 0.02));
      rect(cv, W - mx - 4 - i * 9, tickY - th, 2, th, [255, 255, 255, 0.18 + i * 0.05]);
    }
  }
}

function escText(s) { return String(s || '').replace(/[\r\n]+/g, ' ').trim(); }

function writeTextFile(text) {
  const p = path.join(ROOT, '.tmp', 'dt_' + uid('') + '.txt');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, escText(text), 'utf8');
  return p;
}

const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';
const FONT_BOLD = 'C\\:/Windows/Fonts/msyh.ttc';

/** 用 ffmpeg drawtext 叠加中文标题（PNG 里画不了中文，必须走 drawtext） */
export async function overlayText(srcPng, destPng, opts = {}) {
  const { title = '', subtitle = '', tag = '', width = 1280, height = 720 } = opts;
  const filters = [];
  const tmpFiles = [];
  const base = Math.round(Math.min(width, height) * 0.062);
  const marginX = Math.round(width * 0.055);
  let y = Math.round(height * 0.63);

  if (tag) {
    const f = writeTextFile(tag);
    tmpFiles.push(f);
    filters.push("drawtext=fontfile='" + FONT + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + Math.round(base * 0.42) + ":fontcolor=#FFD166:x=" + marginX + ":y=" + Math.round(y - base * 0.9) + ":shadowcolor=black@0.6:shadowx=1:shadowy=1");
  }
  if (title) {
    const f = writeTextFile(title);
    tmpFiles.push(f);
    filters.push("drawtext=fontfile='" + FONT + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + base + ":fontcolor=white@0.96:x=" + marginX + ":y=" + y + ":line_spacing=" + Math.round(base * 0.22) + ":shadowcolor=black@0.62:shadowx=3:shadowy=3");
  }
  if (subtitle) {
    const f = writeTextFile(subtitle);
    tmpFiles.push(f);
    filters.push("drawtext=fontfile='" + FONT_BOLD + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + Math.round(base * 0.4) + ":fontcolor=white@0.72:x=" + marginX + ":y=" + Math.round(y + base * 1.5) + ":line_spacing=6:shadowcolor=black@0.55:shadowx=2:shadowy=2");
  }
  if (!filters.length) { fs.copyFileSync(srcPng, destPng); return { ok: true }; }

  const r = await runFF(['-y', '-i', srcPng, '-vf', filters.join(','), destPng]);
  for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
  return r;
}

export async function renderImage(opts = {}) {
  const {
    prompt = '', title = '', subtitle = '', tag = '',
    width = 1280, height = 720,
    style = 'cinematic', seedText = '', index = 0,
    palette = null, safeFrame = false, withBar = null, variant = 0, scene = null,
  } = opts;

  const pal = typeof palette === 'string' ? (PALETTES.find(p => p.name === palette) || pickPalette(prompt, style)) : (palette || pickPalette(prompt || title, style));
  const seed = hashSeed([seedText || prompt || title || 'x', index, variant, style].join('|'));
  const rnd = rng(seed);
  const cv = canvas(width, height);
  compose(cv, rnd, pal, style, { scene });
  const hasText = !!(escText(title) || escText(subtitle));
  overlayGuides(cv, rnd, hexToRgb(pal.accent), { safeFrame, withBar: withBar === null ? hasText : !!withBar });

  const id = uid('img_');
  const rawPath = path.join(MEDIA, 'image', id + '_raw.png');
  const outPath = path.join(MEDIA, 'image', id + '.png');
  fs.writeFileSync(rawPath, encodePNG(cv.data, width, height));
  const r = await overlayText(rawPath, outPath, { title, subtitle, tag, width, height });
  try { fs.unlinkSync(rawPath); } catch {}
  if (!r.ok) return { id, file: rawPath, rel: '/media/image/' + id + '_raw.png', width, height, format: 'png', palette: pal.name };
  return { id, file: outPath, rel: '/media/image/' + id + '.png', width, height, format: 'png', palette: pal.name };
}

export async function renderImageSet(opts = {}, count = 4) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(await renderImage({ ...opts, index: i, variant: i }));
  return out;
}

export async function renderPlate(opts = {}) {
  const { width = 1280, height = 720, palette = null, style = 'cinematic', seedText = '', scene = null } = opts;
  const pal = palette ? (PALETTES.find(p => p.name === palette) || PALETTES[0]) : pickPalette(seedText, style);
  const rnd = rng(hashSeed(seedText + '|plate'));
  const cv = canvas(width, height);
  compose(cv, rnd, pal, style, { scene });
  addVignette(cv, 0.45);
  const id = uid('plate_');
  const outPath = path.join(MEDIA, 'image', id + '.png');
  fs.writeFileSync(outPath, encodePNG(cv.data, width, height));
  return { id, file: outPath, rel: '/media/image/' + id + '.png', width, height, format: 'png', palette: pal.name };
}
