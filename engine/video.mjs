import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, ROOT, uid } from '../server/db.mjs';
import { runFF, probe } from './ffmpeg.mjs';
import { renderPlate, renderImage, PALETTES, pickPalette } from './image.mjs';
import { renderMusic, renderSfx, renderSpeech, pickMood } from './audio.mjs';
import { hashSeed } from '../server/util.mjs';

export const MOTIONS = {
  'zoom-in':     { label: '推镜（Zoom In）',   expr: 'zoom+0.0012', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  'zoom-out':    { label: '拉镜（Zoom Out）',  expr: 'if(eq(on,1),1.45,max(zoom-0.0012,1.0))', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  'pan-left':    { label: '左移（Pan Left）',  expr: '1.15', x: '(iw-iw/zoom)*(1-on/(N-1))', y: 'ih/2-(ih/zoom/2)' },
  'pan-right':   { label: '右移（Pan Right）', expr: '1.15', x: '(iw-iw/zoom)*(on/(N-1))', y: 'ih/2-(ih/zoom/2)' },
  'tilt-up':     { label: '上摇（Tilt Up）',   expr: '1.2', x: 'iw/2-(iw/zoom/2)', y: '(ih-ih/zoom)*(1-on/(N-1))' },
  'tilt-down':   { label: '下摇（Tilt Down）', expr: '1.2', x: 'iw/2-(iw/zoom/2)', y: '(ih-ih/zoom)*(on/(N-1))' },
  'dolly':       { label: '滑轨（Dolly）',     expr: '1.1', x: '(iw-iw/zoom)*(on/(N-1))', y: 'ih/2-(ih/zoom/2)' },
  'static':      { label: '固定机位',          expr: '1.02', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  'handheld':    { label: '手持感',            expr: '1.08+0.02*sin(on/3)', x: 'iw/2-(iw/zoom/2)+4*sin(on/2.2)', y: 'ih/2-(ih/zoom/2)+4*cos(on/2.7)' },
  'crash':       { label: '甩镜（Crash Zoom）', expr: 'min(zoom+0.006,1.8)', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
};

export const TRANSITIONS = [
  { id: 'fade', label: '淡入淡出', xfade: 'fade' },
  { id: 'dissolve', label: '溶解', xfade: 'dissolve' },
  { id: 'slideleft', label: '左滑', xfade: 'slideleft' },
  { id: 'slideright', label: '右滑', xfade: 'slideright' },
  { id: 'slideup', label: '上滑', xfade: 'slideup' },
  { id: 'wipeleft', label: '擦除左', xfade: 'wipeleft' },
  { id: 'circleopen', label: '圆形展开', xfade: 'circleopen' },
  { id: 'pixelize', label: '像素化', xfade: 'pixelize' },
  { id: 'radial', label: '径向', xfade: 'radial' },
  { id: 'none', label: '硬切', xfade: null },
];

export const LOOKS = {
  none:      { label: '原始',        filter: '' },
  warm:      { label: '暖调',        filter: 'colorbalance=rs=0.06:gs=0.02:bs=-0.06,eq=saturation=1.08' },
  cool:      { label: '冷调',        filter: 'colorbalance=rs=-0.05:gs=0.0:bs=0.08,eq=saturation=1.02' },
  noir:      { label: '黑白',        filter: 'hue=s=0,eq=contrast=1.18:brightness=-0.02' },
  teal:      { label: '青橙',        filter: 'colorbalance=rs=0.04:bs=0.10,curves=preset=strong_contrast' },
  vintage:   { label: '复古胶片',    filter: 'curves=preset=vintage,eq=contrast=1.05:saturation=0.9,noise=alls=6:allf=t' },
  highcontrast: { label: '高对比',   filter: 'eq=contrast=1.3:brightness=0.02:saturation=1.12' },
  soft:      { label: '柔光',        filter: 'gblur=sigma=1.2,eq=brightness=0.04:saturation=1.05' },
  dreamy:    { label: '梦幻',        filter: 'gblur=sigma=2.4,eq=brightness=0.06:saturation=1.1,colorbalance=rs=0.05:bs=0.05' },
  punch:     { label: '冲击',        filter: 'eq=contrast=1.28:saturation=1.35:brightness=-0.01,unsharp=5:5:0.9' },
};

const rndOf = (seed) => { let s = (seed >>> 0) || 11; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const esc = (s) => String(s || '').replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';
const FONT_R = 'C\\:/Windows/Fonts/msyh.ttc';

function writeTmp(name, text) {
  const dir = path.join(ROOT, '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name + '_' + uid('') + '.txt');
  fs.writeFileSync(p, String(text || '').replace(/[\r\n]+/g, ' ').trim(), 'utf8');
  return p.replace(/\\/g, '/').replace(':', '\\:');
}

/** 单镜头：静帧 + 运镜 + 可选字幕 → mp4 */
export async function renderShot(opts = {}) {
  const {
    imageFile, duration = 5, fps = 24, width = 1280, height = 720,
    motion = 'zoom-in', look = 'none', subtitle = '', caption = '',
    fadeIn = 0.35, fadeOut = 0.35, index = 0, filmGrain = 0,
    letterbox = false, watermark = '',
  } = opts;

  const dur = Math.max(0.6, Number(duration) || 5);
  const frames = Math.max(2, Math.round(dur * fps));
  const mo = MOTIONS[motion] || MOTIONS['zoom-in'];
  const lk = LOOKS[look] || LOOKS.none;

  const vf = [];
  vf.push('scale=' + width + ':' + height + ':force_original_aspect_ratio=increase');
  vf.push('crop=' + width + ':' + height);
  vf.push('zoompan=z=\'' + mo.expr.replace(/N/g, String(frames)) + '\':x=\'' + mo.x.replace(/N/g, String(frames)) + '\':y=\'' + mo.y.replace(/N/g, String(frames)) + '\':d=' + frames + ':s=' + width + 'x' + height + ':fps=' + fps);
  if (lk.filter) vf.push(lk.filter);
  if (filmGrain) vf.push('noise=alls=' + filmGrain + ':allf=t');
  if (letterbox) {
    const bar = Math.round(height * 0.06);
    vf.push('drawbox=x=0:y=0:w=' + width + ':h=' + bar + ':color=black:t=fill');
    vf.push('drawbox=x=0:y=' + (height - bar) + ':w=' + width + ':h=' + bar + ':color=black:t=fill');
  }
  if (fadeIn > 0) vf.push('fade=t=in:st=0:d=' + fadeIn.toFixed(2));
  if (fadeOut > 0) vf.push('fade=t=out:st=' + Math.max(0, dur - fadeOut).toFixed(2) + ':d=' + fadeOut.toFixed(2));

  if (subtitle) {
    const f = writeTmp('sub', subtitle);
    vf.push("drawtext=fontfile='" + FONT + "':textfile='" + f + "':fontsize=" + Math.round(Math.min(width, height) * 0.045) + ":fontcolor=white:borderw=2:bordercolor=black@0.7:x=(w-text_w)/2:y=h-text_h-" + Math.round(height * 0.09));
  }
  if (caption) {
    const f = writeTmp('cap', caption);
    vf.push("drawtext=fontfile='" + FONT_R + "':textfile='" + f + "':fontsize=" + Math.round(Math.min(width, height) * 0.028) + ":fontcolor=white@0.75:borderw=1:bordercolor=black@0.5:x=" + Math.round(width * 0.05) + ":y=" + Math.round(height * 0.055));
  }
  if (watermark) {
    const f = writeTmp('wm', watermark);
    vf.push("drawtext=fontfile='" + FONT_R + "':textfile='" + f + "':fontsize=" + Math.round(Math.min(width, height) * 0.024) + ":fontcolor=white@0.45:x=w-text_w-" + Math.round(width * 0.03) + ":y=h-text_h-" + Math.round(height * 0.03));
  }

  const id = uid('shot_');
  const outPath = path.join(MEDIA, 'video', id + '.mp4');
  const args = [
    '-y', '-loop', '1', '-framerate', String(fps), '-i', imageFile,
    '-t', dur.toFixed(3),
    '-vf', vf.join(','),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-movflags', '+faststart', outPath
  ];
  const r = await runFF(args, { timeout: 180000 });
  if (!r.ok) return { ok: false, error: 'shot render failed', log: r.log.slice(-1600) };
  return { ok: true, id, file: outPath, rel: '/media/video/' + id + '.mp4', duration: dur, motion, look };
}

/** 多镜头拼接（xfade 转场） */
export async function concatShots(shotFiles, opts = {}) {
  const { transition = 'fade', transitionDur = 0.5, width = 1280, height = 720, fps = 24 } = opts;
  const tr = TRANSITIONS.find((t) => t.id === transition) || TRANSITIONS[0];
  const id = uid('vid_');
  const outPath = path.join(MEDIA, 'video', id + '.mp4');

  if (!shotFiles.length) return { ok: false, error: 'no shots' };
  if (shotFiles.length === 1) {
    fs.copyFileSync(shotFiles[0], outPath);
    return { ok: true, id, file: outPath, rel: '/media/video/' + id + '.mp4' };
  }

  // 先取每个片段时长
  const durs = [];
  for (const f of shotFiles) {
    const info = await probe(f);
    durs.push(info && info.format && info.format.duration ? parseFloat(info.format.duration) : 5);
  }

  const inputs = [];
  for (const f of shotFiles) inputs.push('-i', f);

  if (!tr.xfade) {
    const listFile = path.join(ROOT, '.tmp', 'concat_' + id + '.txt');
    fs.writeFileSync(listFile, shotFiles.map((f) => "file '" + f.replace(/\\/g, '/') + "'").join('\n'), 'utf8');
    const r = await runFF(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), outPath], { timeout: 240000 });
    try { fs.unlinkSync(listFile); } catch {}
    if (!r.ok) return { ok: false, error: 'concat failed', log: r.log.slice(-1500) };
    return { ok: true, id, file: outPath, rel: '/media/video/' + id + '.mp4' };
  }

  const td = Math.min(transitionDur, Math.min(...durs) * 0.4);
  const parts = [];
  let prevLabel = '[0:v]';
  let acc = durs[0];
  for (let i = 1; i < shotFiles.length; i++) {
    const outLabel = i === shotFiles.length - 1 ? '[outv]' : '[v' + i + ']';
    const offset = Math.max(0, acc - td);
    parts.push(prevLabel + '[' + i + ':v]xfade=transition=' + tr.xfade + ':duration=' + td.toFixed(3) + ':offset=' + offset.toFixed(3) + outLabel);
    acc = acc + durs[i] - td;
    prevLabel = outLabel;
  }
  const filter = parts.join(';');
  const r = await runFF(['-y', ...inputs, '-filter_complex', filter, '-map', '[outv]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), outPath], { timeout: 300000 });
  if (!r.ok) return { ok: false, error: 'xfade failed', log: r.log.slice(-1600) };
  return { ok: true, id, file: outPath, rel: '/media/video/' + id + '.mp4', transition: tr.id };
}

/** 视频 + 音轨 混合 */
export async function muxAudio(videoFile, audioFile, opts = {}) {
  const { audioVolume = 1, videoVolume = 0, fadeAudio = 1.0, loop = true } = opts;
  const id = uid('vid_');
  const outPath = path.join(MEDIA, 'video', id + '.mp4');
  const args = ['-y', '-i', videoFile];
  if (loop) args.push('-stream_loop', '-1');
  args.push('-i', audioFile);
  const af = ['volume=' + audioVolume];
  if (fadeAudio > 0) af.push('afade=t=in:st=0:d=' + fadeAudio.toFixed(2));
  args.push('-filter_complex',
    '[1:a]' + af.join(',') + '[a]' + (videoVolume > 0 ? ';[0:a]volume=' + videoVolume + '[v0];[v0][a]amix=inputs=2:duration=first[am]' : ''),
    '-map', '0:v', '-map', videoVolume > 0 ? '[am]' : '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outPath);
  const r = await runFF(args, { timeout: 240000 });
  if (!r.ok) return { ok: false, error: 'mux failed', log: r.log.slice(-1500) };
  return { ok: true, id, file: outPath, rel: '/media/video/' + id + '.mp4' };
}

/** 把 SRT 字幕烧进视频 */
export async function burnSubtitles(videoFile, srtText, opts = {}) {
  const { fontSize = 22, primary = '&H00FFFFFF', outline = '&H00000000' } = opts;
  const id = uid('vid_');
  const srtPath = path.join(ROOT, '.tmp', 'sub_' + id + '.srt');
  fs.writeFileSync(srtPath, srtText, 'utf8');
  const outPath = path.join(MEDIA, 'video', id + '.mp4');
  const style = 'FontName=Microsoft YaHei,FontSize=' + fontSize + ',PrimaryColour=' + primary + ',OutlineColour=' + outline + ',BorderStyle=1,Outline=2,Shadow=1,MarginV=28';
  const vf = "subtitles='" + srtPath.replace(/\\/g, '/').replace(':', '\\:') + "':force_style='" + style + "'";
  const r = await runFF(['-y', '-i', videoFile, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', outPath], { timeout: 240000 });
  try { fs.unlinkSync(srtPath); } catch {}
  if (!r.ok) return { ok: false, error: 'subtitle burn failed', log: r.log.slice(-1500) };
  return { ok: true, id, file: outPath, rel: '/media/video/' + id + '.mp4' };
}

export function toSRT(segments) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = (sec) => {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return pad(h) + ':' + pad(m) + ':' + pad(ss) + ',' + pad(ms, 3);
  };
  return segments.map((sg, i) => (i + 1) + '\n' + ts(sg.start) + ' --> ' + ts(sg.end) + '\n' + sg.text + '\n').join('\n');
}

export { pickMood, PALETTES, pickPalette };
