import { MEDIA, db, uid, now, save } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';
import path from 'node:path';
import fs from 'node:fs';

/* 视频后期 6 项能力：冻帧延长 / 截帧 / 音频提取 / 深度动捕 / 视频拉片 / 片段重拍 */
export function registerVPost(r) {
  const relFile = (rel) => (rel ? path.join(MEDIA, String(rel).replace(/^\/media\//, '')) : null);
  const firstAsset = (id) => (db().assets || []).find((a) => a.id === id) || null;
  const vid = (b) => firstAsset(b.assetId || b.sourceAssetId || b.id);

  function addAsset(asset) {
    const d = db();
    asset.id = asset.id || uid('as_');
    asset.createdAt = now();
    d.assets.unshift(asset);
    save();
    return asset;
  }

  r.get('/api/vpost/caps', async (req, res) => {
    const { VPOST_CAPS } = await import('../../engine/vpost.mjs');
    reply(res, ok({ list: VPOST_CAPS }));
  });

  r.post('/api/vpost/freeze-extend', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = vid(b);
    if (!a) return reply(res, fail('请选择视频素材'));
    const task = enqueue('vpost', { cap: 'freeze-extend', assetId: a.id }, async ({ progress }) => {
      const { freezeExtend } = await import('../../engine/vpost.mjs');
      progress(30, '延长冻帧');
      const out = await freezeExtend(relFile(a.rel), { seconds: b.seconds, at: b.at });
      const asset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_冻帧.mp4', kind: 'video', rel: out.rel, file: out.file, width: out.width, height: out.height, duration: out.duration, meta: { from: a.id, cap: 'freeze-extend' } });
      return { ok: true, rel: out.rel, file: out.file, images: [{ ...out, label: '冻帧 +' + out.seconds + 's' }], assetId: asset.id, duration: out.duration };
    }, { tool: 'vpost', title: '冻帧延长 · ' + a.name, credits: 2 });
    reply(res, ok(task));
  });

  r.post('/api/vpost/frame-capture', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = vid(b);
    if (!a) return reply(res, fail('请选择视频素材'));
    const task = enqueue('vpost', { cap: 'frame-capture', assetId: a.id }, async ({ progress }) => {
      const { frameCapture } = await import('../../engine/vpost.mjs');
      progress(30, '抽取画面');
      const out = await frameCapture(relFile(a.rel), { count: b.count, at: b.at });
      const ids = [];
      const list = out.frames && out.frames.length ? out.frames : [{ rel: out.rel, at: out.at }];
      for (const f of list) {
        const asset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_' + (f.at || 0).toFixed(1) + 's.png', kind: 'image', rel: f.rel, file: relFile(f.rel), meta: { from: a.id, cap: 'frame-capture' } });
        ids.push(asset.id);
      }
      const images = list.map((f, i) => ({ rel: f.rel, file: relFile(f.rel), label: (f.at || 0).toFixed(1) + 's', index: i + 1 }));
      return { ok: true, rel: out.rel, file: out.file, images, assetIds: ids, count: out.count };
    }, { tool: 'vpost', title: '截帧 · ' + a.name, credits: 1 });
    reply(res, ok(task));
  });

  r.post('/api/vpost/audio-separate', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = vid(b);
    if (!a) return reply(res, fail('请选择视频素材'));
    const task = enqueue('vpost', { cap: 'audio-separate', assetId: a.id }, async ({ progress }) => {
      const { audioSeparate } = await import('../../engine/vpost.mjs');
      progress(30, '分离音轨');
      const out = await audioSeparate(relFile(a.rel), { mode: b.mode });
      const ext = out.kind === 'video' ? '.mp4' : '.mp3';
      const asset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_' + out.modeName + ext, kind: out.kind, rel: out.rel, file: out.file, duration: out.duration, meta: { from: a.id, cap: 'audio-separate', mode: out.mode } });
      return { ok: true, rel: out.rel, file: out.file, images: [{ ...out, label: out.modeName }], assetId: asset.id, mode: out.mode };
    }, { tool: 'vpost', title: '音频提取 · ' + a.name, credits: 1 });
    reply(res, ok(task));
  });

  r.post('/api/vpost/depth-capture', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = vid(b);
    if (!a) return reply(res, fail('请选择视频素材'));
    const task = enqueue('vpost', { cap: 'depth-capture', assetId: a.id }, async ({ progress }) => {
      const { depthCapture } = await import('../../engine/vpost.mjs');
      progress(30, '估计深度');
      const out = await depthCapture(relFile(a.rel), { at: b.at, color: b.color });
      const asset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_深度.png', kind: 'image', rel: out.rel, file: out.file, meta: { from: a.id, cap: 'depth-capture' } });
      return { ok: true, rel: out.rel, file: out.file, images: [{ ...out, label: out.color ? '伪彩深度' : '灰度深度' }], assetId: asset.id };
    }, { tool: 'vpost', title: '深度动捕 · ' + a.name, credits: 1 });
    reply(res, ok(task));
  });

  r.post('/api/vpost/video-parse', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = vid(b);
    if (!a) return reply(res, fail('请选择视频素材'));
    const task = enqueue('vpost', { cap: 'video-parse', assetId: a.id }, async ({ progress }) => {
      const { videoParse } = await import('../../engine/vpost.mjs');
      progress(25, '切分镜头');
      const out = await videoParse(relFile(a.rel), {});
      const sheetAsset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_联系表.png', kind: 'image', rel: out.sheetRel, file: relFile(out.sheetRel), meta: { from: a.id, cap: 'video-parse' } });
      const tableAsset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_拉片表.png', kind: 'image', rel: out.tableRel, file: out.tableFile, meta: { from: a.id, cap: 'video-parse' } });
      return {
        ok: true, rel: out.sheetRel, file: out.file,
        images: [
          { rel: out.sheetRel, label: '联系表 · ' + out.shots.length + ' 段', index: 1 },
          { rel: out.tableRel, label: '拉片表', index: 2 },
        ],
        assetIds: [sheetAsset.id, tableAsset.id],
        shots: out.shots, cuts: out.cuts, duration: out.duration,
      };
    }, { tool: 'vpost', title: '视频拉片 · ' + a.name, credits: 2 });
    reply(res, ok(task));
  });

  r.post('/api/vpost/local-repaint', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = vid(b);
    if (!a) return reply(res, fail('请选择视频素材'));
    const task = enqueue('vpost', { cap: 'local-repaint', assetId: a.id }, async ({ progress }) => {
      const { localRepaint } = await import('../../engine/vpost.mjs');
      progress(30, '重拍片段');
      const out = await localRepaint(relFile(a.rel), { start: b.start, end: b.end, prompt: b.prompt, motion: b.motion });
      const asset = addAsset({ name: (a.name || '视频').replace(/\.[^.]+$/, '') + '_重拍.mp4', kind: 'video', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { from: a.id, cap: 'local-repaint' } });
      return { ok: true, rel: out.rel, file: out.file, images: [{ ...out, label: '替换 ' + out.replaced + 's' }], assetId: asset.id, segments: out.segments };
    }, { tool: 'vpost', title: '片段重拍 · ' + a.name, credits: 3 });
    reply(res, ok(task));
  });
}
