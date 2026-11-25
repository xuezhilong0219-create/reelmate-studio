import path from 'node:path';
import fs from 'node:fs';
import { db, addLedger, MEDIA } from '../db.mjs';
import { thumbnail } from '../../engine/ffmpeg.mjs';
import { ok, fail, reply } from '../route.mjs';
import { uid, now, save } from '../db.mjs';
import { enqueue, getTask, listTasks, queueStats } from '../queue.mjs';
import { renderImage } from '../../engine/image.mjs';

const img = (r) => (r && r.ok === false ? fail(r.error) : ok(r));

/** 视频资产异步补一张缩略图，失败不影响主流程 */
function detachThumb(row) {
  const dest = path.join(MEDIA, 'image', row.id + '_thumb.png');
  setTimeout(() => {
    thumbnail(row.file, dest, 0.4).then((ok) => {
      if (!ok) return;
      row.thumbRel = '/media/image/' + row.id + '_thumb.png';
      try { save(); } catch {}
    }).catch(() => {});
  }, 50);
}

/* 通用：把生成结果登记成资产 */
export function addAsset(asset) {
  const d = db();
  const row = {
    id: uid('as_'),
    name: asset.name || '未命名',
    kind: asset.kind || 'image',
    rel: asset.rel,
    file: asset.file || null,
    thumb: asset.thumb || asset.rel,
    width: asset.width || null,
    height: asset.height || null,
    duration: asset.duration || null,
    folderId: asset.folderId || null,
    tags: asset.tags || [],
    meta: asset.meta || {},
    favorite: false,
    createdAt: now()
  };
  d.assets.unshift(row);
  save();
  if (row.kind === 'video' && row.file) detachThumb(row);
  return row;
}

/* ---------- 设置 ---------- */
export function registerToolbox(r) {

  r.get('/api/settings', (req, res) => {
    const d = db();
    reply(res, ok({ settings: d.settings, models: d.models, team: d.team, user: d.users[0] }));
  });

  r.post('/api/settings', async (req, res, ctx) => {
    const d = db();
    const body = ctx.body || {};
    if (body.settings) d.settings = { ...d.settings, ...body.settings };
    if (body.settings && body.settings.llm) d.settings.llm = { ...d.settings.llm, ...body.settings.llm };
    if (body.settings && body.settings.engine) d.settings.engine = { ...d.settings.engine, ...body.settings.engine };
    save();
    reply(res, ok(d.settings));
  });

  r.get('/api/models', (req, res) => {
    reply(res, ok(db().models));
  });

  r.get('/api/credits', (req, res) => {
    const d = db();
    const used = d.ledger.filter((l) => l.delta < 0).reduce((s, l) => s + Math.abs(l.delta), 0);
    reply(res, ok({ unlimited: true, balance: 999999999, total: d.team.credits, used, ledger: d.ledger.slice(0, 60), note: '本地版不设额度与付费' }));
  });

/* ---------- 任务 ---------- */
  r.get('/api/tasks', (req, res, ctx) => {
    const q = ctx.query || {};
    reply(res, ok({ list: listTasks({ status: q.status, kind: q.kind, tool: q.tool, limit: Number(q.limit) || 120 }), stats: queueStats() }));
  });

  r.get('/api/tasks/:id', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    reply(res, ok(t));
  });

  r.post('/api/tasks/:id/cancel', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    if (t.status === 'queued' || t.status === 'running') {
      t.status = 'cancelled';
      t.finishedAt = now();
      save();
    }
    reply(res, ok(t));
  });

/* ================= 文生视频 ================= */
  r.post('/api/tools/text-to-video', async (req, res, ctx) => {
    const b = ctx.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return reply(res, fail('请填写画面描述'));
    const count = Math.max(1, Math.min(4, Number(b.count) || 1));
    const duration = Math.max(1, Math.min(15, Number(b.duration) || 5));
    const task = enqueue('text-to-video', { prompt, duration, count }, async ({ progress }) => {
      const { renderShot, concatShots } = await import('../../engine/video.mjs');
      const shots = [];
      for (let i = 0; i < count; i++) {
        progress(10 + Math.round((i / count) * 70), '渲染镜头 ' + (i + 1) + '/' + count);
        const plate = await renderImage({ prompt, title: b.title || '', subtitle: '', width: Number(b.width) || 1280, height: Number(b.height) || 720, style: b.style || 'cinematic', seedText: prompt + i, index: i, palette: b.palette, safeFrame: false });
        const shot = await renderShot({
          imageFile: plate.file,
          duration,
          motion: b.motion || ['zoom-in', 'pan-right', 'tilt-up'][i % 3],
          look: b.look || 'cinematic',
          caption: i === 0 && b.caption ? b.caption : '',
          fps: Number(b.fps) || 24
        });
        shots.push(shot);
      }
      progress(85, '拼接中');
      const merged = await concatShots(shots.map((s) => s.file), { transition: b.transition || 'dissolve', transitionDur: 0.5 });
      if (!merged || merged.ok === false || !merged.rel) return { ok: false, error: '视频拼接失败：' + ((merged && merged.error) || '未知原因') };
      let finalRel = merged.rel, finalFile = merged.file, musicOn = false;
      if (b.music !== false) {
        progress(92, '配乐');
        const { renderMusic } = await import('../../engine/audio.mjs');
        const { muxAudio } = await import('../../engine/video.mjs');
        try {
          const music = await renderMusic({ prompt, duration: Math.ceil(merged.duration || duration * count), mood: b.mood });
          if (music && music.ok && music.file) {
            const muxed = await muxAudio(merged.file, music.file, { audioVolume: 0.7 });
            if (muxed && muxed.ok && muxed.rel) { finalRel = muxed.rel; finalFile = muxed.file; musicOn = true; }
          }
        } catch (e) { /* 配乐失败不影响成片 */ }
      }
      const asset = addAsset({ name: prompt.slice(0, 40), kind: 'video', rel: finalRel, file: finalFile, duration: merged.duration, thumb: shots[0] ? shots[0].thumb : null, meta: { prompt, tool: 'text-to-video', music: musicOn } });
      return { ok: true, rel: finalRel, file: finalFile, assetId: asset.id, duration: merged.duration, shots: shots.length, music: musicOn };
    }, { tool: 'text-to-video', title: prompt.slice(0, 30), credits: 10 });
    reply(res, ok(task));
  });

/* ================= 图生视频 ================= */
  r.post('/api/tools/image-to-video', async (req, res, ctx) => {
    const b = ctx.body || {};
    if (!b.assetId && !b.src) return reply(res, fail('请选择一张图片'));
    const task = enqueue('image-to-video', b, async ({ progress }) => {
      const { renderShot } = await import('../../engine/video.mjs');
      const d = db();
      const a = d.assets.find((x) => x.id === b.assetId);
      const src = a ? a.file : b.src;
      progress(30, '生成运镜');
      const shot = await renderShot({ imageFile: src, duration: Number(b.duration) || 5, motion: b.motion || 'zoom-in', look: b.look || 'none', caption: b.caption || '', fps: Number(b.fps) || 24 });
      progress(80, '写入资产');
      const asset = addAsset({ name: (a ? a.name : '图生视频'), kind: 'video', rel: shot.rel, file: shot.file, duration: shot.duration, meta: { tool: 'image-to-video', srcAsset: b.assetId } });
      return { ok: true, rel: shot.rel, file: shot.file, assetId: asset.id, duration: shot.duration };
    }, { tool: 'image-to-video', title: '图生视频', credits: 8 });
    reply(res, ok(task));
  });

/* ================= 参考生视频（多图参考）================= */
  r.post('/api/tools/reference-to-video', async (req, res, ctx) => {
    const b = ctx.body || {};
    const ids = Array.isArray(b.assetIds) ? b.assetIds.slice(0, 4) : [];
    if (!ids.length) return reply(res, fail('请选择 1-4 张参考图'));
    const task = enqueue('reference-to-video', { assetIds: ids, prompt: b.prompt }, async ({ progress }) => {
      const { renderShot, concatShots } = await import('../../engine/video.mjs');
      const d = db();
      const shots = [];
      for (let i = 0; i < ids.length; i++) {
        progress(10 + Math.round((i / ids.length) * 65), '参考镜头 ' + (i + 1));
        const a = d.assets.find((x) => x.id === ids[i]);
        if (!a || !a.file) continue;
        const shot = await renderShot({ imageFile: a.file, duration: Number(b.duration) || 4, motion: b.motion || ['zoom-in', 'dolly', 'pan-left'][i % 3], look: b.look || 'none' });
        shots.push(shot);
      }
      progress(85, '拼接');
      if (!shots.length) return { ok: false, error: '没有可用的参考图' };
      const merged = await concatShots(shots.map((s) => s.file), { transition: b.transition || 'fade' });
      if (!merged || merged.ok === false || !merged.rel) return { ok: false, error: '视频拼接失败：' + ((merged && merged.error) || '未知原因') };
      const asset = addAsset({ name: b.prompt ? b.prompt.slice(0, 30) : '参考生视频', kind: 'video', rel: merged.rel, file: merged.file, duration: merged.duration, meta: { tool: 'reference-to-video' } });
      return { ok: true, rel: merged.rel, file: merged.file, assetId: asset.id, duration: merged.duration };
    }, { tool: 'reference-to-video', title: '多图参考生视频', credits: 12 });
    reply(res, ok(task));
  });

/* ================= 视频参考（复刻运镜）================= */
  r.post('/api/tools/video-refer', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择参考视频'));
    const task = enqueue('video-refer', b, async ({ progress }) => {
      const { videoRefer } = await import('../../engine/effects.mjs');
      progress(40, '解析运镜');
      const out = await videoRefer({ file: a.file, prompt: b.prompt, motion: b.motion });
      const asset = addAsset({ name: '运镜复刻 · ' + (b.prompt || '').slice(0, 20), kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'video-refer', ref: out.ref } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration, motion: out.motion, ref: out.ref };
    }, { tool: 'video-refer', title: '视频参考', credits: 10 });
    reply(res, ok(task));
  });

/* ================= 视频超清 ================= */
  r.post('/api/tools/video-upscale', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要超清的视频'));
    const task = enqueue('video-upscale', b, async ({ progress }) => {
      const { upscaleVideo } = await import('../../engine/effects.mjs');
      progress(35, 'AI 重建细节');
      const out = await upscaleVideo(a.file, { scale: Number(b.scale) || 2, codec: b.codec, sharpen: b.sharpen });
      progress(85, '写出');
      const asset = addAsset({ name: a.name + ' · 超清' + out.scale + 'x', kind: 'video', rel: out.rel, file: out.file, width: out.width, height: out.height, duration: out.duration, meta: { tool: 'video-upscale', scale: out.scale } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, width: out.width, height: out.height, scale: out.scale };
    }, { tool: 'video-upscale', title: '视频超清', credits: 6 });
    reply(res, ok(task));
  });

/* ================= 视频续写 ================= */
  r.post('/api/tools/video-extend', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要续写的视频'));
    const task = enqueue('video-extend', b, async ({ progress }) => {
      const { extendVideo } = await import('../../engine/effects.mjs');
      progress(40, '生成续写镜头');
      const out = await extendVideo({ file: a.file, seconds: Number(b.seconds) || 3, motion: b.motion, transition: b.transition });
      const asset = addAsset({ name: a.name + ' · 续写', kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'video-extend' } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration };
    }, { tool: 'video-extend', title: '视频续写', credits: 8 });
    reply(res, ok(task));
  });

/* ================= 视频编辑（多模态智能编辑）================= */
  r.post('/api/tools/video-edit', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要编辑的视频'));
    const task = enqueue('video-edit', b, async ({ progress }) => {
      const { transformVideo } = await import('../../engine/effects.mjs');
      progress(45, '应用编辑');
      const out = await transformVideo(a.file, b);
      const asset = addAsset({ name: a.name + ' · 编辑', kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'video-edit', effect: out.effect } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration, effect: out.effect };
    }, { tool: 'video-edit', title: '视频编辑', credits: 6 });
    reply(res, ok(task));
  });

/* ================= AI 视频特效（预设包）================= */
  r.post('/api/tools/video-effects', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要处理的视频'));
    const task = enqueue('video-effects', b, async ({ progress }) => {
      const { transformVideo, EFFECTS } = await import('../../engine/effects.mjs');
      const eff = b.effect || 'glitch';
      if (!EFFECTS[eff]) return { ok: false, error: '未知特效：' + eff };
      progress(40, '套用 ' + EFFECTS[eff].label);
      const out = await transformVideo(a.file, {
        effect: eff,
        speed: Number(b.speed) || 1,
        text: b.text || '',
        crf: b.strength === 'strong' ? 18 : b.strength === 'light' ? 24 : 21
      });
      const asset = addAsset({ name: a.name + ' · ' + EFFECTS[eff].label, kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'video-effects', effect: eff } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration, effect: eff, effectName: EFFECTS[eff].label };
    }, { tool: 'video-effects', title: 'AI 视频特效', credits: 4 });
    reply(res, ok(task));
  });

/* ================= 字幕擦除 ================= */
  r.post('/api/tools/subtitle-erase', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要处理的视频'));
    const task = enqueue('subtitle-erase', b, async ({ progress }) => {
      const { eraseSubtitles } = await import('../../engine/erase.mjs');
      const mode = b.mode || 'basic';
      progress(30, mode === 'ocr' ? '检测字幕区域' : '准备擦除区域');
      const out = await eraseSubtitles(a.file, {
        mode,
        eraseMode: b.eraseMode || (b.strong === true || b.strong === 'true' || b.strong === 'on' ? 'blur' : undefined),
        strength: Number(b.strength) || 3,
        x: Number(b.x == null ? 4 : b.x), y: Number(b.y == null ? 74 : b.y),
        w: Number(b.w == null ? 92 : b.w), h: Number(b.h == null ? 20 : b.h),
        crf: b.crf
      });
      if (!out || out.ok === false) return { ok: false, error: (out && out.error) || '擦除失败' };
      progress(88, '登记资产');
      const asset = addAsset({ name: a.name + ' · 去字幕', kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'subtitle-erase', mode, regions: out.regions } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration, mode, regions: out.regions, detected: out.detected || null };
    }, { tool: 'subtitle-erase', title: '字幕擦除', credits: 5 });
    reply(res, ok(task));
  });

/* 字幕区域预检测（同步、不建任务，供前端预览） */
  r.post('/api/erase/detect', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择视频'));
    const { detectTextBand } = await import('../../engine/erase.mjs');
    const band = await detectTextBand(a.file, { fps: Number(b.fps) || 1, frames: Number(b.frames) || 8 });
    if (!band) return reply(res, fail('没有检测到字幕区域，请改用固定区域模式'));
    reply(res, ok({ band, assetId: a.id }));
  });

/* ================= 水印去除 ================= */
  r.post('/api/tools/watermark-remove', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要处理的视频'));
    const task = enqueue('watermark-remove', b, async ({ progress }) => {
      const { removeWatermark } = await import('../../engine/erase.mjs');
      progress(35, '定位水印区域');
      const out = await removeWatermark(a.file, {
        corner: b.corner || 'br',
        size: Number(b.size) || 18,
        pad: Number(b.pad) || 2,
        mode: b.fill === 'blur' ? 'blur' : b.fill === 'fill' ? 'fill' : 'delogo',
        strength: Number(b.strength) || 2
      });
      if (!out || out.ok === false) return { ok: false, error: (out && out.error) || '去除失败' };
      progress(88, '登记资产');
      const asset = addAsset({ name: a.name + ' · 无水印', kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'watermark-remove', corner: b.corner || 'br', regions: out.regions } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration, regions: out.regions };
    }, { tool: 'watermark-remove', title: '水印去除', credits: 4 });
    reply(res, ok(task));
  });
/* ================= 对口型 ================= */
  r.post('/api/tools/lip-sync', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const media = d.assets.find((x) => x.id === b.assetId);
    const audio = d.assets.find((x) => x.id === b.audioId);
    if (!media && !b.text) return reply(res, fail('请选择画面或填写台词'));
    const task = enqueue('lip-sync', b, async ({ progress }) => {
      const { lipSync } = await import('../../engine/effects.mjs');
      const { renderSpeech } = await import('../../engine/audio.mjs');
      let audioFile = audio && audio.file;
      if (!audioFile && b.text) {
        progress(25, '合成语音');
        const sp = await renderSpeech({ text: b.text, voice: b.voice || 'zh-CN', rate: b.rate });
        audioFile = sp.file;
      }
      progress(55, '对齐唇形');
      const out = await lipSync({ imageFile: media && media.kind === 'image' ? media.file : null, videoFile: media && media.kind === 'video' ? media.file : null, audioFile });
      const asset = addAsset({ name: '对口型 · ' + (b.text || '配音').slice(0, 18), kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'lip-sync' } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration };
    }, { tool: 'lip-sync', title: '视频对口型', credits: 8 });
    reply(res, ok(task));
  });

/* ================= 文生图 ================= */
  r.post('/api/tools/text-to-image', async (req, res, ctx) => {
    const b = ctx.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return reply(res, fail('请填写画面描述'));
    const task = enqueue('text-to-image', { prompt }, async ({ progress }) => {
      const n = Math.max(1, Math.min(8, Number(b.count) || 1));
      const out = [];
      for (let i = 0; i < n; i++) {
        progress(10 + Math.round((i / n) * 80), '出图 ' + (i + 1) + '/' + n);
        const r2 = await renderImage({ prompt, title: b.title || '', subtitle: b.subtitle || '', tag: b.tag || '', width: Number(b.width) || 1280, height: Number(b.height) || 720, style: b.style, seedText: prompt, index: i, palette: b.palette, scene: b.scene });
        const asset = addAsset({ name: prompt.slice(0, 40) + (n > 1 ? ' #' + (i + 1) : ''), kind: 'image', rel: r2.rel, file: r2.file, width: r2.width, height: r2.height, meta: { prompt, tool: 'text-to-image', palette: r2.palette } });
        out.push({ rel: r2.rel, file: r2.file, assetId: asset.id, width: r2.width, height: r2.height });
      }
      return { ok: true, images: out, rel: out[0].rel, assetId: out[0].assetId };
    }, { tool: 'text-to-image', title: prompt.slice(0, 30), credits: 4 });
    reply(res, ok(task));
  });

/* ================= 参考生图 ================= */
  r.post('/api/tools/image-to-image', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择参考图'));
    const task = enqueue('image-to-image', b, async ({ progress }) => {
      const { imageToImage } = await import('../../engine/effects.mjs');
      const st = b.style || b.preset || 'anime';
      const n = Math.max(1, Math.min(4, Number(b.count) || 1));
      const imgs = [];
      for (let i = 0; i < n; i++) {
        progress(20 + Math.round((i / n) * 70), '风格化 ' + (i + 1) + '/' + n);
        const out = await imageToImage(a.file, { style: st, palette: b.palette, strength: Number(b.strength) || 0.6 });
        const nm = (b.prompt ? String(b.prompt).slice(0, 24) + ' · ' : a.name + ' · ') + st + (n > 1 ? ' #' + (i + 1) : '');
        const asset = addAsset({ name: nm, kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'image-to-image', style: out.style, prompt: b.prompt || '' } });
        imgs.push({ rel: out.rel, file: out.file, assetId: asset.id, width: out.width, height: out.height });
      }
      return { ok: true, images: imgs, rel: imgs[0].rel, file: imgs[0].file, assetId: imgs[0].assetId, width: imgs[0].width, height: imgs[0].height };
    }, { tool: 'image-to-image', title: '参考生图', credits: 4 });
    reply(res, ok(task));
  });

/* ================= 局部重绘 ================= */
  r.post('/api/tools/brush-repaint', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择要重绘的图片'));
    const task = enqueue('brush-repaint', b, async ({ progress }) => {
      const { brushRepaint } = await import('../../engine/effects.mjs');
      progress(45, '重绘选区');
      const W = a.width || 1280, H = a.height || 720;
      const pct = (v, base, def) => Math.round((v == null || v === '' ? def : Number(v)) / 100 * base);
      const out = await brushRepaint(a.file, {
        ...b,
        x: pct(b.x, W, 20), y: pct(b.y, H, 20),
        w: pct(b.w, W, 50), h: pct(b.h, H, 50),
      });
      const asset = addAsset({ name: a.name + ' · 局部重绘', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'brush-repaint', region: out.region } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, region: out.region };
    }, { tool: 'brush-repaint', title: '局部重绘', credits: 5 });
    reply(res, ok(task));
  });

/* ================= 文生音乐 ================= */
  r.post('/api/tools/text-to-music', async (req, res, ctx) => {
    const b = ctx.body || {};
    const task = enqueue('text-to-music', b, async ({ progress }) => {
      const { renderMusic } = await import('../../engine/audio.mjs');
      progress(50, '编曲');
      const out = await renderMusic({ prompt: b.prompt || '', duration: Number(b.duration) || 30, mood: b.mood, tempo: b.tempo });
      const asset = addAsset({ name: (b.prompt || '背景音乐').slice(0, 30), kind: 'audio', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'text-to-music', mood: out.mood } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration, mood: out.mood };
    }, { tool: 'text-to-music', title: '文生音乐', credits: 3 });
    reply(res, ok(task));
  });

/* ================= 文生音效 ================= */
  r.post('/api/tools/text-to-sound', async (req, res, ctx) => {
    const b = ctx.body || {};
    const task = enqueue('text-to-sound', b, async ({ progress }) => {
      const { renderSfx } = await import('../../engine/audio.mjs');
      progress(50, '合成音效');
      const out = await renderSfx({ prompt: b.prompt || '', duration: Number(b.duration) || 4, category: b.category });
      const asset = addAsset({ name: (b.prompt || '音效').slice(0, 30), kind: 'audio', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'text-to-sound', category: out.category } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, duration: out.duration };
    }, { tool: 'text-to-sound', title: '文生音效', credits: 2 });
    reply(res, ok(task));
  });

/* ================= 文生语音 ================= */
  r.post('/api/tools/text-to-speech', async (req, res, ctx) => {
    const b = ctx.body || {};
    if (!String(b.text || '').trim()) return reply(res, fail('请填写台词'));
    const task = enqueue('text-to-speech', b, async ({ progress }) => {
      const { renderSpeech } = await import('../../engine/audio.mjs');
      progress(50, '合成配音');
      const out = await renderSpeech({ text: b.text, voice: b.voice || 'zh-CN', rate: b.rate });
      const asset = addAsset({ name: (b.text || '配音').slice(0, 26), kind: 'audio', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'text-to-speech' } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, voice: out.voice, fallback: !!out.fallback };
    }, { tool: 'text-to-speech', title: '文生语音', credits: 2 });
    reply(res, ok(task));
  });

/* ================= 视频配乐 ================= */
  r.post('/api/tools/auto-bgm', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择视频'));
    const task = enqueue('auto-bgm', b, async ({ progress }) => {
      const { autoBgm } = await import('../../engine/effects.mjs');
      progress(45, '分析画面情绪');
      const out = await autoBgm({ file: a.file, prompt: b.prompt, mood: b.mood });
      const asset = addAsset({ name: a.name + ' · 配乐', kind: 'video', rel: out.rel, file: out.file, duration: out.duration, meta: { tool: 'auto-bgm', mood: out.mood } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, mood: out.mood };
    }, { tool: 'auto-bgm', title: '视频配乐', credits: 5 });
    reply(res, ok(task));
  });

/* ================= 一键成片（Agent 灵感成片）================= */
  r.post('/api/tools/agent-to-video', async (req, res, ctx) => {
    const b = ctx.body || {};
    const idea = String(b.idea || b.prompt || '').trim();
    if (!idea) return reply(res, fail('请描述你的创意'));
    const task = enqueue('agent-to-video', { idea }, async ({ progress }) => {
      const { renderImage } = await import('../../engine/image.mjs');
      const { renderShot, concatShots, muxAudio } = await import('../../engine/video.mjs');
      const { renderMusic } = await import('../../engine/audio.mjs');
      const llm = await import('../../engine/llm.mjs');
      progress(8, '规划镜头');
      const script = b.script || llm.makeScript({ idea, episodes: 1, scenesPerEp: 1 });
      const scene = script.episodes[0].scenes[0];
      const beats = Array.isArray(b.beats) && b.beats.length ? b.beats : scene.shots.map((s) => s.prompt);
      const shots = [];
      for (let i = 0; i < beats.length; i++) {
        progress(15 + Math.round((i / beats.length) * 60), '镜头 ' + (i + 1) + '/' + beats.length);
        const plate = await renderImage({ prompt: beats[i], title: i === 0 ? script.title : '', width: 1280, height: 720, style: b.style || 'cinematic', seedText: beats[i], index: i, palette: script.palette });
        const shot = await renderShot({ imageFile: plate.file, duration: Number(b.duration) || 3, motion: scene.shots[i % scene.shots.length].motion, look: scene.shots[i % scene.shots.length].look, caption: i === 0 ? script.logline : '' });
        shots.push(shot);
      }
      progress(82, '拼接成片');
      const merged = await concatShots(shots.map((s) => s.file), { transition: 'dissolve' });
      progress(92, '配乐');
      const music = await renderMusic({ prompt: idea, duration: merged.duration || 20, mood: 'cinematic' });
      const muxed = await muxAudio(merged.file, music.file, { audioVolume: 0.6 });
      const asset = addAsset({ name: script.title, kind: 'video', rel: muxed.rel, file: muxed.file, duration: merged.duration, meta: { tool: 'agent-to-video', idea, scriptTitle: script.title } });
      return { ok: true, rel: muxed.rel, file: muxed.file, assetId: asset.id, script, duration: merged.duration };
    }, { tool: 'agent-to-video', title: idea.slice(0, 30), credits: 20 });
    reply(res, ok(task));
  });
}