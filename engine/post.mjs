import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, uid } from '../server/db.mjs';
import { runFF, probe } from './ffmpeg.mjs';
import { canvas, encodePNG, hexToRgb } from './raster.mjs';

/* 图片后期 / 视频统一：官方 imagePost.* 能力族的本地实现
   crop 裁剪 · outpaint 扩图 · splitGrid 宫格切分 · multiAngle 多角度
   panorama 全景 · storyGrid 剧情推演 · lineArt 抽帧转线稿 · palette 调色板
   annotate 标注 · relight 打光 · unifyVideo 帧率时长统一 */

const TMP = path.join(MEDIA, 'tmp');
const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';
const FONT_R = 'C\\:/Windows/Fonts/msyh.ttc';

export function outP(kind, ext) {
  const id = uid('m_');
  const dir = path.join(MEDIA, kind);
  fs.mkdirSync(dir, { recursive: true });
  return { id, file: path.join(dir, id + ext), rel: '/media/' + kind + '/' + id + ext };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------- 像素读写（PNG 解不了就用 ffmpeg 转 rawvideo） ---------- */
export async function loadRGBA(file, size) {
  const info = await probe(file);
  const st = ((info && info.streams) || []).find((s) => s.codec_type === 'video') || {};
  let W = Math.round(Number(st.width) || 1280);
  let H = Math.round(Number(st.height) || 720);
  if (size && size.w && size.h) { W = Math.round(size.w); H = Math.round(size.h); }
  fs.mkdirSync(TMP, { recursive: true });
  const tmp = path.join(TMP, uid('raw_') + '.rgba');
  const r = await runFF(['-y', '-i', file, '-vf', 'scale=' + W + ':' + H, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', tmp]);
  if (!r.ok) throw new Error('读取图像失败：' + String(r.log || '').slice(-160));
  const buf = fs.readFileSync(tmp);
  try { fs.unlinkSync(tmp); } catch {}
  const data = new Uint8ClampedArray(W * H * 4);
  data.set(buf.subarray(0, Math.min(buf.length, data.length)));
  return { W, H, data };
}

function savePNG(cv, kind = 'image') {
  const o = outP(kind, '.png');
  fs.writeFileSync(o.file, encodePNG(cv.data, cv.width, cv.height));
  return { file: o.file, rel: o.rel, width: cv.width, height: cv.height };
}

/** 双线性采样；越界按 clamp / mirror / wrap */
function sample(img, x, y, mode = 'clamp') {
  const { W, H, data } = img;
  let fx = x, fy = y;
  if (mode === 'wrap') { fx = ((fx % W) + W) % W; fy = ((fy % H) + H) % H; }
  else if (mode === 'mirror') {
    if (fx < 0) fx = -fx; if (fx > W - 1) fx = 2 * (W - 1) - fx;
    if (fy < 0) fy = -fy; if (fy > H - 1) fy = 2 * (H - 1) - fy;
    fx = clamp(fx, 0, W - 1); fy = clamp(fy, 0, H - 1);
  } else { fx = clamp(fx, 0, W - 1); fy = clamp(fy, 0, H - 1); }
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const o = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = data[(y0 * W + x0) * 4 + c], b = data[(y0 * W + x1) * 4 + c];
    const d = data[(y1 * W + x0) * 4 + c], e = data[(y1 * W + x1) * 4 + c];
    o[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
  return o;
}

function blit(dst, src, dw, ox, oy, alpha = 1) {
  for (let y = 0; y < src.H; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.W; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.W + x) * 4, di = (ty * dw + tx) * 4;
      if (alpha >= 1) {
        dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255;
      } else {
        dst.data[di] = dst.data[di] * (1 - alpha) + src.data[si] * alpha;
        dst.data[di + 1] = dst.data[di + 1] * (1 - alpha) + src.data[si + 1] * alpha;
        dst.data[di + 2] = dst.data[di + 2] * (1 - alpha) + src.data[si + 2] * alpha;
        dst.data[di + 3] = 255;
      }
    }
  }
}

/* 分离式滑动均值模糊：每像素 O(1)，大半径也不会卡住 */
function boxBlur(cv, x0, y0, w, h, radius = 8) {
  const { width: W, height: H, data } = cv;
  if (w <= 0 || h <= 0) return;
  const r = Math.max(1, Math.round(radius));
  const buf = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const py = clamp(y0 + y, 0, H - 1);
    for (let x = 0; x < w; x++) {
      const px = clamp(x0 + x, 0, W - 1), i = (py * W + px) * 4, t = (y * w + x) * 3;
      buf[t] = data[i]; buf[t + 1] = data[i + 1]; buf[t + 2] = data[i + 2];
    }
  }
  const pass = (src, dst, len, stride, outer, baseStep) => {
    const div = r * 2 + 1;
    for (let l = 0; l < outer; l++) {
      const base = l * baseStep;
      let s0 = 0, s1 = 0, s2 = 0;
      for (let k = -r; k <= r; k++) {
        const idx = base + clamp(k, 0, len - 1) * stride;
        s0 += src[idx]; s1 += src[idx + 1]; s2 += src[idx + 2];
      }
      for (let p = 0; p < len; p++) {
        const o = base + p * stride;
        dst[o] = s0 / div; dst[o + 1] = s1 / div; dst[o + 2] = s2 / div;
        const a = base + clamp(p - r, 0, len - 1) * stride;
        const b = base + clamp(p + r + 1, 0, len - 1) * stride;
        s0 += src[b] - src[a];
        s1 += src[b + 1] - src[a + 1];
        s2 += src[b + 2] - src[a + 2];
      }
    }
  };
  const tmp = new Float32Array(w * h * 3);
  pass(buf, tmp, w, 3, h, w * 3);   // 水平：每行起点 y*w*3，步长 3
  pass(tmp, buf, h, w * 3, w, 3);   // 垂直：每列起点 x*3，步长 w*3
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * W + (x0 + x)) * 4, t = (y * w + x) * 3;
    data[i] = buf[t]; data[i + 1] = buf[t + 1]; data[i + 2] = buf[t + 2];
  }
}

/* ---------- 裁剪 ---------- */
const RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '21:9': 21 / 9, '2.39:1': 2.39 };

export async function cropImage(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const st = ((info && info.streams) || []).find((s) => s.codec_type === 'video') || {};
  const W = Math.round(Number(st.width) || 1280), H = Math.round(Number(st.height) || 720);
  const ratioKey = String(opts.ratio || 'original');
  const zoom = clamp(Number(opts.zoom) || 1, 1, 4);
  let cw = W, ch = H;
  if (ratioKey !== 'original' && RATIOS[ratioKey]) {
    const t = RATIOS[ratioKey];
    if (W / H > t) { ch = H; cw = Math.round(H * t); } else { cw = W; ch = Math.round(W / t); }
  }
  cw = Math.max(16, Math.round(cw / zoom) & ~1);
  ch = Math.max(16, Math.round(ch / zoom) & ~1);
  const focus = String(opts.focus || 'center');
  let cx = Math.round((W - cw) / 2), cy = Math.round((H - ch) / 2);
  if (focus.includes('top')) cy = 0;
  if (focus.includes('bottom')) cy = H - ch;
  if (focus.includes('left')) cx = 0;
  if (focus.includes('right')) cx = W - cw;
  const o = outP('image', '.png');
  const r = await runFF(['-y', '-i', srcFile, '-vf', 'crop=' + cw + ':' + ch + ':' + cx + ':' + cy, '-frames:v', '1', o.file]);
  if (!r.ok) throw new Error('裁剪失败：' + String(r.log || '').slice(-160));
  return { file: o.file, rel: o.rel, width: cw, height: ch, ratio: ratioKey, x: cx, y: cy };
}

/* ---------- 扩图（向外延展，镜像 + 边缘模糊融合） ---------- */
export async function outpaintImage(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile);
  const pad = clamp(Number(opts.pad) || 25, 5, 100) / 100;
  const pw = Math.round(img.W * pad), ph = Math.round(img.H * pad);
  const W = img.W + pw * 2, H = img.H + ph * 2;
  const cv = canvas(W, H);
  /* 先镜像铺满外区 */
  const tiled = { W: W, H: H, data: cv.data };
  for (let y = 0; y < H; y++) {
    const sy = y - ph;
    for (let x = 0; x < W; x++) {
      const sx = x - pw;
      const p = sample(img, sx, sy, 'mirror');
      const i = (y * W + x) * 4;
      cv.data[i] = p[0]; cv.data[i + 1] = p[1]; cv.data[i + 2] = p[2]; cv.data[i + 3] = 255;
    }
  }
  /* 外区模糊化，削弱镜像痕迹 */
  boxBlur(cv, 0, 0, W, ph, Math.max(6, Math.round(ph / 2)));
  boxBlur(cv, 0, H - ph, W, ph, Math.max(6, Math.round(ph / 2)));
  boxBlur(cv, 0, 0, pw, H, Math.max(6, Math.round(pw / 2)));
  boxBlur(cv, W - pw, 0, pw, H, Math.max(6, Math.round(pw / 2)));
  /* 原图贴回中心 + 羽化接缝 */
  const alpha = clamp(Number(opts.blend) || 0.25, 0, 1);
  blit({ width: W, height: H, data: cv.data }, img, W, pw, ph, 1);
  const feather = Math.max(8, Math.round(Math.min(pw, ph) * alpha));
  for (let k = 0; k < feather; k++) {
    const a = 0.5 * (1 - k / feather);
    const y0 = ph - k, y1 = ph + img.H + k - 1, x0 = pw - k, x1 = pw + img.W + k - 1;
    for (let x = 0; x < W; x++) {
      for (const yy of [y0, y1]) {
        if (yy < 0 || yy >= H) continue;
        const i = (yy * W + x) * 4;
        cv.data[i] = cv.data[i] * (1 - a) + 12 * a; cv.data[i + 1] = cv.data[i + 1] * (1 - a) + 14 * a; cv.data[i + 2] = cv.data[i + 2] * (1 - a) + 20 * a;
      }
    }
    for (let y = 0; y < H; y++) {
      for (const xx of [x0, x1]) {
        if (xx < 0 || xx >= W) continue;
        const i = (y * W + xx) * 4;
        cv.data[i] = cv.data[i] * (1 - a) + 12 * a; cv.data[i + 1] = cv.data[i + 1] * (1 - a) + 14 * a; cv.data[i + 2] = cv.data[i + 2] * (1 - a) + 20 * a;
      }
    }
  }
  const o = savePNG(cv);
  return { ...o, ratio: Math.round((W / H) * 1000) / 1000, pad: Math.round(pad * 100) };
}

/* ---------- 宫格切分 ---------- */
export async function splitGrid(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const st = ((info && info.streams) || []).find((s) => s.codec_type === 'video') || {};
  const W = Math.round(Number(st.width) || 1280), H = Math.round(Number(st.height) || 720);
  let cols = Number(opts.cols) || 0, rows = Number(opts.rows) || 0;
  const n = Number(opts.count) || 0;
  if ((!cols || !rows) && n) {
    cols = Math.round(Math.sqrt(n)); rows = Math.round(n / cols);
    if (n === 9) { cols = 3; rows = 3; }
    if (n === 4) { cols = 2; rows = 2; }
    if (n === 16) { cols = 4; rows = 4; }
    if (n === 25) { cols = 5; rows = 5; }
  }
  cols = clamp(cols || 3, 1, 8); rows = clamp(rows || 3, 1, 8);
  const cw = Math.floor(W / cols), ch = Math.floor(H / rows);
  const want = Array.isArray(opts.indices) && opts.indices.length ? opts.indices.map(Number) : null;
  const out = [];
  let idx = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      idx++;
      if (want && !want.includes(idx)) continue;
      const o = outP('image', '.png');
      const r = await runFF(['-y', '-i', srcFile, '-vf', 'crop=' + cw + ':' + ch + ':' + (rx * cw) + ':' + (ry * ch), '-frames:v', '1', o.file]);
      if (!r.ok) continue;
      out.push({ file: o.file, rel: o.rel, width: cw, height: ch, row: ry + 1, col: rx + 1, index: idx });
      if (out.length >= 40) break;
    }
  }
  return { images: out, cols, rows, total: cols * rows, cell: { w: cw, h: ch } };
}

/* ---------- 多角度：圆柱投影偏航 + 俯仰 ---------- */
export const ANGLE_VIEWS = {
  front: { az: 0, el: 0, label: '正面' },
  frontLeft45: { az: -30, el: 0, label: '左前 45°' },
  frontRight45: { az: 30, el: 0, label: '右前 45°' },
  left: { az: -55, el: 0, label: '左侧' },
  right: { az: 55, el: 0, label: '右侧' },
  backLeft45: { az: -130, el: 0, label: '左后 45°' },
  backRight45: { az: 130, el: 0, label: '右后 45°' },
  back: { az: 180, el: 0, label: '背面' },
  top: { az: 0, el: 32, label: '俯视' }
};

/* 视角组合预设：UI 传字符串也能直接选中一组 */
export const VIEW_SETS = {
  all: ['front', 'frontLeft45', 'frontRight45', 'left', 'right', 'backLeft45', 'backRight45', 'back', 'top'],
  front3: ['front', 'frontLeft45', 'frontRight45'],
  side: ['left', 'front', 'right'],
  back3: ['backLeft45', 'back', 'backRight45'],
  top: ['front', 'top']
};

export async function multiAngle(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile);
  const raw = opts.views;
  const fromSet = typeof raw === 'string' && VIEW_SETS[raw] ? VIEW_SETS[raw] : null;
  const list = fromSet || (Array.isArray(raw) && raw.length ? raw : ['frontLeft45', 'frontRight45', 'left', 'right', 'top']);
  const zoom = clamp(Number(opts.distance) || 1, 0.6, 2);
  const W = img.W, H = img.H;
  const f = W * 1.15;
  const outs = [];
  for (const key of list.slice(0, 9)) {
    const v = ANGLE_VIEWS[key] || ANGLE_VIEWS.front;
    const az = (Number(opts.azimuth) || 0) + v.az;
    const el = (Number(opts.elevation) || 0) + v.el;
    const yaw = (az * Math.PI) / 180, pitch = (el * Math.PI) / 180;
    const cv = canvas(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x - W / 2) / zoom, w = (y - H / 2) / zoom;
        const th = Math.atan2(u, f) - yaw;
        const ph = Math.atan2(w, f) - pitch;
        const sx = W / 2 + f * Math.tan(th);
        const sy = H / 2 + f * Math.tan(ph);
        const p = sample(img, sx, sy, 'clamp');
        const i = (y * W + x) * 4;
        cv.data[i] = p[0]; cv.data[i + 1] = p[1]; cv.data[i + 2] = p[2]; cv.data[i + 3] = 255;
      }
    }
    const o = savePNG(cv);
    outs.push({ ...o, view: key, label: v.label, azimuth: Math.round(az), elevation: Math.round(el) });
  }
  return { images: outs, count: outs.length };
}

/* ---------- 360 / 720 全景条带 ---------- */
export async function panoramaImage(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile);
  const turns = clamp(Number(opts.turns) || 2, 1, 2);
  const W = img.W * turns, H = Math.round(img.H * 0.62);
  const f = W / (Math.PI * 2);
  const cv = canvas(W, H);
  const el = (Number(opts.elevation) || 0) * (Math.PI / 180);
  for (let y = 0; y < H; y++) {
    const ph = Math.atan2(y - H / 2, f * 1.4) + el;
    const sy = H / 2 + (img.H / 2) * Math.tan(ph) / Math.tan(0.42);
    for (let x = 0; x < W; x++) {
      const th = (x / W) * Math.PI * 2 * turns;
      const sx = (th / (Math.PI * 2 * turns)) * img.W * turns;
      const p = sample(img, sx % img.W, sy, 'clamp');
      const i = (y * W + x) * 4;
      cv.data[i] = p[0]; cv.data[i + 1] = p[1]; cv.data[i + 2] = p[2]; cv.data[i + 3] = 255;
    }
  }
  const o = savePNG(cv);
  return { ...o, turns, angle: turns === 1 ? 360 : 720, equirect: true };
}

/* ---------- 剧情推演宫格（多格生成 + 拼贴） ---------- */
export async function storyGrid(opts = {}) {
  const { renderImage } = await import('./image.mjs');
  const cols = clamp(Number(opts.cols) || 3, 2, 5);
  const rows = clamp(Number(opts.rows) || 3, 2, 5);
  const n = cols * rows;
  const cw = 640, ch = Math.round((cw * 9) / 16);
  const prompt = String(opts.prompt || opts.storyPrompt || '剧情推演');
  const style = opts.style || 'cinematic';
  const cells = [];
  for (let i = 0; i < n; i++) {
    const shot = i === 0 ? '开场' : i === n - 1 ? '收束' : '推进' + i;
    const r = await renderImage({
      prompt: prompt + ' · ' + shot + ' · 镜头' + (i + 1),
      width: cw, height: ch, style, seedText: prompt + '|grid', index: i, variant: i,
      palette: opts.palette || null,
      safeFrame: false, withBar: false
    });
    cells.push(r);
  }
  const W = cw * cols, H = ch * rows;
  const cv = canvas(W, H);
  for (let i = 0; i < cells.length; i++) {
    const img = await loadRGBA(cells[i].file, { w: cw, h: ch });
    blit({ width: W, height: H, data: cv.data }, img, W, (i % cols) * cw, Math.floor(i / cols) * ch, 1);
  }
  /* 细分割线 */
  for (let c = 1; c < cols; c++) for (let y = 0; y < H; y++) {
    const i = (y * W + c * cw) * 4; cv.data[i] = 8; cv.data[i + 1] = 9; cv.data[i + 2] = 12;
  }
  for (let rr = 1; rr < rows; rr++) for (let x = 0; x < W; x++) {
    const i = (rr * ch * W + x) * 4; cv.data[i] = 8; cv.data[i + 1] = 9; cv.data[i + 2] = 12;
  }
  const o = savePNG(cv);
  return { ...o, cols, rows, count: n, cells: cells.map((c) => c.rel) };
}

/* ---------- 抽帧 / 抽帧转线稿 ---------- */
export async function frameLineArt(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const dur = Number((info && info.format && info.format.duration) || 0);
  const at = opts.at === 'last' ? Math.max(0, dur - 0.2) : Number(opts.at) || 0;
  const o = outP('image', '.png');
  const chain = String(opts.mode || 'line') === 'raw'
    ? 'scale=1280:-2'
    : 'scale=1280:-2,edgedetect=low=0.08:high=0.28,negate,eq=contrast=1.35:brightness=0.06';
  const r = await runFF(['-y', '-ss', String(at), '-i', srcFile, '-frames:v', '1', '-vf', chain, o.file]);
  if (!r.ok) throw new Error('抽帧失败：' + String(r.log || '').slice(-160));
  return { file: o.file, rel: o.rel, at, mode: opts.mode || 'line', width: 1280, height: null };
}

/* ---------- 调色板 ---------- */
export async function paletteOf(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile, { w: 320, h: Math.round((320 * 9) / 16) });
  const buckets = new Map();
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const top = Array.from(buckets.values()).sort((a, b) => b.n - a.n);
  const picked = [];
  for (const e of top) {
    const c = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
    if (picked.some((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 46)) continue;
    picked.push(c);
    if (picked.length >= 8) break;
  }
  const hex = picked.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
  const n = hex.length;
  const cw2 = 160, chh = 120;
  const cv = canvas(cw2 * n, chh);
  for (let k = 0; k < n; k++) {
    const c = picked[k];
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw2; x++) {
      const i = (y * cw2 * n + k * cw2 + x) * 4;
      cv.data[i] = c[0]; cv.data[i + 1] = c[1]; cv.data[i + 2] = c[2]; cv.data[i + 3] = 255;
    }
  }
  const o = savePNG(cv);
  return { ...o, colors: hex, swatches: picked };
}

/* ---------- 标注 ---------- */
function writeTextFile(t) {
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, uid('txt_') + '.txt');
  fs.writeFileSync(f, String(t), 'utf8');
  return f;
}

export async function annotateImage(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile);
  const W = img.W, H = img.H;
  const cv = canvas(W, H);
  cv.data.set(img.data);
  const accent = hexToRgb(opts.color || '#ffd166');
  const boxes = (Array.isArray(opts.boxes) && opts.boxes.length ? opts.boxes : []).slice(0, 8);
  const lw = Math.max(2, Math.round(W / 420));
  const put = (x, y, c, a = 1) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const i = (yi * W + xi) * 4;
    cv.data[i] = cv.data[i] * (1 - a) + c[0] * a;
    cv.data[i + 1] = cv.data[i + 1] * (1 - a) + c[1] * a;
    cv.data[i + 2] = cv.data[i + 2] * (1 - a) + c[2] * a;
  };
  const line = (x0, y0, x1, y1, c, w) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps, y = y0 + ((y1 - y0) * s) / steps;
      for (let t = -w; t <= w; t++) put(x, y + t, c, 0.92);
    }
  };
  for (const b of boxes) {
    const x = Math.round(((Number(b.x) || 0) / 100) * W);
    const y = Math.round(((Number(b.y) || 0) / 100) * H);
    const w = Math.round(((Number(b.w) || 30) / 100) * W);
    const h = Math.round(((Number(b.h) || 20) / 100) * H);
    const c = b.color ? hexToRgb(b.color) : accent;
    line(x, y, x + w, y, c, lw); line(x, y + h, x + w, y + h, c, lw);
    line(x, y, x, y + h, c, lw); line(x + w, y, x + w, y + h, c, lw);
    for (let k = 0; k < Math.min(w, 26); k++) { put(x + k, y, c, 0.9); put(x + k, y + h, c, 0.9); }
  }
  if (opts.arrow) {
    const a = opts.arrow;
    const x0 = (Number(a.x1) / 100) * W, y0 = (Number(a.y1) / 100) * H;
    const x1 = (Number(a.x2) / 100) * W, y1 = (Number(a.y2) / 100) * H;
    line(x0, y0, x1, y1, accent, lw);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const L = Math.max(12, W / 46);
    line(x1, y1, x1 - L * Math.cos(ang - 0.45), y1 - L * Math.sin(ang - 0.45), accent, lw);
    line(x1, y1, x1 - L * Math.cos(ang + 0.45), y1 - L * Math.sin(ang + 0.45), accent, lw);
  }
  const o = savePNG(cv);
  /* 文字标签（中文走 drawtext） */
  const labels = boxes.map((b) => ({ b, t: String(b.label || '').trim() })).filter((x) => x.t);
  const head = String(opts.title || '').trim();
  if (labels.length || head) {
    const filters = [];
    const tmpFiles = [];
    for (const { b, t } of labels) {
      const f = writeTextFile(t); tmpFiles.push(f);
      const x = Math.round(((Number(b.x) || 0) / 100) * W);
      const y = Math.round(((Number(b.y) || 0) / 100) * H);
      filters.push("drawtext=fontfile='" + FONT + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + Math.round(Math.min(W, H) * 0.036) + ':fontcolor=#ffd166:x=' + (x + 8) + ':y=' + Math.max(4, y - Math.round(Math.min(W, H) * 0.05)) + ':shadowcolor=black@0.7:shadowx=2:shadowy=2');
    }
    if (head) {
      const f = writeTextFile(head); tmpFiles.push(f);
      filters.push("drawtext=fontfile='" + FONT_R + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + Math.round(Math.min(W, H) * 0.05) + ':fontcolor=white@0.94:x=' + Math.round(W * 0.05) + ':y=' + Math.round(H * 0.5) + '-(text_h/2):shadowcolor=black@0.66:shadowx=3:shadowy=3');
    }
    const o2 = outP('image', '.png');
    const r = await runFF(['-y', '-i', o.file, '-vf', filters.join(','), o2.file]);
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
    if (r.ok) return { file: o2.file, rel: o2.rel, width: W, height: H, boxes: boxes.length, labels: labels.length };
  }
  return { ...o, boxes: boxes.length, labels: 0 };
}

/* ---------- 打光 / 电影级光影矫正 ---------- */
export const LIGHT_MODES = {
  cinematic: { label: '电影级光影矫正', tint: [[8, 34, 52], [255, 194, 128]], contrast: 1.16, sat: 1.06, vig: 0.3 },
  golden: { label: '黄金时刻侧光', tint: [[46, 26, 8], [255, 214, 152]], contrast: 1.08, sat: 1.12, vig: 0.24 },
  moon: { label: '月夜冷光', tint: [[6, 16, 40], [186, 214, 255]], contrast: 1.14, sat: 0.82, vig: 0.34 },
  rim: { label: '轮廓光', tint: [[10, 12, 20], [255, 246, 226]], contrast: 1.2, sat: 1.0, vig: 0.26 },
  soft: { label: '柔光棚拍', tint: [[18, 18, 22], [255, 240, 226]], contrast: 1.02, sat: 1.04, vig: 0.12 },
  noir: { label: '黑金低调', tint: [[2, 2, 4], [236, 176, 74]], contrast: 1.3, sat: 0.9, vig: 0.42 }
};

export async function relightImage(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile);
  const W = img.W, H = img.H;
  const mode = LIGHT_MODES[opts.mode] ? opts.mode : 'cinematic';
  const M = LIGHT_MODES[mode];
  const strength = clamp(Number(opts.strength) || 0.62, 0, 1);
  const from = String(opts.from || 'topLeft');
  const lx = from.includes('Right') ? 1 : from.includes('Left') ? 0 : 0.5;
  const ly = from.includes('bottom') ? 1 : from.includes('top') ? 0 : 0.4;
  const cv = canvas(W, H);
  const [sc, hc] = M.tint;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      let L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const d = Math.hypot(x / W - lx, y / H - ly) / 1.2;
      const light = clamp(1 - d * 1.15, 0.18, 1) * strength;
      L = clamp((L - 0.5) * M.contrast + 0.5 + light * 0.16, 0, 1);
      const t = L;
      const sc2 = [sc[0] / 255, sc[1] / 255, sc[2] / 255], hc2 = [hc[0] / 255, hc[1] / 255, hc[2] / 255];
      let nr = (sc2[0] + (hc2[0] - sc2[0]) * t) * 255;
      let ng = (sc2[1] + (hc2[1] - sc2[1]) * t) * 255;
      let nb = (sc2[2] + (hc2[2] - sc2[2]) * t) * 255;
      const k = 0.55;
      nr = r * (1 - k) + nr * k; ng = g * (1 - k) + ng * k; nb = b * (1 - k) + nb * k;
      const gl = (nr + ng + nb) / 3;
      nr = gl + (nr - gl) * M.sat; ng = gl + (ng - gl) * M.sat; nb = gl + (nb - gl) * M.sat;
      const vx = (x / W - 0.5) * 2, vy = (y / H - 0.5) * 2;
      const vk = 1 - M.vig * Math.pow(clamp(Math.hypot(vx, vy) / 1.35, 0, 1), 1.7);
      cv.data[i] = clamp(nr * vk, 0, 255); cv.data[i + 1] = clamp(ng * vk, 0, 255); cv.data[i + 2] = clamp(nb * vk, 0, 255); cv.data[i + 3] = 255;
    }
  }
  if (mode === 'rim') {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      const gx = Math.abs(img.data[i + 4] - img.data[i - 4]);
      const gy = Math.abs(img.data[i + W * 4] - img.data[i - W * 4]);
      const e = clamp((gx + gy) / 90, 0, 1) * strength;
      cv.data[i] = clamp(cv.data[i] + 210 * e, 0, 255);
      cv.data[i + 1] = clamp(cv.data[i + 1] + 200 * e, 0, 255);
      cv.data[i + 2] = clamp(cv.data[i + 2] + 180 * e, 0, 255);
    }
  }
  const o = savePNG(cv);
  return { ...o, mode, modeName: M.label, from };
}

/* ---------- 视频帧率 / 时长统一 ---------- */
export async function unifyVideo(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const st = ((info && info.streams) || []).find((s) => s.codec_type === 'video') || {};
  const au = ((info && info.streams) || []).some((s) => s.codec_type === 'audio');
  const W = Math.round(Number(opts.width) || Number(st.width) || 1280);
  const H = Math.round(Number(opts.height) || Number(st.height) || 720);
  const fps = clamp(Number(opts.fps) || 30, 12, 60);
  const dur = Number(opts.seconds) || 0;
  const o = outP('video', '.mp4');
  const vf = 'scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2,fps=' + fps + (dur > 0 ? ',tpad=stop_mode=clone:stop_duration=' + dur : '');
  const args = ['-y', '-i', srcFile, '-vf', vf];
  if (dur > 0) args.push('-t', String(dur));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (au) args.push('-c:a', 'aac', '-b:a', '160k', '-af', 'apad' + (dur > 0 ? ',atrim=0:' + dur : ''));
  else args.push('-an');
  args.push(o.file);
  const r = await runFF(args, { timeout: 300000 });
  if (!r.ok) throw new Error('统一失败：' + String(r.log || '').slice(-200));
  return { file: o.file, rel: o.rel, width: W, height: H, fps, duration: dur || Number((info && info.format && info.format.duration) || 0) };
}

/* ---------- 消除笔：在掩膜区做环域扩散填充 ---------- */
export async function eraserImage(srcFile, opts = {}) {
  const img = await loadRGBA(srcFile);
  const W = img.W, H = img.H;
  const src = new Uint8ClampedArray(img.data);
  const regions = Array.isArray(opts.regions) && opts.regions.length
    ? opts.regions
    : [{ x: 50, y: 50, w: 24, h: 24 }];
  const mask = new Uint8Array(W * H);
  for (const rg of regions) {
    const cx = (Number(rg.x) / 100) * W, cy = (Number(rg.y) / 100) * H;
    const rw = Math.max(2, (Number(rg.w) / 100) * W), rh = Math.max(2, (Number(rg.h) / 100) * H);
    const x0 = Math.round(cx - rw / 2), y0 = Math.round(cy - rh / 2);
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + Math.round(rh)); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + Math.round(rw)); x++) mask[y * W + x] = 1;
  }
  // 多轮从边界向内扩散，每轮取已知邻域均值
  const data = img.data;
  for (let pass = 0; pass < 90; pass++) {
    let changed = 0;
    const next = new Uint8Array(mask);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = (y + dy) * W + (x + dx);
        if (mask[j]) continue;
        const k = j * 4;
        r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
      }
      if (!n) continue;
      const k = i * 4;
      data[k] = r / n; data[k + 1] = g / n; data[k + 2] = b / n; data[k + 3] = 255;
      next[i] = 0; changed++;
    }
    mask.set(next);
    if (!changed) break;
  }
  const o = savePNG({ data, width: W, height: H });
  return { ...o, regions: regions.length };
}

/* ---------- 4 / 12 视图联系表 ---------- */
export async function viewGrid(srcFile, opts = {}) {
  const count = Number(opts.count) || 4;
  const cols = count >= 12 ? 4 : 2;
  const rows = Math.ceil(count / cols);
  const picks = count >= 12
    ? ['front', 'frontLeft45', 'frontRight45', 'left', 'right', 'backLeft45', 'backRight45', 'back', 'top', 'frontLeft45', 'frontRight45', 'top']
    : ['front', 'left', 'right', 'back'];
  const set = await multiAngle(srcFile, { views: picks, distance: opts.distance || 1, elevation: opts.elevation || 0 });
  const first = await loadRGBA(set.images[0].file);
  const cw = first.W, ch = first.H;
  const cv = canvas(cw * cols, ch * rows);
  for (let i = 0; i < set.images.length; i++) {
    const im = await loadRGBA(set.images[i].file, { w: cw, h: ch });
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const s = (y * cw + x) * 4, d = ((oy + y) * cv.width + ox + x) * 4;
      cv.data[d] = im.data[s]; cv.data[d + 1] = im.data[s + 1]; cv.data[d + 2] = im.data[s + 2]; cv.data[d + 3] = 255;
    }
  }
  // 网格线
  for (let c = 1; c < cols; c++) for (let y = 0; y < cv.height; y++) {
    const i = (y * cv.width + c * cw) * 4;
    cv.data[i] = 12; cv.data[i + 1] = 16; cv.data[i + 2] = 22;
  }
  for (let r = 1; r < rows; r++) for (let x = 0; x < cv.width; x++) {
    const i = (r * ch * cv.width + x) * 4;
    cv.data[i] = 12; cv.data[i + 1] = 16; cv.data[i + 2] = 22;
  }
  const o = savePNG(cv);
  return { ...o, cols, rows, count: set.images.length, views: set.images.map((x) => x.label) };
}

/* ---------- 图片超清 ---------- */
export async function upscaleImage(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const st = ((info && info.streams) || []).find((s) => s.codec_type === 'video') || {};
  const W0 = Math.round(Number(st.width) || 1024), H0 = Math.round(Number(st.height) || 576);
  const scale = clamp(Number(opts.scale) || 2, 1.2, 4);
  const W = Math.round(W0 * scale / 2) * 2, H = Math.round(H0 * scale / 2) * 2;
  const sharpen = Number(opts.sharpen) || 0.6;
  const o = outP('image', '.png');
  const vf = 'scale=' + W + ':' + H + ':flags=lanczos,unsharp=5:5:' + sharpen + ':5:5:0';
  const r = await runFF(['-y', '-i', srcFile, '-vf', vf, '-frames:v', '1', o.file]);
  if (!r.ok) throw new Error('超清失败：' + String(r.log || '').slice(-160));
  return { file: o.file, rel: o.rel, width: W, height: H, scale, from: { width: W0, height: H0 } };
}


/* ---------- 表情控制（官方 canvas.expressionControl） ---------- */
export const EXPRESSIONS = [
  { k: 'neutral', label: '自然', corner: 0, open: 0, brow: 0, squint: 0, cheek: 0 },
  { k: 'smile', label: '微笑', corner: -1, open: 0.18, brow: 0.2, squint: 0.25, cheek: 0.1 },
  { k: 'laugh', label: '大笑', corner: -1.5, open: 0.6, brow: 0.35, squint: 0.55, cheek: 0.14 },
  { k: 'surprise', label: '惊讶', corner: 0.1, open: 0.9, brow: -0.95, squint: -0.55, cheek: 0 },
  { k: 'angry', label: '愤怒', corner: 0.95, open: 0.12, brow: 0.85, squint: 0.35, cheek: 0.06 },
  { k: 'sad', label: '悲伤', corner: 1.15, open: -0.12, brow: -0.4, squint: 0.2, cheek: -0.06 },
  { k: 'cold', label: '冷峻', corner: 0.25, open: 0, brow: 0.3, squint: 0.5, cheek: -0.08 }
];

export async function expressionImage(srcFile, opts = {}) {
  const preset = EXPRESSIONS.find((e) => e.k === String(opts.expr || 'smile')) || EXPRESSIONS[1];
  const strength = clamp(Number(opts.strength) || 1, 0.2, 2);
  const img = await loadRGBA(srcFile);
  const W = img.W, H = img.H, data = img.data;
  const b = opts.box || {};
  const bx = Math.round(clamp(Number(b.x) || 22, 0, 92) / 100 * W);
  const by = Math.round(clamp(Number(b.y) || 8, 0, 92) / 100 * H);
  const cw = Math.min(Math.round(clamp(Number(b.w) || 56, 10, 100) / 100 * W), W - bx);
  const chh = Math.min(Math.round(clamp(Number(b.h) || 52, 10, 100) / 100 * H), H - by);
  const out = new Uint8ClampedArray(data);
  const cx = bx + cw / 2, cy = by + chh / 2;
  const px = (x, y, c) => {
    const xi = x < 0 ? 0 : x >= W ? W - 1 : x | 0;
    const yi = y < 0 ? 0 : y >= H ? H - 1 : y | 0;
    return data[(yi * W + xi) * 4 + c];
  };
  const band = (v, a, z) => (v <= a || v >= z ? 0 : Math.sin(Math.PI * (v - a) / (z - a)));
  for (let y = by; y < by + chh; y++) {
    const v = (y - cy) / (chh / 2);
    const wBrow = band(v, -0.72, -0.18);
    const wEye = band(v, -0.48, 0.10);
    const wMouth = band(v, 0.34, 1.02);
    const wCheek = band(v, -0.02, 0.62);
    for (let x = bx; x < bx + cw; x++) {
      const u = (x - cx) / (cw / 2);
      const au = Math.abs(u);
      let dx = 0, dy = 0;
      // 嘴角：外扩 + 上下移动（负值上扬）
      if (wMouth > 0) {
        const k = preset.corner * strength;
        dy += k * wMouth * au * au * chh * 0.085;
        dx += -k * wMouth * u * cw * 0.03;
        // 张口：以嘴部中心为锚做纵向拉伸
        const vc = 0.66;
        const vv = (v - vc) / (1 + preset.open * strength * 0.95 * wMouth);
        dy += (vc + vv - v) * (chh / 2) * 0.9;
      }
      // 眉毛：整体上抬 / 下压，内高外低
      if (wBrow > 0) dy += preset.brow * strength * wBrow * (1 - au * 0.35) * chh * 0.04;
      // 眼睛：纵向眯起 / 睁大
      if (wEye > 0) {
        const ve = -0.15;
        const vv = (v - ve) * (1 + preset.squint * strength * 0.55 * wEye);
        dy += (ve + vv - v) * (chh / 2) * 0.8;
      }
      const sx = x + dx, sy = y + dy;
      const i = (y * W + x) * 4;
      out[i] = px(sx, sy, 0);
      out[i + 1] = px(sx, sy, 1);
      out[i + 2] = px(sx, sy, 2);
      out[i + 3] = data[i + 3];
      // 面颊提亮 / 压暗（表情强度佐证）
      if (preset.cheek && wCheek > 0 && au > 0.28) {
        const lit = preset.cheek * strength * wCheek * (au - 0.28) * 90;
        out[i] = clamp(out[i] + lit, 0, 255);
        out[i + 1] = clamp(out[i + 1] + lit * 0.85, 0, 255);
        out[i + 2] = clamp(out[i + 2] + lit * 0.7, 0, 255);
      }
    }
  }
  const cv = { width: W, height: H, data: out };
  const o = savePNG(cv);
  return { ...o, expr: preset.k, exprLabel: preset.label, strength, box: { x: Math.round(bx / W * 100), y: Math.round(by / H * 100), w: Math.round(cw / W * 100), h: Math.round(chh / H * 100) } };
}

export const POST_CAPS = [
  { key: 'crop', label: '裁剪', desc: '按画幅比例重构图，可指定焦点', src: 'image' },
  { key: 'outpaint', label: '扩图', desc: '向外延展画面，补足构图留白', src: 'image' },
  { key: 'grid-split', label: '宫格切分', desc: '4/9/16/25 宫格或自定义行列切分', src: 'image' },
  { key: 'multi-angle', label: '多角度', desc: '同一画面生成 9 向视角', src: 'image' },
  { key: 'panorama', label: '全景 360/720', desc: '生成环绕全景条带', src: 'image' },
  { key: 'story-grid', label: '剧情推演', desc: '多格分镜一次推演成型', src: 'prompt' },
  { key: 'line-art', label: '抽帧转线稿', desc: '抓取关键帧并转线稿', src: 'video' },
  { key: 'palette', label: '调色板', desc: '提取主色卡与十六进制值', src: 'image' },
  { key: 'annotate', label: '标注', desc: '画框、箭头、文字标注', src: 'image' },
  { key: 'relight', label: '打光矫正', desc: '电影级光影、侧光、轮廓光', src: 'image' },
  { key: 'unify-video', label: '帧率时长统一', desc: '统一分辨率、帧率与时长', src: 'video' },
  { key: 'eraser', label: '消除笔', desc: '涂抹区域智能填补，去掉多余元素', src: 'image' },
  { key: 'view-grid', label: '4/12 视图', desc: '多视角拼成一张联系表', src: 'image' },
  { key: 'image-upscale', label: '图片超清', desc: 'Lanczos 放大 + 锐化，倍数可选', src: 'image' },
  { key: 'expression', label: '表情控制', desc: '框选人脸并调整表情（微笑/大笑/惊讶/愤怒/悲伤/冷峻）', src: 'image' }
];
