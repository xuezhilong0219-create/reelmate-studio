import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, uid } from '../server/db.mjs';
import { FFMPEG, runFF, probe } from './ffmpeg.mjs';
import { spawn } from 'node:child_process';

/* 字幕擦除 / 去水印 / 遮挡清除
   区域一律用百分比（0-100）表达，内部换算成像素。
   mode: delogo 按边缘像素插值填补（最自然，适合字幕条）
         blur   高斯模糊遮盖（适合大面积马赛克式处理）
         fill   纯色填充（适合纯黑遮罩）
*/

function outPath(kind, ext) {
  const id = uid('m_');
  const dir = path.join(MEDIA, kind);
  fs.mkdirSync(dir, { recursive: true });
  return { id, file: path.join(dir, id + ext), rel: '/media/' + kind + '/' + id + ext };
}

function meta(info) {
  const j = info || {};
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
  return {
    W: Math.round(Number(v.width) || 1280),
    H: Math.round(Number(v.height) || 720),
    dur: Number((j.format && j.format.duration) || v.duration) || null,
    hasAudio: !!a.codec_name
  };
}

function toPixels(regions, W, H, mode) {
  const list = Array.isArray(regions) && regions.length ? regions.slice(0, 6) : [{ x: 8, y: 78, w: 84, h: 16 }];
  const pct = (v, base, def) => Math.round(((v === null || v === undefined || v === '' ? def : Number(v)) / 100) * base);
  return list.map((g) => {
    let x = Math.max(0, Math.min(W - 10, pct(g.x, W, 8)));
    let y = Math.max(0, Math.min(H - 10, pct(g.y, H, 78)));
    let w = Math.max(10, Math.min(W - x, pct(g.w, W, 84)));
    let h = Math.max(10, Math.min(H - y, pct(g.h, H, 16)));
    if (mode === 'delogo') {
      x = Math.max(1, x); y = Math.max(1, y);
      w = Math.max(6, Math.min(W - x - 1, w)); h = Math.max(6, Math.min(H - y - 1, h));
      x = Math.max(1, Math.min(x, W - w - 1)); y = Math.max(1, Math.min(y, H - h - 1));
    }
    w = Math.round(w / 2) * 2; h = Math.round(h / 2) * 2;
    return { x, y, w, h };
  });
}

export async function eraseRegions(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const M = meta(info);
  const W = M.W;
  const H = M.H;
  const mode = opts.mode || 'delogo';
  const strength = Math.max(1, Math.min(4, Number(opts.strength) || 2));
  const regs = toPixels(opts.regions, W, H, mode);
  const o = outPath('video', '.mp4');
  const args = ['-y', '-i', srcFile];

  if (mode === 'patch') {
    /* 镜像填补：从区域正上方取等高带 → 垂直翻转 → 轻微模糊 → 羽化 alpha 遮罩 → overlay
       这是硬字幕/水印的最优默认：背景纹理连贯，看不到糊块或黑边 */
    const n = regs.length;
    const fc = [];
    fc.push('[0:v]split=' + (n + 1) + '[' + Array.from({ length: n + 1 }, (_, i) => 'p' + i).join('][') + ']');
    fc.push('[p0]null[base]');
    let cur2 = 'base';
    const feather = Math.max(4, Math.round(regs[0].h / 5));
    regs.forEach((g, i) => {
      const upY = Math.max(0, g.y - g.h);
      const srcH = Math.min(g.h, g.y);
      const geq = "geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*min(1,min(Y/" + feather + ",(H-Y)/" + feather + "))'";
      fc.push('[p' + (i + 1) + ']crop=' + g.w + ':' + srcH + ':' + g.x + ':' + upY + ',' +
        'scale=' + g.w + ':' + g.h + ',vflip,gblur=sigma=' + (2 + strength) + ',' + geq + '[pt' + i + ']');
      const outLbl = i === n - 1 ? 'outv' : 'q' + i;
      fc.push('[' + cur2 + '][pt' + i + ']overlay=' + g.x + ':' + g.y + ':format=auto[' + outLbl + ']');
      cur2 = outLbl;
    });
    args.push('-filter_complex', fc.join(';'), '-map', '[outv]', '-map', '0:a?');
  } else if (mode === 'blur') {

    const sigma = (3 + strength * 3).toFixed(1);
    const n = regs.length;
    const fc = [];
    fc.push('[0:v]split=' + (n + 1) + '[' + Array.from({ length: n + 1 }, (_, i) => 'z' + i).join('][') + ']');
    fc.push('[z0]null[base]');
    let cur = 'base';
    regs.forEach((g, i) => {
      fc.push('[z' + (i + 1) + ']crop=' + g.w + ':' + g.h + ':' + g.x + ':' + g.y + ',gblur=sigma=' + sigma + '[bg' + i + ']');
      const outLbl = i === n - 1 ? 'outv' : 'm' + i;
      fc.push('[' + cur + '][bg' + i + ']overlay=' + g.x + ':' + g.y + '[' + outLbl + ']');
      cur = outLbl;
    });
    args.push('-filter_complex', fc.join(';'), '-map', '[outv]', '-map', '0:a?');
  } else if (mode === 'fill') {
    const color = opts.color || 'black';
    const vf = regs.map((g) => 'drawbox=x=' + g.x + ':y=' + g.y + ':w=' + g.w + ':h=' + g.h + ':color=' + color + '@1:t=fill').join(',');
    args.push('-vf', vf + ',format=yuv420p');
  } else {
    const vf = regs.map((g) => 'delogo=x=' + g.x + ':y=' + g.y + ':w=' + g.w + ':h=' + g.h + ':show=0').join(',');
    args.push('-vf', vf + ',format=yuv420p');
  }

  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(opts.crf || 20));
  if (opts.mute) args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '160k');
  args.push('-movflags', '+faststart', o.file);
  await runFF(args);
  return { ...o, duration: M.dur, mode, regions: regs, width: W, height: H };
}

/* 四角水印一键去除：br/bl/tr/tl + 尺寸百分比 */
export async function removeWatermark(srcFile, opts = {}) {
  const corner = opts.corner || 'br';
  const size = Math.max(4, Math.min(45, Number(opts.size) || 18));
  const pad = Math.max(0, Math.min(10, Number(opts.pad) || 2));
  let x; let y;
  if (corner === 'br') { x = 100 - pad - size; y = 100 - pad - size; }
  else if (corner === 'bl') { x = pad; y = 100 - pad - size; }
  else if (corner === 'tr') { x = 100 - pad - size; y = pad; }
  else { x = pad; y = pad; }
  return eraseRegions(srcFile, { ...opts, regions: [{ x, y, w: size, h: size }] });
}

/* ---------- 字幕带检测（强去 OCR 模式） ----------
   思路：把视频按 1fps 抽成灰度小图（480px 宽），逐行统计水平梯度能量。
   字幕行特征：细长、边缘密、跨越画面中部宽度 → 水平梯度能量显著高于画面其他行。
   多帧累加后取阈值为均值 + 2.2 标准差，再向下/向上扩边 12px，得到字幕带。
*/
function ffCapture(args, timeout = 60000) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    const chunks = [];
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, timeout);
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('error', () => { clearTimeout(timer); resolve(Buffer.alloc(0)); });
    proc.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}

export async function detectTextBand(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const M = meta(info);
  const W = M.W;
  const H = M.H;
  const sw = 480;
  const sh = Math.max(16, Math.round((sw * H) / W / 2) * 2);
  const fps = Math.max(0.2, Math.min(3, Number(opts.fps) || 1));
  const maxFrames = Math.max(2, Math.min(24, Number(opts.frames) || 8));
  const raw = await ffCapture(['-v', 'error', '-i', srcFile, '-vf', 'fps=' + fps + ',scale=' + sw + ':' + sh + ',format=gray', '-frames:v', String(maxFrames), '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  const frameBytes = sw * sh;
  const n = Math.floor(raw.length / frameBytes);
  if (!n) return null;
  const energy = new Float64Array(sh);
  for (let f = 0; f < n; f++) {
    const base = f * frameBytes;
    for (let y = 0; y < sh; y++) {
      let sum = 0;
      const off = base + y * sw;
      for (let x = 1; x < sw; x++) sum += Math.abs(raw[off + x] - raw[off + x - 1]);
      energy[y] += sum / (sw - 1);
    }
  }
  for (let y = 0; y < sh; y++) energy[y] /= n;
  let mean = 0;
  for (let y = 0; y < sh; y++) mean += energy[y];
  mean /= sh;
  let varr = 0;
  for (let y = 0; y < sh; y++) varr += (energy[y] - mean) ** 2;
  const sd = Math.sqrt(varr / sh);
  // 只在下 55% 找（字幕极少出现在画面上三分之一）
  const from = Math.floor(sh * 0.45);
  const th = Math.max(mean + sd * 2.2, mean * 1.35);
  let bestStart = -1; let bestLen = 0; let curStart = -1;
  for (let y = from; y <= sh; y++) {
    const hot = y < sh && energy[y] >= th;
    if (hot && curStart < 0) curStart = y;
    if (!hot && curStart >= 0) {
      const len = y - curStart;
      if (len > bestLen) { bestLen = len; bestStart = curStart; }
      curStart = -1;
    }
  }
  if (bestStart < 0 || bestLen < 3) return null;
  const padY = Math.round(sh * 0.014) + 2;
  const y0 = Math.max(0, bestStart - padY);
  const y1 = Math.min(sh, bestStart + bestLen + padY);
  const band = {
    x: 2, y: (y0 / sh) * 100, w: 96, h: ((y1 - y0) / sh) * 100,
    frames: n, confidence: Number(((energy.slice(bestStart, bestStart + bestLen).reduce((a, b) => a + b, 0) / Math.max(1, bestLen)) / Math.max(1e-6, mean)).toFixed(2))
  };
  return band;
}

/* 字幕擦除：basic=底部固定带插值；ocr=自动检测字幕带；fixed=自定义区域
   strong=true 时改用高斯模糊遮盖（大面积/复杂背景更稳） */
export async function eraseSubtitles(srcFile, opts = {}) {
  const mode = opts.mode || 'basic';
  let regions = null;
  let detected = null;
  if (mode === 'ocr') {
    detected = await detectTextBand(srcFile, opts);
    if (!detected) return { ok: false, error: '没有检测到字幕区域，请改用固定区域模式' };
    regions = [{ x: detected.x, y: detected.y, w: detected.w, h: detected.h }];
  } else if (mode === 'fixed') {
    regions = [{ x: opts.x, y: opts.y, w: opts.w, h: opts.h }];
  } else {
    regions = [{ x: 4, y: 74, w: 92, h: 20 }];
  }
  // patch（镜像填补）是硬字幕的最优解：背景纹理连贯、无糊块；窄区域用 delogo 更省算力
  const wide = regions[0].w >= 55;
  const emode = opts.eraseMode || (wide ? 'patch' : 'delogo');
  const out = await eraseRegions(srcFile, {
    mode: emode,
    strength: opts.strength || 3,
    regions,
    crf: opts.crf
  });
  return { ...out, detected, subtitleMode: mode };
}