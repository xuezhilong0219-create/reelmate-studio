import { db, uid, now, save } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';
import { addAsset } from './tools.mjs';

/* 图片后期 / 视频统一 路由：POST /api/post/:cap
   全部走队列，结果全部登记进资产库（不消耗额度） */

function firstAsset(id) {
  const a = db().assets.find((x) => x.id === id);
  return a || null;
}

const one = (out, extra = {}) => ({ ok: true, rel: out.rel, file: out.file, images: [out],
  width: out.width || null, height: out.height || null, ...extra });

export function registerPost(r) {

  r.get('/api/post/caps', async (req, res) => {
    const { POST_CAPS } = await import('../../engine/post.mjs');
    reply(res, ok({ list: POST_CAPS }));
  });

  r.get('/api/post/frames', async (req, res, ctx) => {
    const d = db();
    const rows = d.tasks.filter((t) => t.kind === 'post' && t.result && t.result.images).slice(0, 20);
    reply(res, ok({ list: rows.map((t) => ({ taskId: t.id, cap: (t.params || {}).cap, at: t.createdAt, images: t.result.images })) }));
  });

  /* ---------------- 裁剪 ---------------- */
  r.post('/api/post/crop', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择要裁剪的图片'));
    const task = enqueue('post', { cap: 'crop', ...b }, async ({ progress }) => {
      const { cropImage } = await import('../../engine/post.mjs');
      progress(40, '重构图');
      const out = await cropImage(a.file, b);
      const asset = addAsset({ name: a.name + ' · 裁剪 ' + (out.ratio === 'original' ? '原比例' : out.ratio), kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'crop', ratio: out.ratio } });
      return one(out, { assetId: asset.id, ratio: out.ratio, x: out.x, y: out.y });
    }, { tool: 'crop', title: '裁剪', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 扩图 ---------------- */
  r.post('/api/post/outpaint', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择要扩图的图片'));
    const task = enqueue('post', { cap: 'outpaint', ...b }, async ({ progress }) => {
      const { outpaintImage } = await import('../../engine/post.mjs');
      progress(35, '生成外延画面');
      const out = await outpaintImage(a.file, b);
      progress(85, '融合接缝');
      const asset = addAsset({ name: a.name + ' · 扩图 +' + out.pad + '%', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'outpaint', pad: out.pad } });
      return one(out, { assetId: asset.id, pad: out.pad });
    }, { tool: 'outpaint', title: '扩图', credits: 2 });
    reply(res, ok(task));
  });

  /* ---------------- 宫格切分 ---------------- */
  r.post('/api/post/grid-split', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择要切分的图片'));
    const task = enqueue('post', { cap: 'grid-split', ...b }, async ({ progress }) => {
      const { splitGrid } = await import('../../engine/post.mjs');
      progress(30, '切分 ' + (b.cols || b.count || 3) + ' 宫格');
      const out = await splitGrid(a.file, b);
      progress(80, '登记 ' + out.images.length + ' 张');
      const assets = out.images.map((im) => addAsset({ name: a.name + ' · 第' + im.index + '格', kind: 'image', rel: im.rel, file: im.file, width: im.width, height: im.height, meta: { tool: 'grid-split', index: im.index, row: im.row, col: im.col } }));
      return { ok: true, images: out.images, cols: out.cols, rows: out.rows, total: out.total, cell: out.cell, assetIds: assets.map((x) => x.id) };
    }, { tool: 'grid-split', title: '宫格切分', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 多角度 ---------------- */
  r.post('/api/post/multi-angle', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择参考图'));
    const task = enqueue('post', { cap: 'multi-angle', ...b }, async ({ progress }) => {
      const { multiAngle } = await import('../../engine/post.mjs');
      progress(30, '重建相机位置');
      const out = await multiAngle(a.file, b);
      const assets = out.images.map((im) => addAsset({ name: a.name + ' · ' + im.label, kind: 'image', rel: im.rel, file: im.file, width: im.width, height: im.height, meta: { tool: 'multi-angle', view: im.view, azimuth: im.azimuth, elevation: im.elevation } }));
      return { ok: true, images: out.images, count: out.count, assetIds: assets.map((x) => x.id) };
    }, { tool: 'multi-angle', title: '多角度', credits: 3 });
    reply(res, ok(task));
  });

  /* ---------------- 全景 ---------------- */
  r.post('/api/post/panorama', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择参考图'));
    const task = enqueue('post', { cap: 'panorama', ...b }, async ({ progress }) => {
      const { panoramaImage } = await import('../../engine/post.mjs');
      progress(35, '投影为等距柱状');
      const out = await panoramaImage(a.file, b);
      const asset = addAsset({ name: a.name + ' · ' + out.angle + '° 全景', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'panorama', angle: out.angle } });
      return one(out, { assetId: asset.id, angle: out.angle, turns: out.turns });
    }, { tool: 'panorama', title: '全景', credits: 2 });
    reply(res, ok(task));
  });

  /* ---------------- 剧情推演 ---------------- */
  r.post('/api/post/story-grid', async (req, res, ctx) => {
    const b = ctx.body || {};
    if (!String(b.prompt || '').trim()) return reply(res, fail('请描述要推演的剧情'));
    const task = enqueue('post', { cap: 'story-grid', ...b }, async ({ progress }) => {
      const { storyGrid } = await import('../../engine/post.mjs');
      progress(20, '规划分镜');
      const out = await storyGrid(b);
      progress(85, '拼贴');
      const asset = addAsset({ name: '剧情推演 · ' + String(b.prompt).slice(0, 18), kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'story-grid', cols: out.cols, rows: out.rows } });
      return one(out, { assetId: asset.id, cols: out.cols, rows: out.rows, count: out.count, cells: out.cells });
    }, { tool: 'story-grid', title: '剧情推演', credits: 4 });
    reply(res, ok(task));
  });

  /* ---------------- 抽帧 / 线稿 ---------------- */
  r.post('/api/post/line-art', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择视频'));
    const task = enqueue('post', { cap: 'line-art', ...b }, async ({ progress }) => {
      const { frameLineArt } = await import('../../engine/post.mjs');
      progress(45, '抽帧并转线稿');
      const out = await frameLineArt(a.file, b);
      const asset = addAsset({ name: a.name + ' · 线稿', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'line-art', at: out.at } });
      return one(out, { assetId: asset.id, at: out.at, mode: out.mode });
    }, { tool: 'line-art', title: '抽帧转线稿', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 表情控制 ---------------- */
  r.post('/api/post/expression', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择要调整表情的人像图'));
    const task = enqueue('post', { cap: 'expression', ...b }, async ({ progress }) => {
      const { expressionImage } = await import('../../engine/post.mjs');
      progress(40, '定位人脸区域');
      const out = await expressionImage(a.file, b);
      progress(85, '重映射五官');
      const asset = addAsset({ name: a.name + ' · 表情 ' + out.exprLabel, kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'expression', expr: out.expr, box: out.box } });
      return one(out, { assetId: asset.id, expr: out.expr, exprLabel: out.exprLabel, box: out.box });
    }, { tool: 'expression', title: '表情控制', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 调色板 ---------------- */
  r.post('/api/post/palette', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择图片或视频'));
    const task = enqueue('post', { cap: 'palette', ...b }, async ({ progress }) => {
      const { paletteOf } = await import('../../engine/post.mjs');
      progress(50, '统计主色');
      const out = await paletteOf(a.file, b);
      const asset = addAsset({ name: a.name + ' · 调色板', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'palette', colors: out.colors } });
      return one(out, { assetId: asset.id, colors: out.colors });
    }, { tool: 'palette', title: '调色板', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 标注 ---------------- */
  r.post('/api/post/annotate', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择图片'));
    const task = enqueue('post', { cap: 'annotate', ...b }, async ({ progress }) => {
      const { annotateImage } = await import('../../engine/post.mjs');
      progress(50, '绘制标注');
      const out = await annotateImage(a.file, b);
      const asset = addAsset({ name: a.name + ' · 标注', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'annotate', boxes: out.boxes } });
      return one(out, { assetId: asset.id, boxes: out.boxes, labels: out.labels });
    }, { tool: 'annotate', title: '标注', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 打光 ---------------- */
  r.post('/api/post/relight', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择图片'));
    const task = enqueue('post', { cap: 'relight', ...b }, async ({ progress }) => {
      const { relightImage } = await import('../../engine/post.mjs');
      progress(45, '重建光照');
      const out = await relightImage(a.file, b);
      const asset = addAsset({ name: a.name + ' · ' + out.modeName, kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'relight', mode: out.mode } });
      return one(out, { assetId: asset.id, mode: out.mode, modeName: out.modeName });
    }, { tool: 'relight', title: '打光矫正', credits: 2 });
    reply(res, ok(task));
  });

  /* ---------------- 帧率时长统一 ---------------- */
  r.post('/api/post/unify-video', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择视频'));
    const task = enqueue('post', { cap: 'unify-video', ...b }, async ({ progress }) => {
      const { unifyVideo } = await import('../../engine/post.mjs');
      progress(40, '统一分辨率与帧率');
      const out = await unifyVideo(a.file, b);
      progress(85, '写出');
      const asset = addAsset({ name: a.name + ' · 统一 ' + out.fps + 'fps', kind: 'video', rel: out.rel, file: out.file, width: out.width, height: out.height, duration: out.duration, meta: { tool: 'unify-video', fps: out.fps } });
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, images: [out], width: out.width, height: out.height, fps: out.fps, duration: out.duration };
    }, { tool: 'unify-video', title: '帧率时长统一', credits: 2 });
    reply(res, ok(task));
  });

  /* ---------------- 消除笔 ---------------- */
  r.post('/api/post/eraser', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择要处理的图片'));
    const task = enqueue('post', { cap: 'eraser', ...b }, async ({ progress }) => {
      const { eraserImage } = await import('../../engine/post.mjs');
      progress(40, '扩散填补');
      const out = await eraserImage(a.file, b);
      const asset = addAsset({ name: a.name + ' · 消除', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'eraser', regions: out.regions } });
      return one(out, { assetId: asset.id, regions: out.regions });
    }, { tool: 'eraser', title: '消除笔', credits: 1 });
    reply(res, ok(task));
  });

  /* ---------------- 4 / 12 视图 ---------------- */
  r.post('/api/post/view-grid', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择参考图'));
    const task = enqueue('post', { cap: 'view-grid', ...b }, async ({ progress }) => {
      const { viewGrid } = await import('../../engine/post.mjs');
      progress(30, '生成多视角');
      const out = await viewGrid(a.file, b);
      const asset = addAsset({ name: a.name + ' · ' + out.count + ' 视图', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'view-grid', count: out.count } });
      return one(out, { assetId: asset.id, count: out.count, views: out.views });
    }, { tool: 'view-grid', title: '多视图', credits: 2 });
    reply(res, ok(task));
  });

  /* ---------------- 图片超清 ---------------- */
  r.post('/api/post/image-upscale', async (req, res, ctx) => {
    const b = ctx.body || {};
    const a = firstAsset(b.assetId || b.sourceAssetId);
    if (!a) return reply(res, fail('请选择图片'));
    const task = enqueue('post', { cap: 'image-upscale', ...b }, async ({ progress }) => {
      const { upscaleImage } = await import('../../engine/post.mjs');
      progress(45, '放大并锐化');
      const out = await upscaleImage(a.file, b);
      const asset = addAsset({ name: a.name + ' · 超清 ' + out.scale + 'x', kind: 'image', rel: out.rel, file: out.file, width: out.width, height: out.height, meta: { tool: 'image-upscale', scale: out.scale } });
      return one(out, { assetId: asset.id, scale: out.scale, from: out.from });
    }, { tool: 'image-upscale', title: '图片超清', credits: 2 });
    reply(res, ok(task));
  });
}
