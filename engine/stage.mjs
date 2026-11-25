import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, uid } from '../server/db.mjs';
import { canvas, encodePNG, fillLinear, addVignette, addNoise, hexToRgb, mixRGB, rect, addGlow } from './raster.mjs';
import { runFF } from './ffmpeg.mjs';

/* ============ 极简 3D 舞台渲染（画家算法，无第三方库）============ */

const DEG = Math.PI / 180;

function rotY(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

function project(p, cam, W, H) {
  const fov = Math.max(12, Math.min(110, cam.fov || 42)) * DEG;
  const f = (H / 2) / Math.tan(fov / 2);
  const yaw = (cam.yaw || 0) * DEG;
  const pitch = (cam.pitch || 0) * DEG;
  let v = { x: p.x - cam.pos.x, y: p.y - cam.pos.y, z: p.z - cam.pos.z };
  v = rotY(v, -yaw);
  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const vy = v.y * cp - v.z * sp;
  const vz = v.y * sp + v.z * cp;
  v = { x: v.x, y: vy, z: vz };
  const tz = -v.z;
  if (tz < 0.25) return null;
  return { x: W / 2 + (v.x * f) / tz, y: H / 2 - (v.y * f) / tz, z: tz, scale: f / tz };
}

function px(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
  const i = (y * cv.width + x) * 4;
  const alpha = Math.max(0, Math.min(1, a));
  cv.data[i] = cv.data[i] * (1 - alpha) + r * alpha;
  cv.data[i + 1] = cv.data[i + 1] * (1 - alpha) + g * alpha;
  cv.data[i + 2] = cv.data[i + 2] * (1 - alpha) + b * alpha;
  cv.data[i + 3] = 255;
}

function line(cv, x0, y0, x1, y1, rgb, a, width = 1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    for (let ox = 0; ox < width; ox++) for (let oy = 0; oy < width; oy++) px(cv, x + ox, y + oy, rgb[0], rgb[1], rgb[2], a);
  }
}

function ellipse(cv, cx, cy, rx, ry, rgb, a) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / Math.max(0.001, rx);
      const dy = (y - cy) / Math.max(0.001, ry);
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const edge = Math.min(1, (1 - d) * 6);
        px(cv, x, y, rgb[0], rgb[1], rgb[2], a * edge);
      }
    }
  }
}

function quad(cv, p0, p1, p2, p3, rgb, a) {
  const minx = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x, p3.x)));
  const maxx = Math.min(cv.width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x, p3.x)));
  const miny = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y, p3.y)));
  const maxy = Math.min(cv.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y, p3.y)));
  const edges = [[p0, p1], [p1, p2], [p2, p3], [p3, p0]];
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      let inside = true;
      for (const [a2, b2] of edges) {
        const cr = (b2.x - a2.x) * (y - a2.y) - (b2.y - a2.y) * (x - a2.x);
        if (cr < 0) { inside = false; break; }
      }
      if (inside) px(cv, x, y, rgb[0], rgb[1], rgb[2], a);
    }
  }
}

/** 渲染舞台一帧 */
export async function renderStage(proj, opts = {}) {
  const W = opts.width || 1280;
  const H = opts.height || 720;
  const cam = (proj.cameras || []).find((c) => c.id === (opts.cameraId || proj.activeCamera)) || (proj.cameras || [])[0] || { fov: 42, pos: { x: 0, y: 2.2, z: 8 }, yaw: 0, pitch: -4 };
  cam.yaw = cam.yaw === undefined ? 0 : cam.yaw;
  cam.pitch = cam.pitch === undefined ? -4 : cam.pitch;

  const stage = proj.stage || { width: 20, depth: 20 };
  const cv = canvas(W, H);

  /* 天空 */
  fillLinear(cv, [[0, 14, 18, 30], [0.52, 24, 30, 46], [1, 9, 11, 18]], 90);
  addGlow(cv, W * 0.72, H * 0.16, Math.round(H * 0.5), [70, 90, 150], 0.35);

  /* 地面网格（透视） */
  const gw = stage.width || 20, gd = stage.depth || 20;
  const gridRGB = [70, 84, 110];
  const halfW = gw / 2, halfD = gd / 2;
  const stepN = Math.max(2, Math.round(Math.max(gw, gd) / 2));
  for (let i = -stepN; i <= stepN; i++) {
    const t = i / stepN;
    const a = project({ x: -halfW, y: 0, z: t * halfD }, cam, W, H);
    const b = project({ x: halfW, y: 0, z: t * halfD }, cam, W, H);
    if (a && b) line(cv, a.x, a.y, b.x, b.y, gridRGB, 0.3);
    const c = project({ x: t * halfW, y: 0, z: -halfD }, cam, W, H);
    const d = project({ x: t * halfW, y: 0, z: halfD }, cam, W, H);
    if (c && d) line(cv, c.x, c.y, d.x, d.y, gridRGB, 0.3);
  }

  /* 收集可绘制对象并按深度排序 */
  const items = [];
  for (const ac of proj.actors || []) {
    const base = project({ x: ac.x || 0, y: 0, z: ac.z || 0 }, cam, W, H);
    const head = project({ x: ac.x || 0, y: (ac.height || 1.72), z: ac.z || 0 }, cam, W, H);
    if (!base || !head) continue;
    items.push({ kind: 'actor', z: base.z, base, head, ac });
  }
  for (const ob of proj.props || []) {
    const p = project({ x: ob.x || 0, y: (ob.height || 0.5) / 2, z: ob.z || 0 }, cam, W, H);
    if (!p) continue;
    items.push({ kind: 'prop', z: p.z, p, ob });
  }
  items.sort((a, b) => b.z - a.z);

  for (const it of items) {
    if (it.kind === 'actor') {
      const { base, head, ac } = it;
      const h = Math.max(6, base.y - head.y);
      const bodyW = Math.max(4, h * 0.22);
      const col = hexToRgb(ac.color || '#c9a227');
      const shade = Math.max(0.35, Math.min(1, 1.25 - it.z / 40));
      /* 地面阴影 */
      const pose = String(ac.pose || 'idle').toLowerCase();
      const look = ac.facing === undefined ? (ac.face || 0) : ac.facing;
      const headR = Math.max(3, h * 0.066);
      const neckY = head.y + headR * 2.0;
      const hipY = base.y - h * (pose === 'crouch' ? 0.34 : 0.46);
      const shoulderY = neckY + h * 0.03;
      const shoulderX = bodyW * 0.92;
      const lw = Math.max(1, Math.round(h * 0.038));
      const body = [col[0] * shade, col[1] * shade, col[2] * shade];
      const skin = mixRGB(col, [246, 232, 214], 0.66);
      const legSpread = bodyW * 0.34;
      ellipse(cv, base.x, base.y, bodyW * (pose === 'run' ? 1.7 : 1.25), bodyW * 0.34, [0, 0, 0], 0.45);

      /* 腿：按姿态分岔 */
      if (pose === 'run') {
        line(cv, base.x - legSpread, hipY, base.x - legSpread * 2.4, hipY + h * 0.20, body, 0.95, lw);
        line(cv, base.x - legSpread * 2.4, hipY + h * 0.20, base.x - legSpread * 2.0, base.y - h * 0.03, body, 0.9, lw);
        line(cv, base.x + legSpread, hipY, base.x + legSpread * 1.9, hipY + h * 0.16, body, 0.95, lw);
        line(cv, base.x + legSpread * 1.9, hipY + h * 0.16, base.x + legSpread * 2.6, base.y - h * 0.10, body, 0.9, lw);
      } else if (pose === 'crouch') {
        line(cv, base.x - legSpread, hipY, base.x - legSpread * 2.1, hipY + h * 0.16, body, 0.95, lw);
        line(cv, base.x - legSpread * 2.1, hipY + h * 0.16, base.x - legSpread * 1.5, base.y - h * 0.02, body, 0.9, lw);
        line(cv, base.x + legSpread, hipY, base.x + legSpread * 2.1, hipY + h * 0.16, body, 0.95, lw);
        line(cv, base.x + legSpread * 2.1, hipY + h * 0.16, base.x + legSpread * 1.5, base.y - h * 0.02, body, 0.9, lw);
      } else {
        line(cv, base.x - legSpread, hipY, base.x - legSpread * 1.5, base.y - h * 0.02, body, 0.95, lw);
        line(cv, base.x + legSpread, hipY, base.x + legSpread * 1.5, base.y - h * 0.02, body, 0.95, lw);
      }

      /* 躯干（梯形，肩宽腰窄） */
      const topL = { x: base.x - shoulderX, y: shoulderY };
      const topR = { x: base.x + shoulderX, y: shoulderY };
      quad(cv, topL, topR, { x: base.x + bodyW * 0.62, y: hipY }, { x: base.x - bodyW * 0.62, y: hipY }, body, 0.97);

      /* 手臂（肩 → 肘 → 腕），按姿态 */
      const elbowY = shoulderY + h * 0.22;
      const armOut = bodyW * 1.18;
      let eL, wL, eR, wR;
      if (pose === 'wave') {
        eL = { x: topL.x - (armOut - shoulderX), y: elbowY };
        wL = { x: topL.x - (armOut - shoulderX) + bodyW * 0.2, y: hipY + h * 0.02 };
        eR = { x: topR.x + (armOut - shoulderX) * 0.8, y: shoulderY - h * 0.10 };
        wR = { x: topR.x + (armOut - shoulderX) * 1.15, y: head.y + headR * 0.55 };
      } else if (pose === 'point') {
        eL = { x: topL.x - (armOut - shoulderX), y: elbowY };
        wL = { x: topL.x - (armOut - shoulderX) + bodyW * 0.2, y: hipY + h * 0.02 };
        eR = { x: topR.x + (armOut - shoulderX), y: shoulderY + h * 0.03 };
        wR = { x: topR.x + (armOut - shoulderX) * 2.05, y: shoulderY + h * 0.01 };
      } else if (pose === 'run') {
        eL = { x: topL.x - (armOut - shoulderX) * 0.9, y: shoulderY + h * 0.12 };
        wL = { x: topL.x - (armOut - shoulderX) * 0.4, y: shoulderY - h * 0.04 };
        eR = { x: topR.x + (armOut - shoulderX) * 0.9, y: shoulderY + h * 0.20 };
        wR = { x: topR.x + (armOut - shoulderX) * 0.5, y: hipY + h * 0.06 };
      } else if (pose === 'crouch') {
        eL = { x: topL.x - (armOut - shoulderX) * 0.9, y: shoulderY + h * 0.18 };
        wL = { x: topL.x - (armOut - shoulderX) * 0.5, y: hipY + h * 0.10 };
        eR = { x: topR.x + (armOut - shoulderX) * 0.9, y: shoulderY + h * 0.18 };
        wR = { x: topR.x + (armOut - shoulderX) * 0.5, y: hipY + h * 0.10 };
      } else {
        eL = { x: topL.x - (armOut - shoulderX), y: elbowY };
        wL = { x: topL.x - (armOut - shoulderX) + bodyW * 0.2, y: hipY + h * 0.02 };
        eR = { x: topR.x + (armOut - shoulderX), y: elbowY };
        wR = { x: topR.x + (armOut - shoulderX) - bodyW * 0.2, y: hipY + h * 0.02 };
      }
      line(cv, topL.x, shoulderY + h * 0.012, eL.x, eL.y, body, 0.92, lw);
      line(cv, eL.x, eL.y, wL.x, wL.y, body, 0.9, lw);
      line(cv, topR.x, shoulderY + h * 0.012, eR.x, eR.y, body, 0.92, lw);
      line(cv, eR.x, eR.y, wR.x, wR.y, body, 0.9, lw);
      /* 手 */
      ellipse(cv, wL.x, wL.y, headR * 0.34, headR * 0.34, skin, 0.95);
      ellipse(cv, wR.x, wR.y, headR * 0.34, headR * 0.34, skin, 0.95);
      /* 脖子 */
      line(cv, base.x, neckY, base.x, shoulderY + 1, skin, 0.9, Math.max(2, Math.round(headR * 0.9)));
      /* 头部 */
      ellipse(cv, head.x, head.y + headR * 1.05, headR, headR * 1.12, skin, 0.98);
      /* 朝向标记（鼻尖方向） */
      const fx = head.x + Math.sin(look * DEG) * headR * 0.72;
      const fy = head.y + headR * 1.05 - Math.cos(look * DEG) * headR * 0.72 * 0.7;
      ellipse(cv, fx, fy, headR * 0.13, headR * 0.13, [46, 34, 30], 0.85);
      /* 名字 */
      if (ac.name) {
        const label = ac.name;
        const lx = base.x + bodyW * 1.2;
        const ly = head.y + headR * 0.2;
        rect(cv, lx - 2, ly - 2, Math.min(160, label.length * 13 + 12), 20, [0, 0, 0, 0.45]);
        items.push({ kind: 'label', x: lx + 4, y: ly + 14, text: label, col });
      }
    } else if (it.kind === 'prop') {
      const { p, ob } = it;
      const w = Math.max(4, (ob.width || 1) * p.scale * 0.5);
      const hh = Math.max(4, (ob.height || 1) * p.scale * 0.5);
      const col = hexToRgb(ob.color || '#3a4a5f');
      const shade = Math.max(0.4, Math.min(1, 1.2 - it.z / 40));
      ellipse(cv, p.x, p.y + hh * 0.9, w * 0.9, hh * 0.3, [0, 0, 0], 0.4);
      rect(cv, p.x - w / 2, p.y - hh / 2, w, hh, [col[0] * shade, col[1] * shade, col[2] * shade, 0.95]);
    }
  }

  addVignette(cv, 0.5);
  addNoise(cv, 5);

  /* 文字用 ffmpeg 叠（PNG 里没有字形） */
  const id = uid('stage_');
  const dir = path.join(MEDIA, 'image');
  fs.mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, id + '_raw.png');
  const out = path.join(dir, id + '.png');
  fs.writeFileSync(raw, encodePNG(cv.data, W, H));

  const labels = items.filter((i) => i.kind === 'label');
  const hud = [proj.title || '导演台', '机位：' + (cam.name || '主摄') + '　FOV ' + (cam.fov || 42) + '°'].join('\n');
  const txtFile = path.join(MEDIA, 'upload', 'stage_' + id + '.txt');
  fs.mkdirSync(path.dirname(txtFile), { recursive: true });
  fs.writeFileSync(txtFile, hud, 'utf8');

  /* 演员名牌底板先画进像素 */
  for (const lb of labels) {
    const lw = Math.min(200, String(lb.text).length * 14 + 12);
    rect(cv, lb.x - 3, lb.y - 14, lw, 19, [0, 0, 0, 0.42]);
  }
  fs.writeFileSync(raw, encodePNG(cv.data, W, H));

  const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';
  const esc = (f) => f.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
  const filt = [
    "drawtext=fontfile='" + FONT + "':textfile='" + esc(txtFile) + "':fontsize=34:fontcolor=white@0.92:x=48:y=40:line_spacing=10"
  ];
  labels.forEach((lb, i) => {
    const lf = path.join(MEDIA, 'upload', 'lb_' + i + '_' + id + '.txt');
    fs.writeFileSync(lf, String(lb.text), 'utf8');
    const hexc = '0x' + lb.col.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    filt.push("drawtext=fontfile='" + FONT + "':textfile='" + esc(lf) + "':fontsize=15:fontcolor=" + hexc + "@0.98:x=" + Math.round(lb.x) + ":y=" + Math.round(lb.y - 10));
  });
  const r = await runFF(['-y', '-i', raw, '-vf', filt.join(','), out]);
  try { fs.unlinkSync(txtFile); } catch {}
  labels.forEach((lb, i) => { try { fs.unlinkSync(path.join(MEDIA, 'upload', 'lb_' + i + '_' + id + '.txt')); } catch {} });
  if (!r.ok) {
    try { fs.copyFileSync(raw, out); } catch {}
    console.error('[stage] drawtext 失败，回退纯图：', String(r.log || ''));
  }
  try { fs.unlinkSync(raw); } catch {}
  return { id, file: out, rel: '/media/image/' + id + '.png', width: W, height: H };
}

