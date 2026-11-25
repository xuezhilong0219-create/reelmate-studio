import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';
import { addAsset } from './tools.mjs';

/* 时间线剪辑台：工程 CRUD + 素材面板 + 导出（对应官方 /agent/editor） */

const TRACKS = [
  { id: 'V2', kind: 'video', label: 'V2 视频轨' },
  { id: 'V1', kind: 'video', label: 'V1 视频轨' },
  { id: 'A1', kind: 'audio', label: 'A1 音频轨' },
  { id: 'A2', kind: 'audio', label: 'A2 音频轨' }
];

const relFile = (rel) => (rel ? path.join(MEDIA, String(rel).replace(/^\/media\//, '')) : null);

const newProject = (title) => ({
  id: uid('ed_'),
  title: title || '未命名工程',
  width: 1280,
  height: 720,
  fps: 24,
  tracks: TRACKS.map((t) => t.id),
  clips: [],
  exports: [],
  createdAt: now(),
  updatedAt: now()
});

export function registerEditor(r) {

  r.get('/api/editor', (req, res) => {
    const list = (db().editors || []).map((e) => ({
      id: e.id, title: e.title, clips: (e.clips || []).length,
      width: e.width, height: e.height, fps: e.fps,
      updatedAt: e.updatedAt, exports: (e.exports || []).length
    }));
    reply(res, ok({ list, tracks: TRACKS }));
  });

  r.post('/api/editor', (req, res, ctx) => {
    const d = db();
    d.editors = d.editors || [];
    const row = newProject((ctx.body || {}).title);
    d.editors.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.get('/api/editor/materials', (req, res) => {
    reply(res, ok({ list: collect() }));
  });

  function collect() {
    const d = db();
    const eps = new Map((d.episodes || []).map((e) => [e.id, e]));
    const rows = [];
    for (const sb of d.storyboards || []) {
      if (!sb.videoRel && !sb.imageRel) continue;
      const ep = eps.get(sb.episodeId);
      rows.push({
        id: sb.id, kind: sb.videoRel ? 'video' : 'image',
        name: sb.caption || ('分镜 ' + sb.no),
        rel: sb.videoRel || sb.imageRel,
        file: relFile(sb.videoRel || sb.imageRel),
        duration: sb.duration || null,
        group: ep ? '第' + ep.no + '集 · ' + ep.title : '未分集'
      });
    }
    for (const a of d.assets || []) {
      if (a.kind !== 'video' && a.kind !== 'audio') continue;
      rows.push({ id: a.id, kind: a.kind, name: a.name, rel: a.rel, file: a.file || relFile(a.rel), group: a.kind === 'audio' ? '音频素材' : '视频素材', duration: a.duration || null });
    }
    return rows;
  }

  r.get('/api/editor/:id', (req, res, ctx) => {
    const row = (db().editors || []).find((e) => e.id === ctx.params.id);
    if (!row) return reply(res, fail('工程不存在'));
    reply(res, ok({ project: row, tracks: TRACKS }));
  });

  r.post('/api/editor/:id', (req, res, ctx) => {
    const row = (db().editors || []).find((e) => e.id === ctx.params.id);
    if (!row) return reply(res, fail('工程不存在'));
    const b = ctx.body || {};
    for (const k of ['title', 'width', 'height', 'fps', 'clips', 'tracks', 'cover']) {
      if (b[k] !== undefined) row[k] = b[k];
    }
    row.updatedAt = now();
    save();
    reply(res, ok(row));
  });

  r.post('/api/editor/:id/delete', (req, res, ctx) => {
    const d = db();
    const i = (d.editors || []).findIndex((e) => e.id === ctx.params.id);
    if (i < 0) return reply(res, fail('工程不存在'));
    d.editors.splice(i, 1);
    save();
    reply(res, ok({ deleted: true }));
  });

  r.post('/api/editor/:id/export', async (req, res, ctx) => {
    const d = db();
    const row = (d.editors || []).find((e) => e.id === ctx.params.id);
    if (!row) return reply(res, fail('工程不存在'));
    const clips = (row.clips || []).map((c) => {
      const a = (d.assets || []).find((x) => x.id === c.assetId);
      const file = c.file || (a && a.file) || relFile(c.rel);
      return { ...c, file };
    });
    if (!clips.some((c) => c.file && fs.existsSync(c.file))) return reply(res, fail('时间线上没有可用片段'));

    const task = enqueue('editor', { editorId: row.id }, async ({ progress }) => {
      const { renderTimeline } = await import('../../engine/timeline.mjs');
      const out = await renderTimeline(
        { width: row.width, height: row.height, fps: row.fps, clips },
        (p, step) => progress(p, step)
      );
      const asset = addAsset({
        name: row.title + ' · 成片', kind: 'video', rel: out.rel, file: out.file,
        width: out.width, height: out.height, duration: Math.round(out.duration * 10) / 10,
        meta: { tool: 'editor', fps: out.fps, clips: out.clips }
      });
      const rec = { id: uid('ex_'), at: now(), rel: out.rel, file: out.file, duration: out.duration, fps: out.fps, assetId: asset.id };
      row.exports = [rec, ...(row.exports || [])].slice(0, 20);
      row.exportedAt = now();
      save();
      return { ok: true, rel: out.rel, file: out.file, assetId: asset.id, width: out.width, height: out.height, fps: out.fps, duration: out.duration, videos: [{ rel: out.rel, kind: 'video' }] };
    }, { tool: 'editor', title: '时间线导出 · ' + row.title, credits: 3 });

    reply(res, ok(task));
  });
}
