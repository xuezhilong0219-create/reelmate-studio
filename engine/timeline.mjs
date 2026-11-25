import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, ROOT, uid } from '../server/db.mjs';
import { runFF, probe } from './ffmpeg.mjs';

/* 时间线剪辑台引擎（对应官方 /agent/editor 与画布 clip 节点）
   多轨：V1/V2 视频轨 + A1/A2 音频轨；片段支持 起点/入点/出点/变速/音量
   导出流程：逐段归一化(裁剪+变速+缩放+补边+fps) → 空隙补黑 → concat → 音轨 atempo+adelay 混音 → 合流 */

const TMP = path.join(MEDIA, 'tmp');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function outT(kind, ext) {
  const id = uid('m_');
  const dir = path.join(MEDIA, kind);
  fs.mkdirSync(dir, { recursive: true });
  return { id, file: path.join(dir, id + ext), rel: '/media/' + kind + '/' + id + ext };
}

/** atempo 只支持 0.5–2.0，超出时串联多级 */
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push('atempo=' + s.toFixed(4));
  return parts.join(',');
}

async function hasAudio(file) {
  const info = await probe(file);
  return Boolean(info && (info.streams || []).some((s) => s.codec_type === 'audio'));
}

async function durationOf(file) {
  const info = await probe(file);
  return Number((info && info.format && info.format.duration) || 0) || 0;
}

/** 把一个片段渲染成统一参数的无声 mp4 */
async function segment(clip, dims, fps) {
  const src = clip.file;
  const sp = clamp(num(clip.speed, 1), 0.25, 4);
  const inPt = Math.max(0, num(clip.in, 0));
  const outPt = num(clip.out, 0) > inPt ? num(clip.out, 0) : inPt + Math.max(0.2, num(clip.len, 2));
  const len = Math.max(0.15, outPt - inPt);
  const o = outT('tmpv', '.mp4');
  const vf = 'scale=' + dims.w + ':' + dims.h + ':force_original_aspect_ratio=decrease,'
    + 'pad=' + dims.w + ':' + dims.h + ':(ow-iw)/2:(oh-ih)/2:color=black,'
    + 'fps=' + fps + ',setsar=1,setpts=PTS/' + sp;
  const r = await runFF(['-y', '-ss', String(inPt), '-t', String(len), '-i', src, '-vf', vf, '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', o.file], { timeout: 300000 });
  if (!r.ok) throw new Error('片段渲染失败：' + String(r.log || '').slice(-180));
  return { file: o.file, dur: len / sp };
}

/** 生成纯黑空隙片段 */
async function filler(sec, dims, fps) {
  const o = outT('tmpv', '.mp4');
  const r = await runFF(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=' + dims.w + 'x' + dims.h + ':r=' + fps,
    '-t', String(sec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', o.file], { timeout: 120000 });
  if (!r.ok) throw new Error('空隙渲染失败：' + String(r.log || '').slice(-160));
  return o.file;
}

/** 单条音轨上某个片段 → 带 delay 的 wav */
async function audioPart(clip, start, dur, speed) {
  const o = outT('tmpa', '.wav');
  const vol = clamp(num(clip.volume, 1), 0, 3);
  const delay = Math.max(0, Math.round(start * 1000));
  const has = await hasAudio(clip.file);
  const af = (has ? atempoChain(speed) + ',' : '') + 'volume=' + vol.toFixed(3) + ',adelay=' + delay + '|' + delay;
  const args = has
    ? ['-y', '-ss', String(Math.max(0, num(clip.in, 0))), '-t', String(Math.max(0.15, (num(clip.out, 0) || num(clip.len, dur)) - num(clip.in, 0))), '-i', clip.file]
    : ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  if (!has) args.push('-t', String(Math.max(dur, start + dur)));
  args.push('-vn', '-af', af, '-ar', '48000', '-ac', '2', o.file);
  const r = await runFF(args, { timeout: 180000 });
  if (!r.ok) return null;
  return o.file;
}

/**
 * 导出时间线
 * @param {object} p { width, height, fps, clips:[{track,start,in,out,speed,volume,file,name}] }
 */
export async function renderTimeline(p = {}, onProgress = () => {}) {
  const dims = { w: Math.round(num(p.width, 1280)), h: Math.round(num(p.height, 720)) };
  dims.w += dims.w % 2; dims.h += dims.h % 2;
  const fps = clamp(Math.round(num(p.fps, 24)), 12, 60);
  const all = (p.clips || []).filter((c) => c && c.file && fs.existsSync(c.file));
  const vClips = all.filter((c) => String(c.track || 'V1').startsWith('V')).sort((a, b) => num(a.start) - num(b.start));
  const aClips = all.filter((c) => String(c.track || 'V1').startsWith('A')).sort((a, b) => num(a.start) - num(b.start));
  if (!vClips.length && !aClips.length) throw new Error('时间线上没有可用片段');

  fs.mkdirSync(TMP, { recursive: true });
  onProgress(8, '归一化片段');

  /* 1) 视频轨：按起点顺序铺，空隙补黑 */
  const seq = [];
  let cursor = 0;
  for (let i = 0; i < vClips.length; i++) {
    const c = vClips[i];
    const start = Math.max(0, num(c.start, cursor));
    if (start > cursor + 0.04) { seq.push(await filler(start - cursor, dims, fps)); cursor = start; }
    const seg = await segment(c, dims, fps);
    seq.push(seg.file);
    cursor = Math.max(cursor, start) + seg.dur;
    onProgress(8 + Math.round((i + 1) / Math.max(1, vClips.length) * 46), '渲染片段 ' + (i + 1) + '/' + vClips.length);
  }

  /* 2) 拼接 */
  onProgress(58, '拼接');
  const listFile = path.join(TMP, uid('tl_') + '.txt');
  fs.writeFileSync(listFile, seq.map((f) => "file '" + f.replace(/\\/g, '/') + "'").join('\n'), 'utf8');
  const silent = outT('tmpv', '.mp4');
  const cr = await runFF(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264',
    '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an', silent.file], { timeout: 600000 });
  try { fs.unlinkSync(listFile); } catch {}
  if (!cr.ok) throw new Error('拼接失败：' + String(cr.log || '').slice(-200));
  const videoDur = await durationOf(silent.file);

  /* 3) 音轨混音（视频自带音 + 独立音频轨） */
  onProgress(72, '混音');
  const parts = [];
  for (const c of vClips) {
    const sp = clamp(num(c.speed, 1), 0.25, 4);
    const dur = (Math.max(0.15, (num(c.out, 0) || num(c.len, 2)) - num(c.in, 0))) / sp;
    const f = await audioPart(c, num(c.start, 0), dur, sp);
    if (f) parts.push(f);
  }
  for (const c of aClips) {
    const sp = clamp(num(c.speed, 1), 0.25, 4);
    const dur = (Math.max(0.15, (num(c.out, 0) || num(c.len, 2)) - num(c.in, 0))) / sp;
    const f = await audioPart(c, num(c.start, 0), dur, sp);
    if (f) parts.push(f);
  }

  const final = outT('video', '.mp4');
  if (!parts.length) {
    fs.copyFileSync(silent.file, final.file);
  } else {
    const args = ['-y', '-i', silent.file];
    for (const f of parts) args.push('-i', f);
    const inputs = parts.map((_, i) => '[' + (i + 1) + ':a]').join('');
    const fc = inputs + 'amix=inputs=' + parts.length + ':normalize=0:duration=longest:dropout_transition=0,apad[aout]';
    args.push('-filter_complex', fc, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', String(Math.max(0.2, videoDur)), final.file);
    const r = await runFF(args, { timeout: 300000 });
    if (!r.ok) {
      fs.copyFileSync(silent.file, final.file);
    }
  }
  onProgress(96, '收尾');
  const dur = await durationOf(final.file);
  for (const f of seq) { try { fs.unlinkSync(f); } catch {} }
  for (const f of parts) { try { fs.unlinkSync(f); } catch {} }
  return { file: final.file, rel: final.rel, width: dims.w, height: dims.h, fps, duration: dur || videoDur, clips: all.length };
}

/** 素材面板：按剧集聚合分镜 + 全部视频/音频资产 */
export function collectMaterials(d) {
  const eps = new Map((d.episodes || []).map((e) => [e.id, e]));
  const rows = [];
  for (const sb of d.storyboards || []) {
    if (!sb.videoRel && !sb.imageRel) continue;
    const ep = eps.get(sb.episodeId);
    rows.push({ id: sb.id, kind: sb.videoRel ? 'video' : 'image', name: (ep ? '第' + ep.no + '集 · ' : '') + (sb.caption || '分镜 ' + sb.no), rel: sb.videoRel || sb.imageRel, group: ep ? '第' + ep.no + '集' : '未分集' });
  }
  for (const a of d.assets || []) {
    if (a.kind !== 'video' && a.kind !== 'audio') continue;
    rows.push({ id: a.id, kind: a.kind, name: a.name, rel: a.rel, group: a.kind === 'audio' ? '音频' : '视频素材', duration: a.duration || null });
  }
  return rows;
}
