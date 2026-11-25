import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, uid } from '../server/db.mjs';
import { runFF } from './ffmpeg.mjs';
import { canvas, encodePNG, hexToRgb } from './raster.mjs';

/* 画布新增节点（官方 canvas.nodeMenu）的本地实现
   table 表格节点 → 分镜单 / 自定义表格渲染成图
   threeDWorld 3D 世界 → 720° 全景（可接 1–4 张图或纯提示词）
   director 3D 导演台 → 复用 engine/stage.mjs
   upload 上传 → 只做素材校验，不重新渲染 */

const TMP = path.join(MEDIA, 'tmp');
const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';
const FONT_R = 'C\\:/Windows/Fonts/msyh.ttc';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function outN(kind, ext) {
  const id = uid('m_');
  const dir = path.join(MEDIA, kind);
  fs.mkdirSync(dir, { recursive: true });
  return { id, file: path.join(dir, id + ext), rel: '/media/' + kind + '/' + id + ext };
}

function writeTextFile(t) {
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, uid('txt_') + '.txt');
  fs.writeFileSync(f, String(t), 'utf8');
  return f;
}

/** 视觉宽度：中文/全角算 2，其余算 1 */
export function textWidth(s) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return w;
}

/** 把文本框里的表格解析成二维数组：支持 | 、制表符、逗号分隔 */
export function parseTableRows(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[-|:\s]+$/.test(l));
  return lines.map((l) => {
    const parts = l.includes('|') ? l.split('|') : l.includes('\t') ? l.split('\t') : l.split(/[,，]/);
    return parts.map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
  });
}

const DEFAULT_ROWS = [
  ['镜号', '景别', '画面描述', '台词'],
  ['01', '远景', '城市天际线，晨雾未散', '（环境声）'],
  ['02', '中景', '主角站在天台边缘回头', '我早就知道会这样。'],
  ['03', '近景', '眼神特写，瞳孔收缩', ''],
  ['04', '特写', '手指扣紧栏杆', '（心跳声）'],
  ['05', '全景', '镜头拉升，城市灯火亮起', '（配乐推进）'],
];

/** 表格 → 图片：本地光栅画网格，ffmpeg drawtext 写单元格文字 */
export async function renderTableImage(opts = {}) {
  let rows = Array.isArray(opts.rows) && opts.rows.length
    ? opts.rows.map((r) => (Array.isArray(r) ? r : String(r).split('|')))
    : (opts.text ? parseTableRows(opts.text) : DEFAULT_ROWS);
  rows = rows.slice(0, 14).map((r) => r.map((c) => String(c == null ? '' : c).trim()));
  if (!rows.length) rows = DEFAULT_ROWS;
  const cols = clamp(Math.max(...rows.map((r) => r.length)), 1, 6);
  const W = clamp(Math.round(Number(opts.width) || 1280), 640, 2048);
  const fs0 = clamp(Math.round(Number(opts.fontSize) || Math.round(W / 46)), 10, 34);
  const pad = Math.round(fs0 * 0.7);
  const rowH = Math.max(Math.round(fs0 * 2.5), Math.round(Number(opts.rowH) || 0) || 0);
  const title = String(opts.title || '').trim();
  const bandH = title ? Math.round(fs0 * 2.2) : 0;
  const H = bandH + rowH * rows.length;
  const head = opts.header !== false;

  /* 列宽：按各列最长视觉宽度分配，下限 88px */
  const weights = [];
  for (let c = 0; c < cols; c++) {
    let m = 4;
    for (const r of rows) m = Math.max(m, textWidth(r[c] || ''));
    weights.push(Math.max(4, m));
  }
  const totalW = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(88, Math.round((w / totalW) * W)));
  const scale = W / widths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < widths.length; i++) widths[i] = Math.round(widths[i] * scale);
  widths[widths.length - 1] = W - widths.slice(0, -1).reduce((a, b) => a + b, 0);

  const bg = hexToRgb(opts.bg || '#0e1621');
  const headBg = hexToRgb(opts.headBg || '#162736');
  const zebra = hexToRgb(opts.zebra || '#131e2b');
  const line = hexToRgb(opts.line || '#2c4159');
  const cv = canvas(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = Math.floor((y - bandH) / rowH);
      const base = head && r === 0 ? headBg : (r % 2 === 0 ? zebra : bg);
      cv.data[i] = base[0]; cv.data[i + 1] = base[1]; cv.data[i + 2] = base[2]; cv.data[i + 3] = 255;
    }
  }
  const put = (x, y, c) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const i = (yi * W + xi) * 4;
    cv.data[i] = c[0]; cv.data[i + 1] = c[1]; cv.data[i + 2] = c[2]; cv.data[i + 3] = 255;
  };
  const lw = Math.max(1, Math.round(W / 800));
  for (let r = 0; r <= rows.length; r++) {
    const y = Math.min(H - 1, bandH + r * rowH);
    for (let x = 0; x < W; x++) for (let t = 0; t < lw; t++) put(x, y + t, line);
  }
  let cx = 0;
  for (let c = 0; c <= cols; c++) {
    const x = Math.min(W - 1, cx);
    for (let y = bandH; y < H; y++) for (let t = 0; t < lw; t++) put(x + t, y, line);
    if (c < cols) cx += widths[c];
  }
  const o = outN('image', '.png');
  fs.writeFileSync(o.file, encodePNG(cv.data, W, H));

  /* 单元格文字 */
  const filters = [];
  const tmps = [];
  for (let r = 0; r < rows.length; r++) {
    let x = 0;
    for (let c = 0; c < cols; c++) {
      const cell = String(rows[r][c] == null ? '' : rows[r][c]);
      if (cell) {
        const fs = head && r === 0 ? Math.round(fs0 * 1.05) : fs0;
        const budget = Math.max(2, Math.floor((widths[c] - pad * 2) / (fs * 0.56)));
        const shown = textWidth(cell) > budget ? Array.from(cell).slice(0, Math.max(2, Math.floor(budget / 1.4))).join('') + '…' : cell;
        const f = writeTextFile(shown); tmps.push(f);
        const color = head && r === 0 ? '#bfe3ff' : '#e6eefb';
        const ty = bandH + r * rowH + Math.round((rowH - fs * 1.32) / 2);
        filters.push("drawtext=fontfile='" + (head && r === 0 ? FONT : FONT_R) + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + fs + ':fontcolor=' + color + ':x=' + (x + pad) + ':y=' + Math.max(0, ty));
      }
      x += widths[c];
    }
  }
  if (title) {
    const f = writeTextFile(title); tmps.push(f);
    filters.push("drawtext=fontfile='" + FONT + "':textfile='" + f.replace(/\\/g, '/').replace(':', '\\:') + "':fontsize=" + Math.round(fs0 * 1.15) + ':fontcolor=#7fd6ff:x=' + pad + ':y=' + Math.round((bandH - fs0 * 1.15 * 1.32) / 2) + ':shadowcolor=black@0.6:shadowx=2:shadowy=2');
  }
  if (filters.length) {
    const o2 = outN('image', '.png');
    const r = await runFF(['-y', '-i', o.file, '-vf', filters.join(','), o2.file]);
    for (const f of tmps) { try { fs.unlinkSync(f); } catch {} }
    if (r.ok) return { file: o2.file, rel: o2.rel, width: W, height: H, rows: rows.length, cols };
  }
  return { file: o.file, rel: o.rel, width: W, height: H, rows: rows.length, cols };
}

/** 3D 世界：把输入图（或提示词生成的底图）做成 720° 全景 */
export async function threeDWorld(srcFile, opts = {}) {
  const { panoramaImage, loadRGBA } = await import('./post.mjs');
  let base = srcFile;
  if (!base) {
    const { renderImage } = await import('./image.mjs');
    const plate = await renderImage({ prompt: opts.prompt || '3D 世界', width: 1280, height: 720, seedText: opts.seed || 'world' });
    base = plate.file;
  }
  const pano = await panoramaImage(base, { turns: clamp(Number(opts.turns) || 2, 1, 2), elevation: Number(opts.elevation) || 0 });
  const info = await loadRGBA(pano.file).catch(() => null);
  return { ...pano, width: info ? info.W : pano.width, height: info ? info.H : pano.height, source: srcFile ? 'image' : 'prompt' };
}
