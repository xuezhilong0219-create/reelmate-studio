import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { safeName } from '../util.mjs';
import { probe, thumbnail } from '../../engine/ffmpeg.mjs';

function kindOf(mime, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (/^image\//.test(mime || '') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'image';
  if (/^video\//.test(mime || '') || ['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'video';
  if (/^audio\//.test(mime || '') || ['.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) return 'audio';
  return 'file';
}

const CATS = ['', 'character', 'scene', 'prop', 'ip'];
const MAX_DEPTH = 3;

function depthOf(folders, id) {
  let n = 1, cur = folders.find((f) => f.id === id), guard = 0;
  while (cur && cur.parentId && guard++ < 10) { cur = folders.find((f) => f.id === cur.parentId); n++; }
  return n;
}
function subtree(folders, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}
function descends(folders, rootId, maybeChild) {
  return subtree(folders, rootId).has(maybeChild);
}

export function registerAssets(r) {

  /* 资源库统计（首页/资产页 KPI）— 必须在 :id 之前注册 */
  r.get('/api/assets/stats', (req, res) => {
    const d = db();
    const by = { image: 0, video: 0, audio: 0, file: 0 };
    for (const a of d.assets) by[a.kind] = (by[a.kind] || 0) + 1;
    const cats = { '': 0, character: 0, scene: 0, prop: 0, ip: 0 };
    for (const a of d.assets) cats[a.cat || ''] = (cats[a.cat || ''] || 0) + 1;
    reply(res, ok({ total: d.assets.length, by, cats, folders: d.folders.length, teamLib: d.assets.filter((a) => a.teamLib).length, favorite: d.assets.filter((a) => a.favorite).length }));
  });

  /* 资产列表：支持 kind / folder / 关键词 / 收藏过滤 */
  r.get('/api/assets', (req, res, ctx) => {
    const q = ctx.query || {};
    const d = db();
    let rows = d.assets.slice();
    if (q.kind && q.kind !== 'all') rows = rows.filter((a) => a.kind === q.kind);
    if (q.folderId) rows = rows.filter((a) => a.folderId === q.folderId);
    if (q.favorite === '1') rows = rows.filter((a) => a.favorite);
    if (q.cat) rows = rows.filter((a) => (a.cat || '') === String(q.cat));
    if (q.teamLib === '1') rows = rows.filter((a) => a.teamLib);
    if (q.projectId) rows = rows.filter((a) => (a.projectIds || []).includes(String(q.projectId)));
    if (q.q) {
      const s = String(q.q).toLowerCase();
      rows = rows.filter((a) => (a.name || '').toLowerCase().includes(s) || JSON.stringify(a.meta || {}).toLowerCase().includes(s));
    }
    const limit = Math.max(1, Math.min(500, Number(q.limit) || 200));
    reply(res, ok({ list: rows.slice(0, limit), total: rows.length, folders: d.folders }));
  });

  r.get('/api/assets/:id', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    reply(res, ok(a));
  });

  r.post('/api/assets/:id/favorite', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    a.favorite = !a.favorite;
    save();
    reply(res, ok(a));
  });

  r.post('/api/assets/:id/rename', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    a.name = String((ctx.body || {}).name || a.name).slice(0, 80);
    save();
    reply(res, ok(a));
  });

  r.post('/api/assets/:id/move', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    a.folderId = (ctx.body || {}).folderId || null;
    save();
    reply(res, ok(a));
  });

  r.post('/api/assets/:id/delete', (req, res, ctx) => {
    const d = db();
    const i = d.assets.findIndex((x) => x.id === ctx.params.id);
    if (i === -1) return reply(res, fail('资产不存在'), 404);
    const [a] = d.assets.splice(i, 1);
    save();
    reply(res, ok(a));
  });

  /* 批量删除 */
  r.post('/api/assets/batch-delete', (req, res, ctx) => {
    const d = db();
    const ids = new Set((ctx.body || {}).ids || []);
    const before = d.assets.length;
    d.assets = d.assets.filter((a) => !ids.has(a.id));
    save();
    reply(res, ok({ removed: before - d.assets.length }));
  });

  /* 上传：接受 multipart 或 base64 dataURL */
  r.post('/api/assets/upload', async (req, res, ctx) => {
    const d = db();
    const files = ctx.files || [];
    const fields = ctx.fields || {};
    const out = [];
    for (const f of files) {
      const kind = kindOf(f.mime, f.filename);
      const dir = path.join(MEDIA, 'upload');
      fs.mkdirSync(dir, { recursive: true });
      const id = uid('up_');
      const ext = path.extname(f.filename || '') || (kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.bin');
      const file = path.join(dir, id + ext);
      fs.writeFileSync(file, f.data);
      const rel = '/media/upload/' + id + ext;
      let width = null, height = null, duration = null, thumb = rel;
      if (kind === 'video' || kind === 'image' || kind === 'audio') {
        try {
          const info = await probe(file);
          width = info.width || null; height = info.height || null; duration = info.duration || null;
          if (kind === 'video') {
            const th = path.join(MEDIA, 'image', id + '_thumb.png');
            await thumbnail(file, th, 0.2);
            thumb = '/media/image/' + id + '_thumb.png';
          }
        } catch {}
      }
      const row = {
        id: uid('as_'), name: String(fields.name || f.filename || '上传素材').slice(0, 80),
        kind, rel, file, thumb, width, height, duration, folderId: fields.folderId || null,
        tags: [], meta: { upload: true, size: f.data.length, ext }, favorite: false, createdAt: now()
      };
      d.assets.unshift(row);
      out.push(row);
    }
    save();
    reply(res, ok({ list: out, count: out.length }));
  });

  /* 资产分类与项目绑定（角色 / 场景 / 道具 / IP 模板） */
  r.post('/api/assets/:id/meta', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    const b = ctx.body || {};
    if (b.cat !== undefined) a.cat = CATS.includes(b.cat) ? b.cat : '';
    if (b.name !== undefined) a.name = String(b.name || a.name).slice(0, 80);
    if (Array.isArray(b.tags)) a.tags = b.tags.slice(0, 20).map((t) => String(t).slice(0, 20));
    if (b.teamLib !== undefined) a.teamLib = !!b.teamLib;
    if (b.folderId !== undefined) a.folderId = b.folderId || null;
    save();
    reply(res, ok(a));
  });

  /* 子图 / 历史版本：把另一张图挂成该资产的子图或历史版本 */
  r.post('/api/assets/:id/sub', (req, res, ctx) => {
    const d = db();
    const a = d.assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    const b = ctx.body || {};
    const src = d.assets.find((x) => x.id === b.assetId);
    if (!src) return reply(res, fail('来源资产不存在'), 404);
    const kind = b.mode === 'history' ? 'history' : 'sub';
    if (kind === 'history' && src.kind !== 'image') return reply(res, fail('历史版本仅支持图片资产'));
    a[kind] = a[kind] || [];
    a[kind].unshift({ id: src.id, rel: src.rel, thumb: src.thumb || src.rel, name: src.name, at: now() });
    if (a[kind].length > 12) a[kind].length = 12;
    save();
    reply(res, ok({ asset: a, added: kind }));
  });

  r.post('/api/assets/:id/sub-delete', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('资产不存在'), 404);
    const b = ctx.body || {};
    const kind = b.mode === 'history' ? 'history' : 'sub';
    a[kind] = (a[kind] || []).filter((s) => s.id !== b.subId && s.rel !== b.rel);
    save();
    reply(res, ok(a));
  });

  /* 批量导入到项目 / 保存到团队资产库 */
  r.post('/api/assets/batch-import', (req, res, ctx) => {
    const d = db();
    const b = ctx.body || {};
    const p = d.projects.find((x) => x.id === b.projectId);
    if (!p) return reply(res, fail('项目不存在'), 404);
    const ids = new Set(b.ids || []);
    let n = 0;
    d.assets.forEach((a) => {
      if (!ids.has(a.id)) return;
      a.projectIds = Array.from(new Set([...(a.projectIds || []), p.id]));
      n++;
    });
    p.updatedAt = now();
    save();
    reply(res, ok({ imported: n, projectId: p.id, project: p.title }));
  });

  r.post('/api/assets/batch-team', (req, res, ctx) => {
    const d = db();
    const ids = new Set((ctx.body || {}).ids || []);
    const on = (ctx.body || {}).teamLib === undefined ? true : !!(ctx.body || {}).teamLib;
    let n = 0;
    d.assets.forEach((a) => { if (ids.has(a.id)) { a.teamLib = on; n++; } });
    save();
    reply(res, ok({ updated: n, teamLib: on }));
  });

  /* 文件夹（支持多级 parentId，层级上限 3） */
  r.get('/api/folders', (req, res) => reply(res, ok(db().folders)));
  r.post('/api/folders', (req, res, ctx) => {
    const d = db();
    const b = ctx.body || {};
    const parentId = b.parentId || null;
    if (parentId && depthOf(d.folders, parentId) >= MAX_DEPTH) return reply(res, fail('文件夹层级已达上限（最多 ' + MAX_DEPTH + ' 级）'));
    const row = { id: uid('fd_'), name: String(b.name || '新建文件夹').slice(0, 40), parentId, createdAt: now() };
    d.folders.push(row);
    save();
    reply(res, ok(row));
  });
  r.post('/api/folders/:id', (req, res, ctx) => {
    const d = db();
    const f = d.folders.find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('文件夹不存在'), 404);
    const b = ctx.body || {};
    if (b.name !== undefined) f.name = String(b.name || f.name).slice(0, 40);
    if (b.parentId !== undefined) {
      const pid = b.parentId || null;
      if (pid && (pid === f.id || descends(d.folders, f.id, pid))) return reply(res, fail('不能移动到自身或子文件夹'));
      if (pid && depthOf(d.folders, pid) >= MAX_DEPTH) return reply(res, fail('文件夹层级已达上限'));
      f.parentId = pid;
    }
    save();
    reply(res, ok(f));
  });
  r.post('/api/folders/:id/delete', (req, res, ctx) => {
    const d = db();
    const ids = subtree(d.folders, ctx.params.id);
    d.folders = d.folders.filter((f) => !ids.has(f.id));
    d.assets.forEach((a) => { if (ids.has(a.folderId)) a.folderId = null; });
    save();
    reply(res, ok({ ok: true, removed: ids.size }));
  });
}
