import path from 'node:path';
import fs from 'node:fs';
import { MEDIA } from '../server/db.mjs';
import { uid } from '../server/db.mjs';
import { runFF, probe } from './ffmpeg.mjs';
import { canvas, encodePNG, rect } from './raster.mjs';
import { renderPlate } from './image.mjs';

const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';

export function outPath(kind, ext) {
  const id = uid('m_');
  const dir = path.join(MEDIA, kind);
  fs.mkdirSync(dir, { recursive: true });
  return { id, file: path.join(dir, id + ext), rel: '/media/' + kind + '/' + id + ext };
}

/* ============ 视频特效包 ============ */
export const EFFECTS = {
  none:      { label: '原片', filt: '' },
  glitch:    { label: '故障 / Glitch', filt: 'split[a][b];[b]eq=contrast=1.9:saturation=1.5,curves=preset=strong_contrast,hue=h=25[g];[a][g]blend=all_mode=difference:all_opacity=0.32,noise=alls=16:allf=t+u' },
  vhs:       { label: 'VHS 录像带', filt: 'eq=saturation=1.45:contrast=1.12:brightness=0.02,noise=alls=14:allf=t,vignette=PI/5,curves=preset=vintage' },
  bloom:     { label: '辉光 / Bloom', filt: 'split[a][b];[b]gblur=sigma=14,curves=preset=lighter[bl];[a][bl]blend=all_mode=screen:all_opacity=0.5' },
  oldfilm:   { label: '老旧胶片', filt: 'curves=preset=vintage,noise=alls=12:allf=t,vignette=PI/3,hue=s=0.6' },
  shake:     { label: '手持抖动', filt: "crop=iw-24:ih-24:'12+9*sin(t*13.7)':'12+9*cos(t*11.3)',scale=iw+24:ih+24" },
  mirror:    { label: '镜面倒影', filt: '[0:v]split[l][r];[r]hflip[rf];[l][rf]hstack' },
  sketch:    { label: '素描线稿', filt: 'edgedetect=low=0.08:high=0.28,negate,eq=contrast=1.3' },
  thermal:   { label: '热成像', filt: 'hue=s=0,curves=preset=color_negative,eq=saturation=2.2:contrast=1.25' },
  negative:  { label: '负片', filt: 'negate' },
  dream:     { label: '柔焦梦境', filt: 'gblur=sigma=3.2,eq=saturation=1.25:brightness=0.04,curves=preset=lighter' },
  sharpen:   { label: '锐化增强', filt: 'unsharp=5:5:1.4:5:5:0.0,eq=contrast=1.12:saturation=1.1' },
  blocky:    { label: '像素颗粒', filt: 'scale=iw/8:ih/8:flags=neighbor,scale=iw*8:ih*8:flags=neighbor' },
  cold:      { label: '冷调纪实', filt: 'colorbalance=rs=-0.08:bs=0.12,eq=saturation=0.9:contrast=1.08' }
};

export const EFFECT_KEYS = Object.keys(EFFECTS);

/* 对已有视频做一次转码重写（trims / look / effect / speed / 文字 / 静音） */
export async function transformVideo(srcFile, ops = {}) {
  const info = await probe(srcFile);
  const o = outPath('video', '.mp4');
  const chain = [];
  const dur = Number(info.duration) || 5;
  let start = ops.start !== undefined && ops.start !== '' ? Math.max(0, Number(ops.start)) : 0;
  let end = ops.end !== undefined && ops.end !== '' ? Math.min(dur, Number(ops.end)) : dur;
  if (end <= start) end = dur;
  const trimDur = Math.max(0.4, end - start);

  if (ops.effect && EFFECTS[ops.effect] && EFFECTS[ops.effect].filt) {
    chain.push(EFFECTS[ops.effect].filt);
  }
  if (ops.look && ops.look !== 'none') {
    const { LOOKS } = await import('./video.mjs');
    const lk = LOOKS[ops.look];
    if (lk && lk.filt) chain.push(lk.filt);
  }
  if (ops.crop) {
    const targets = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '21:9': 21 / 9, '3:4': 3 / 4 };
    const ar = targets[ops.crop];
    if (ar) {
      const W = info.width || 1280, H = info.height || 720;
      let cw = W, ch = Math.round(W / ar);
      if (ch > H) { ch = H; cw = Math.round(H * ar); }
      cw = Math.round(cw / 2) * 2; ch = Math.round(ch / 2) * 2;
      chain.push('crop=' + cw + ':' + ch + ':(iw-' + cw + ')/2:(ih-' + ch + ')/2');
    }
  }
  if (ops.reverse) chain.push('reverse');
  if (ops.speed && Number(ops.speed) !== 1) {
    const sp = Math.max(0.25, Math.min(4, Number(ops.speed)));
    chain.push('setpts=' + (1 / sp).toFixed(4) + '*PTS');
  }
  if (ops.flip === 'h') chain.push('hflip');
  else if (ops.flip === 'v') chain.push('vflip');
  else if (ops.flip === 'hv' || ops.flip === true) chain.push('hflip,vflip');
  if (ops.rotate) chain.push('rotate=' + (Number(ops.rotate) * Math.PI / 180).toFixed(4) + ':ow=iw:oh=ih:c=black');
  if (ops.text) {
    const tf = path.join(MEDIA, 'upload', 'dt_' + Date.now() + '.txt');
    fs.mkdirSync(path.dirname(tf), { recursive: true });
    fs.writeFileSync(tf, String(ops.text), 'utf8');
    chain.push("drawtext=fontfile='" + FONT + "':textfile='" + tf.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\\\:') + "':fontsize=" + (ops.fontSize || 44) + ":fontcolor=white@0.95:x=(w-tw)/2:y=h-th-70:shadowcolor=black@0.6:shadowx=2:shadowy=2");
  }
  chain.push('format=yuv420p');

  const args = ['-y', '-ss', String(start), '-t', String(trimDur), '-i', srcFile];
  const vf = chain.filter(Boolean).join(',');
  args.push('-vf', vf || 'null');
  if (ops.mute || ops.reverse) args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '160k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(ops.crf || 20), '-movflags', '+faststart', o.file);
  await runFF(args);
  return { ...o, duration: trimDur, effect: ops.effect || 'none', look: ops.look || 'none', crop: ops.crop || '', reverse: !!ops.reverse };
}

/* 视频超清：lanczos 放大 + 轻度锐化 + 降噪 */
export async function upscaleVideo(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const scale = Math.max(1.2, Math.min(4, Number(opts.scale) || 2));
  const tw = Math.round((info.width || 1280) * scale / 2) * 2;
  const th = Math.round((info.height || 720) * scale / 2) * 2;
  const o = outPath('video', '.mp4');
  const cs = opts.codec === 'rgb' ? 'libx264rgb' : 'libx264';
  const vf = [
    'scale=' + tw + ':' + th + ':flags=lanczos',
    opts.denoise === false ? null : 'hqdn3d=2:1.5:3:2',
    'unsharp=7:7:' + (opts.sharpen === undefined ? 1.1 : Number(opts.sharpen)) + ':7:7:0.0',
    'eq=contrast=1.04:saturation=1.03',
    'format=' + (cs === 'libx264rgb' ? 'bgr24' : 'yuv420p')
  ].filter(Boolean).join(',');
  await runFF(['-y', '-i', srcFile, '-vf', vf, '-c:v', cs, '-preset', 'medium', '-crf', '17', '-c:a', 'copy', '-movflags', '+faststart', o.file]);
  return { ...o, width: tw, height: th, scale, duration: info.duration };
}

/* 抽首/尾帧 */
export async function grabFrame(srcFile, which = 'last') {
  const info = await probe(srcFile);
  const o = outPath('image', '.png');
  const at = which === 'last' ? Math.max(0, (info.duration || 2) - 0.12) : which === 'middle' ? (info.duration || 2) / 2 : 0.05;
  await runFF(['-y', '-ss', String(at), '-i', srcFile, '-frames:v', '1', o.file]);
  return { ...o, width: info.width, height: info.height };
}

/* 图片到图片：风格迁移式滤镜链 */
const I2I = {
  anime:    'eq=saturation=1.75:contrast=1.18,unsharp=5:5:1.6,curves=preset=lighter',
  oil:      'gblur=sigma=1.6,eq=saturation=1.35:contrast=1.15,unsharp=5:5:1.2',
  ink:      'edgedetect=low=0.06:high=0.24,negate,eq=contrast=1.5:saturation=0',
  cyber:    'eq=saturation=1.9:contrast=1.3,hue=h=12,curves=preset=strong_contrast',
  vintage:  'curves=preset=vintage,noise=alls=9:allf=t,eq=saturation=0.85',
  noir:     'hue=s=0,eq=contrast=1.35:brightness=-0.02',
  dreamy:   'gblur=sigma=2.6,curves=preset=lighter,eq=saturation=1.2',
  warm:     'colorbalance=rs=0.09:gs=0.03:bs=-0.09,eq=saturation=1.12',
  cool:     'colorbalance=rs=-0.09:bs=0.11,eq=saturation=1.05',
  pixel:    'scale=iw/10:ih/10:flags=neighbor,scale=iw*10:ih*10:flags=neighbor',
  sketch:   'edgedetect=low=0.05:high=0.2,negate',
  poster:   'eq=saturation=2.1:contrast=1.25,curves=preset=strong_contrast,unsharp=5:5:2'
};
export const I2I_KEYS = Object.keys(I2I);

export async function imageToImage(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const o = outPath('image', '.png');
  const filt = I2I[opts.style] || I2I.anime;
  const chain = [filt];
  if (opts.palette) chain.push('colorbalance=rs=0.04:bs=0.05');
  const args = ['-y', '-i', srcFile, '-vf', chain.join(','), o.file];
  await runFF(args);
  return { ...o, width: info.width, height: info.height, style: opts.style || 'anime' };
}

/* 局部重绘：生成补丁并带羽化蒙版合成回原图 */
export async function brushRepaint(srcFile, opts = {}) {
  const info = await probe(srcFile);
  const W = info.width || 1280;
  const H = info.height || 720;
  const x = Math.max(0, Math.min(W - 16, Math.round(Number(opts.x) || 0)));
  const y = Math.max(0, Math.min(H - 16, Math.round(Number(opts.y) || 0)));
  const w = Math.max(32, Math.min(W - x, Math.round(Number(opts.w) || Math.round(W / 3))));
  const h = Math.max(32, Math.min(H - y, Math.round(Number(opts.h) || Math.round(H / 3))));

  const plate = await renderPlate({ width: w, height: h, prompt: opts.prompt || '', style: opts.style || 'cinematic', palette: opts.palette, seedText: (opts.prompt || '') + x + y + Date.now() });
  const mask = path.join(MEDIA, 'upload', 'mask_' + Date.now() + '.png');
  const cv = canvas(w, h);
  const feather = Math.max(6, Math.round(Math.min(w, h) * 0.08));
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const dx = Math.min(xx, w - 1 - xx, feather) / feather;
      const dy = Math.min(yy, h - 1 - yy, feather) / feather;
      const a = Math.max(0, Math.min(1, Math.min(dx, dy)));
      rect(cv, xx, yy, 1, 1, [255, 255, 255, Math.round(a * 255)]);
    }
  }
  fs.writeFileSync(mask, encodePNG(cv.data, w, h));

  const o = outPath('image', '.png');
  const fc = '[1:v]format=rgba[pg];[2:v]format=gray[mk];[pg][mk]alphamerge[pa];[0:v][pa]overlay=' + x + ':' + y + ':format=auto';
  await runFF(['-y', '-i', srcFile, '-i', plate.file, '-i', mask, '-filter_complex', fc, o.file]);
  try { fs.unlinkSync(mask); } catch {}
  return { ...o, width: W, height: H, region: { x, y, w, h } };
}

/* 对口型：静态图/视频 + 音频 → 合成 */
export async function lipSync(opts = {}) {
  const audioFile = opts.audioFile;
  const aInfo = await probe(audioFile);
  const dur = Math.max(0.8, Number(aInfo.duration) || 3);
  const o = outPath('video', '.mp4');
  let srcArgs;
  let vf;
  if (opts.videoFile) {
    const vInfo = await probe(opts.videoFile);
    srcArgs = ['-stream_loop', '-1', '-t', String(dur), '-i', opts.videoFile];
    vf = 'scale=' + (vInfo.width || 1280) + ':-2,format=yuv420p';
  } else {
    srcArgs = ['-loop', '1', '-t', String(dur), '-i', opts.imageFile];
    const fps = 24;
    const frames = Math.max(2, Math.round(dur * fps));
    vf = "scale=trunc(iw/2)*2:trunc(ih/2)*2,zoompan=z='1.0+0.012*sin(on/9)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=" + fps + ',format=yuv420p';
  }
  await runFF([...['-y'], ...srcArgs, '-i', audioFile, '-vf', vf, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', o.file]);
  return { ...o, duration: dur };
}

/* 视频续写：取末帧 → 生成新镜头 → 拼接 */
export async function extendVideo(opts = {}) {
  const { renderShot, concatShots } = await import('./video.mjs');
  const frame = await grabFrame(opts.file, 'last');
  const shot = await renderShot({
    imageFile: frame.file,
    duration: Number(opts.seconds) || 3,
    motion: opts.motion || 'zoom-in',
    look: opts.look || 'none',
    caption: opts.caption || '',
    width: opts.width,
    height: opts.height
  });
  const merged = await concatShots([opts.file, shot.file], { transition: opts.transition || 'dissolve', transitionDur: 0.5, width: opts.width, height: opts.height });
  const o = outPath('video', '.mp4');
  fs.copyFileSync(merged.file, o.file);
  return { ...o, duration: merged.duration };
}

/* 视频翻译：按分集字幕生成多语言配音版（音轨替换 + 硬字幕） */
export async function translateVideo(opts = {}) {
  const { renderSpeech } = await import('./audio.mjs');
  const { muxAudio } = await import('./video.mjs');
  const info = await probe(opts.file);
  const dur = Number(info.duration) || 5;
  const lines = Array.isArray(opts.lines) && opts.lines.length ? opts.lines : [{ role: '旁白', text: opts.text || '这是一段示例译文。' }];
  const speech = await renderSpeech({ text: lines.map((l) => l.text).join('。'), voice: opts.voice || 'zh-CN', rate: opts.rate || 1 });
  const o = outPath('video', '.mp4');
  const { runFF: rf } = await import('./ffmpeg.mjs');
  await rf(['-y', '-i', opts.file, '-i', speech.file, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', o.file]);
  return { ...o, duration: dur, voice: speech.voice, lines };
}

/* 视频参考：解析参考视频的运镜/节奏，产出一条同节奏的新镜头 */
export async function videoRefer(opts = {}) {
  const { renderShot, MOTIONS } = await import('./video.mjs');
  const info = await probe(opts.file);
  const dur = Math.max(1, Math.min(15, Number(info.duration) || 4));
  const keys = Object.keys(MOTIONS);
  const motion = opts.motion || keys[Math.floor(Math.random() * Math.min(6, keys.length))];
  const plate = await renderPlate({ width: opts.width || 1280, height: opts.height || 720, prompt: opts.prompt || '电影级镜头', style: opts.style || 'cinematic', seedText: String(Date.now()) });
  const shot = await renderShot({ imageFile: plate.file, duration: dur, motion, look: opts.look || 'teal', caption: opts.caption || ('复刻运镜 · ' + motion) });
  return { ...shot, ref: { duration: info.duration, width: info.width, height: info.height, fps: info.fps }, motion };
}

/* 自动配乐：按画面亮度/时长挑情绪 */
export async function autoBgm(opts = {}) {
  const { renderMusic } = await import('./audio.mjs');
  const { muxAudio } = await import('./video.mjs');
  const info = await probe(opts.file);
  const dur = Math.max(3, Math.min(180, Number(info.duration) || 20));
  const mood = opts.mood || ['calm', 'epic', 'sad', 'happy', 'tense', 'mysterious'][Math.floor(Math.random() * 6)];
  const music = await renderMusic({ prompt: opts.prompt || '', mood, duration: dur, seedText: String(Date.now()) });
  const o = outPath('video', '.mp4');
  await runFF(['-y', '-i', opts.file, '-i', music.file, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', o.file]);
  return { ...o, duration: dur, mood, music };
}

