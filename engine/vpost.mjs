import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, uid } from '../server/db.mjs';
import { runFF, probe } from './ffmpeg.mjs';

/* 视频后期（官方 canvas.videoPost 能力族的本地实现）
   freezeFrameExtend 冻帧延长 · videoParse 视频拉片 · audioSeparate 音频提取/分离
   depthCapture 深度动捕 · frameCapture 截帧 · localRepaint 片段重拍 */

const TMP = path.join(MEDIA, 'tmp');

export function outV(kind, ext) {
  const id = uid('m_');
  const dir = path.join(MEDIA, kind);
  fs.mkdirSync(dir, { recursive: true });
  return { id, file: path.join(dir, id + ext), rel: '/media/' + kind + '/' + id + ext };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export async function infoOf(file) {
  const info = await probe(file);
  const vs = ((info && info.streams) || []).find((s) => s.codec_type === 'video') || {};
  const as = ((info && info.streams) || []).find((s) => s.codec_type === 'audio') || null;
  return {
    width: Math.round(Number(vs.width) || 1280),
    height: Math.round(Number(vs.height) || 720),
    fps: Math.round(Number(String(vs.r_frame_rate || '24/1').split('/')[0]) / Math.max(1, Number(String(vs.r_frame_rate || '24/1').split('/')[1] || 1))) || 24,
    duration: Number((info && info.format && info.format.duration) || 0) || 0,
    hasAudio: !!as,
  };
}

/* ---------- 冻帧延长：末尾定格 N 秒，音轨补静音 ---------- */
export async function freezeExtend(srcFile, opts = {}) {
  const at = opts.at === 'end' || opts.at === undefined ? null : Number(opts.at);
  const sec = clamp(Number(opts.seconds) || 2, 0.5, 15);
  const info = await infoOf(srcFile);
  const o = outV('video', '.mp4');
  const pad = 'tpad=stop_mode=clone:stop_duration=' + sec;
  const args = ['-y'];
  if (at !== null && at > 0) args.push('-ss', String(at));
  args.push('-i', srcFile, '-vf', pad);
  if (info.hasAudio) args.push('-af', 'apad=pad_dur=' + sec, '-c:a', 'aac', '-b:a', '160k');
  else args.push('-an');
  args.push('-t', String((info.duration || 0) + sec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.file);
  const r = await runFF(args);
  if (!r.ok) throw new Error('冻帧延长失败：' + String(r.log || '').slice(-200));
  return { file: o.file, rel: o.rel, seconds: sec, duration: Math.round(((info.duration || 0) + sec) * 10) / 10, width: info.width, height: info.height };
}

/* ---------- 截帧：单帧 / 多帧联系表 ---------- */
export async function frameCapture(srcFile, opts = {}) {
  const info = await infoOf(srcFile);
  const count = clamp(Math.round(Number(opts.count) || 1), 1, 12);
  const at = opts.at === undefined || opts.at === '' ? null : clamp(Number(opts.at), 0, Math.max(0, (info.duration || 1) - 0.05));
  const files = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? (at === null ? Math.max(0, (info.duration || 1) * 0.5) : at) : ((info.duration || 1) * (i + 0.5)) / count;
    const o = outV('image', '.png');
    const r = await runFF(['-y', '-ss', t.toFixed(3), '-i', srcFile, '-frames:v', '1', o.file]);
    if (r.ok) files.push({ ...o, at: Math.round(t * 10) / 10 });
  }
  if (!files.length) throw new Error('截帧失败');
  if (count === 1) return { file: files[0].file, rel: files[0].rel, at: files[0].at, count: 1, width: info.width, height: info.height };
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(files.length / cols);
  const cw = Math.round(640 / 2) * 2, ch = Math.round((cw * info.height) / Math.max(1, info.width) / 2) * 2;
  const o2 = outV('image', '.png');
  const inputs = files.flatMap((f) => ['-i', f.file]);
  const scaled = files.map((f, i) => '[' + i + ':v]scale=' + cw + ':' + ch + ',setsar=1[v' + i + ']').join(';');
  const layout = files.map((f, i) => (i % cols) * cw + '_' + Math.floor(i / cols) * ch).join('|');
  const fc = scaled + ';' + files.map((f, i) => '[v' + i + ']').join('') + 'xstack=inputs=' + files.length + ':layout=' + layout + ':fill=black[out]';
  const r2 = await runFF(['-y', ...inputs, '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', o2.file]);
  if (!r2.ok) throw new Error('联系表生成失败：' + String(r2.log || '').slice(-200));
  return { file: o2.file, rel: o2.rel, count: files.length, cols, rows, frames: files.map((f) => ({ rel: f.rel, at: f.at })) };
}

/* ---------- 音频提取 / 分离 ---------- */
export const AUDIO_MODES = {
  track: { label: '只保留音轨', desc: '导出原音轨为音频文件' },
  vocal: { label: '提取人声', desc: '中置声道相加，突出对白' },
  bgm: { label: '提取背景声', desc: '中置声道相减，去掉人声留配乐' },
  none: { label: '去掉音轨', desc: '输出无声视频' },
};

export async function audioSeparate(srcFile, opts = {}) {
  const mode = AUDIO_MODES[opts.mode] ? opts.mode : 'track';
  const info = await infoOf(srcFile);
  if (!info.hasAudio && mode !== 'none') throw new Error('该视频没有音轨，无法分离音频');
  if (mode === 'none') {
    const o = outV('video', '.mp4');
    const r = await runFF(['-y', '-i', srcFile, '-c:v', 'copy', '-an', o.file]);
    if (!r.ok) throw new Error('去音轨失败：' + String(r.log || '').slice(-160));
    return { file: o.file, rel: o.rel, mode, kind: 'video', width: info.width, height: info.height };
  }
  const pan = mode === 'vocal'
    ? 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1'
    : mode === 'bgm'
      ? 'pan=stereo|c0=c0-c1|c1=c1-c0'
      : null;
  const o = outV('audio', '.mp3');
  const args = ['-y', '-i', srcFile, '-vn'];
  if (pan) args.push('-af', pan);
  args.push('-c:a', 'libmp3lame', '-b:a', '192k', o.file);
  const r = await runFF(args);
  if (!r.ok) throw new Error('音频分离失败：' + String(r.log || '').slice(-200));
  return { file: o.file, rel: o.rel, mode, modeName: AUDIO_MODES[mode].label, kind: 'audio', duration: info.duration };
}

/* ---------- 深度动捕（深度图近似）：灰度景深 + 边缘增强 + 伪彩 ---------- */
export async function depthCapture(srcFile, opts = {}) {
  const info = await infoOf(srcFile);
  const at = opts.at === undefined || opts.at === '' ? 0 : clamp(Number(opts.at), 0, Math.max(0, (info.duration || 1) - 0.05));
  const color = opts.color === '1' || opts.color === true;
  const o = outV('image', '.png');
  const base = 'format=gray,gblur=sigma=6,eq=contrast=1.25:brightness=0.02,unsharp=5:5:1.2:5:5:0';
  const vf = color ? base + ',pseudocolor=preset=turbo' : base;
  const r = await runFF(['-y', '-ss', String(at), '-i', srcFile, '-vf', vf, '-frames:v', '1', o.file]);
  if (!r.ok) {
    /* pseudocolor 不可用时退回灰度 */
    const r2 = await runFF(['-y', '-ss', String(at), '-i', srcFile, '-vf', base, '-frames:v', '1', o.file]);
    if (!r2.ok) throw new Error('深度图生成失败：' + String(r2.log || '').slice(-200));
  }
  return { file: o.file, rel: o.rel, at, color, width: info.width, height: info.height };
}

/* ---------- 视频拉片：抽帧联系表 + 分镜表 ---------- */
export async function videoParse(srcFile, opts = {}) {
  const info = await infoOf(srcFile);
  const dur = info.duration || 1;
  const cuts = [];
  const log = await runFF(['-y', '-i', srcFile, '-vf', "select='gt(scene,0.32)',showinfo", '-f', 'null', '-']);
  for (const line of String(log.log || '').split(/\r?\n/)) {
    const m = /pts_time:([0-9.]+)/.exec(line);
    if (m) cuts.push(Math.round(Number(m[1]) * 10) / 10);
  }
  const marks = [0, ...cuts.filter((t) => t > 0.4 && t < dur - 0.2), dur];
  const shots = [];
  const sheet = await frameCapture(srcFile, { count: clamp(marks.length - 1, 2, 9) });
  for (let i = 0; i < marks.length - 1 && i < 12; i++) {
    shots.push({
      no: String(i + 1).padStart(2, '0'),
      from: marks[i], to: marks[i + 1],
      dur: Math.round((marks[i + 1] - marks[i]) * 10) / 10,
      size: (marks[i + 1] - marks[i]) > dur / 3 ? '远景' : (marks[i + 1] - marks[i]) > dur / 8 ? '中景' : '近景',
    });
  }
  const { renderTableImage } = await import('./nodes.mjs');
  const rows = [['镜号', '时间', '时长', '估计景别', '画面描述']];
  for (const s of shots) rows.push([s.no, s.from.toFixed(1) + 's–' + s.to.toFixed(1) + 's', s.dur.toFixed(1) + 's', s.size, '（待补充）']);
  const table = await renderTableImage({ title: '拉片表 · ' + Math.round(dur) + 's', rows, width: 1280 });
  return {
    file: sheet.file, rel: sheet.rel, sheetRel: sheet.rel,
    tableRel: table.rel, tableFile: table.file,
    shots, cuts: cuts.length, duration: Math.round(dur * 10) / 10,
    width: info.width, height: info.height, hasAudio: info.hasAudio,
  };
}

/* ---------- 片段重拍：替换 [start,end] 为按提示词新生成的一段 ---------- */
async function silentSeg(srcFile, from, to) {
  const info = await infoOf(srcFile);
  const o = outV('video', '.mp4');
  const dur = Math.max(0.4, to - from);
  const r = await runFF(['-y', '-ss', String(from), '-t', String(dur), '-i', srcFile,
    '-vf', 'scale=' + info.width + ':' + info.height + ':force_original_aspect_ratio=decrease,pad=' + info.width + ':' + info.height + ':(ow-iw)/2:(oh-ih)/2,fps=' + info.fps,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', o.file]);
  if (!r.ok) throw new Error('切片失败：' + String(r.log || '').slice(-160));
  return { file: o.file, dur, width: info.width, height: info.height, fps: info.fps };
}

export async function localRepaint(srcFile, opts = {}) {
  const info = await infoOf(srcFile);
  const start = clamp(Number(opts.start) || 0, 0, Math.max(0, info.duration - 0.5));
  const end = clamp(Number(opts.end) || Math.min(info.duration, start + 2), start + 0.5, info.duration);
  const { renderImage } = await import('./image.mjs');
  const { renderShot } = await import('./video.mjs');
  const plate = await renderImage({ prompt: opts.prompt || '重拍片段', width: info.width, height: info.height, seedText: 'repaint' + start });
  const shot = await renderShot({ imageFile: plate.file, duration: Math.max(0.6, end - start), motion: opts.motion || 'zoom-in' });
  const segs = [];
  if (start > 0.2) segs.push((await silentSeg(srcFile, 0, start)).file);
  segs.push(shot.file);
  if (info.duration - end > 0.2) segs.push((await silentSeg(srcFile, end, info.duration)).file);
  const listFile = path.join(TMP, uid('cat_') + '.txt');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(listFile, segs.map((f) => "file '" + f.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
  const o = outV('video', '.mp4');
  const r = await runFF(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', o.file]);
  try { fs.unlinkSync(listFile); } catch {}
  if (!r.ok) throw new Error('片段重拍失败：' + String(r.log || '').slice(-200));
  return { file: o.file, rel: o.rel, start, end, replaced: Math.round((end - start) * 10) / 10, width: info.width, height: info.height, segments: segs.length };
}

export const VPOST_CAPS = [
  { key: 'freeze-extend', label: '冻帧延长', desc: '末尾定格若干秒，音轨自动补静音', src: 'video' },
  { key: 'frame-capture', label: '截帧', desc: '单帧导出或多帧联系表', src: 'video' },
  { key: 'audio-separate', label: '音频提取', desc: '音轨 / 人声 / 背景声 / 去音轨', src: 'video' },
  { key: 'depth-capture', label: '深度动捕', desc: '生成景深灰度图或伪彩深度图', src: 'video' },
  { key: 'video-parse', label: '视频拉片', desc: '自动切分镜头，出联系表与分镜表', src: 'video' },
  { key: 'local-repaint', label: '片段重拍', desc: '替换指定时间段为重新生成的一段', src: 'video' },
];
