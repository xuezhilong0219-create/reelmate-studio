import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';
import { zipTo, safeEntryName } from '../../engine/zip.mjs';

/* 影视项目壳（官方 film.json → #/film/:id）
   shell: 项目 / 资产库 / 团队    nav: 任务 / 资产 / 制作 / 成员 / 统计
   另有：上传封面、导出记录（提交结果下载 / 任务表下载）、任务表 Excel 导入 */

const TASK_ST = { todo: '待开始', doing: '进行中', review: '待审核', done: '已完成', failed: '已驳回' };
const FILM_DIR = path.join(MEDIA, 'film');
const relOf = (f) => '/media/film/' + path.basename(f);

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const relFile = (rel) => (rel ? path.join(MEDIA, String(rel).replace(/^\/media\//, '')) : null);

function ensure(d) {
  if (!Array.isArray(d.filmProjects)) d.filmProjects = [];
  return d;
}

function filmRow(f) {
  const d = db();
  const tasks = (f.tasks || []);
  const assets = (f.assets || []);
  return {
    id: f.id, title: f.title, logline: f.logline || '', kind: f.kind || 'film',
    status: f.status || 'draft', cover: f.cover || null, projectId: f.projectId || null,
    members: (f.members || []).length, folders: (f.folders || []).length,
    assets: assets.length, tasks: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    canvases: (f.canvases || []).length,
    exports: (f.exports || []).length,
    createdAt: f.createdAt, updatedAt: f.updatedAt || f.createdAt
  };
}

function projectOf(f) {
  const d = db();
  return (d.projects || []).find((p) => p.id === f.projectId) || null;
}

export function registerFilm(r) {
  /* ---------- 列表 ---------- */
  r.get('/api/film', (req, res, ctx) => {
    const q = ctx.query || {};
    const d = ensure(db());
    let rows = d.filmProjects.map(filmRow);
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((f) => (f.title || '').toLowerCase().includes(s)); }
    reply(res, ok({ list: rows, total: rows.length, kinds: [['film', '电影'], ['series', '剧集'], ['short', '短片'], ['doc', '纪录片']] }));
  });

  /* ---------- 新建（含封面） ---------- */
  r.post('/api/film', async (req, res, ctx) => {
    const d = ensure(db());
    const b = ctx.body || {};
    let cover = b.cover || null;
    const f = (ctx.files || [])[0];
    if (f && f.data && /^image\//.test(f.mime || '')) {
      fs.mkdirSync(FILM_DIR, { recursive: true });
      const id = uid('fc_');
      const ext = (path.extname(f.filename || '') || '.png').toLowerCase();
      const dest = path.join(FILM_DIR, id + ext);
      fs.writeFileSync(dest, f.data);
      cover = relOf(dest);
    }
    const row = {
      id: uid('fm_'), title: String(b.title || '未命名影视项目').slice(0, 60),
      logline: String(b.logline || '').slice(0, 300), kind: ['film', 'series', 'short', 'doc'].includes(b.kind) ? b.kind : 'film',
      status: 'draft', cover, projectId: b.projectId || null,
      members: [], folders: [], assets: [], tasks: [], canvases: [], exports: [],
      createdAt: now(), updatedAt: now()
    };
    d.filmProjects.unshift(row);
    save();
    reply(res, ok(row));
  });

  /* ---------- 详情（含三 tab 与五导航数据） ---------- */
  r.get('/api/film/:id', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const p = projectOf(f);
    const tasks = f.tasks || [];
    const assets = f.assets || [];
    const done = tasks.filter((t) => t.status === 'done').length;
    const byStatus = {};
    for (const k of Object.keys(TASK_ST)) byStatus[k] = tasks.filter((t) => (t.status || 'todo') === k).length;
    reply(res, ok({
      project: filmRow(f), detail: f,
      linked: p ? { id: p.id, title: p.title, episodes: p.episodes } : null,
      nav: {
        task: { total: tasks.length, done, rate: tasks.length ? Math.round((done / tasks.length) * 100) : 0, byStatus },
        asset: { total: assets.length, folders: (f.folders || []).length },
        produce: { total: (f.canvases || []).length },
        member: { total: (f.members || []).length },
        stats: { exports: (f.exports || []).length }
      },
      taskStatus: TASK_ST,
      members: (db().members || []).map((m) => ({ id: m.id, name: m.name }))
    }));
  });

  r.post('/api/film/:id', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const b = ctx.body || {};
    for (const k of ['title', 'logline', 'kind', 'status', 'projectId', 'cover']) if (b[k] !== undefined) f[k] = b[k];
    f.updatedAt = now();
    save();
    reply(res, ok(filmRow(f)));
  });

  r.post('/api/film/:id/delete', (req, res, ctx) => {
    const d = ensure(db());
    const before = d.filmProjects.length;
    d.filmProjects = d.filmProjects.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true, removed: before - d.filmProjects.length }));
  });

  /* ---------- 封面 ---------- */
  r.post('/api/film/:id/cover', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const file = (ctx.files || [])[0];
    if (!file || !file.data) return reply(res, fail('请选择封面图'));
    fs.mkdirSync(FILM_DIR, { recursive: true });
    const id = uid('fc_');
    const ext = (path.extname(file.filename || '') || '.png').toLowerCase();
    const dest = path.join(FILM_DIR, id + ext);
    fs.writeFileSync(dest, file.data);
    f.cover = relOf(dest);
    f.updatedAt = now();
    save();
    reply(res, ok({ cover: f.cover }));
  });

  /* ---------- 任务（Excel 导入 + 增删改） ---------- */
  const FIELDS = ['name', 'shot', 'content', 'assignee', 'status', 'deadline', 'remark'];

  r.post('/api/film/:id/tasks', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.tasks = f.tasks || [];
    const b = ctx.body || {};
    const rows = Array.isArray(b.rows) ? b.rows : [b];
    let added = 0;
    for (const it of rows.slice(0, 1000)) {
      if (!String(it.name || it.content || '').trim()) continue;
      f.tasks.push({
        id: uid('ft_'), name: String(it.name || it.content).slice(0, 80),
        shot: String(it.shot || ''), content: String(it.content || ''),
        assignee: String(it.assignee || ''), status: TASK_ST[it.status] ? it.status : 'todo',
        deadline: String(it.deadline || ''), remark: String(it.remark || ''),
        createdAt: now()
      });
      added++;
    }
    f.updatedAt = now();
    save();
    reply(res, ok({ added, total: f.tasks.length }));
  });

  r.post('/api/film/:id/task/:tid', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = (f.tasks || []).find((x) => x.id === ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const b = ctx.body || {};
    for (const k of FIELDS) if (b[k] !== undefined) t[k] = k === 'status' ? (TASK_ST[b[k]] ? b[k] : t.status) : String(b[k]);
    t.updatedAt = now();
    save();
    reply(res, ok(t));
  });

  r.post('/api/film/:id/task/:tid/delete', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.tasks = (f.tasks || []).filter((x) => x.id !== ctx.params.tid);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ---------- 结果审核（官方 film.json tasks.review.*） ---------- */
  const kindOf = (name) => (/.(png|jpe?g|webp|gif|bmp)$/i.test(name) ? 'image' : /.(mp4|mov|webm|mkv)$/i.test(name) ? 'video' : /.(mp3|wav|m4a|aac)$/i.test(name) ? 'audio' : 'file');
  const taskOf = (f, tid) => (f.tasks || []).find((x) => x.id === tid) || null;
  const reviewOf = (t) => {
    if (!t.review || typeof t.review !== 'object') t.review = { status: '', version: 0, submittedAt: null, reviewedAt: null, note: '' };
    if (!Array.isArray(t.files)) t.files = [];
    if (!Array.isArray(t.comments)) t.comments = [];
    return t.review;
  };

  r.get('/api/film/:id/task/:tid/review', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = taskOf(f, ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const rv = reviewOf(t);
    reply(res, ok({
      task: { id: t.id, name: t.name, shot: t.shot || '', content: t.content || '', assignee: t.assignee || '', status: t.status, deadline: t.deadline || '', remark: t.remark || '' },
      review: rv, files: t.files, comments: t.comments,
      canvases: (f.canvases || []).map((c) => ({ id: c.id, title: c.title })),
      canvasId: t.canvasId || null,
      statusLabel: TASK_ST[t.status] || t.status
    }));
  });

  r.post('/api/film/:id/task/:tid/review', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = taskOf(f, ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const rv = reviewOf(t);
    const b = ctx.body || {};
    const act = String(b.action || '');
    if (act === 'submit') {
      if (!t.files.length) return reply(res, fail('当前任务暂未提交结果素材'));
      rv.version = (rv.version || 0) + 1;
      rv.status = 'pending';
      rv.submittedAt = now();
      rv.reviewedAt = null;
      t.status = 'review';
    } else if (act === 'pass' || act === 'fail') {
      rv.status = act;
      rv.note = String(b.note || '').slice(0, 300);
      rv.reviewedAt = now();
      t.status = act === 'pass' ? 'done' : 'failed';
    } else return reply(res, fail('未知审核操作'));
    t.updatedAt = now();
    f.updatedAt = now();
    save();
    reply(res, ok({ review: rv, task: { id: t.id, name: t.name, status: t.status } }));
  });

  r.post('/api/film/:id/task/:tid/comment', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = taskOf(f, ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    reviewOf(t);
    const text = String((ctx.body || {}).text || '').trim();
    if (!text) return reply(res, fail('请输入批注内容'));
    t.comments.push({ id: uid('cm_'), text: text.slice(0, 500), by: String((ctx.body || {}).by || '本地用户'), at: now() });
    save();
    reply(res, ok({ comments: t.comments }));
  });

  r.post('/api/film/:id/task/:tid/file', async (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = taskOf(f, ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    reviewOf(t);
    const files = ctx.files || [];
    if (!files.length) return reply(res, fail('请选择文件'));
    const dir = path.join(MEDIA, 'film', f.id, 'result');
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files.slice(0, 20)) {
      const ext = path.extname(file.filename || '').slice(0, 10) || '.bin';
      const id = uid('tr_');
      const dest = path.join(dir, id + ext);
      fs.writeFileSync(dest, file.data);
      t.files.push({ id, name: String(file.filename || id + ext).slice(0, 120), rel: '/media/film/' + f.id + '/result/' + id + ext, kind: kindOf(file.filename || ext), at: now() });
    }
    save();
    reply(res, ok({ files: t.files }));
  });

  r.post('/api/film/:id/task/:tid/file/:fid/delete', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = taskOf(f, ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    reviewOf(t);
    t.files = t.files.filter((x) => x.id !== ctx.params.fid);
    save();
    reply(res, ok({ files: t.files }));
  });

  r.post('/api/film/:id/task/:tid/canvas', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const t = taskOf(f, ctx.params.tid);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const cid = String((ctx.body || {}).canvasId || '');
    if (cid && !(f.canvases || []).some((c) => c.id === cid)) return reply(res, fail('画布不存在'), 404);
    t.canvasId = cid || null;
    save();
    reply(res, ok({ canvasId: t.canvasId }));
  });

  /* 任务表导入（xlsx） */
  r.post('/api/film/:id/tasks/import', async (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const file = (ctx.files || [])[0];
    if (!file || !file.data) return reply(res, fail('请选择xlsx文件'));
    if (!/\.xlsx$/i.test(file.filename || '')) return reply(res, fail('仅支持xlsx格式文件'));
    if (file.data.length > 100 * 1024 * 1024) return reply(res, fail('请将文件大小控制在100M及以内'));
    fs.mkdirSync(path.join(MEDIA, 'tmp'), { recursive: true });
    const dest = path.join(MEDIA, 'tmp', uid('ft_') + '.xlsx');
    fs.writeFileSync(dest, file.data);
    let rows = [];
    try {
      const { readDocument } = await import('../../engine/office.mjs');
      const doc = readDocument(dest, file.filename);
      rows = doc.kind === 'rows' ? doc.rows : [];
    } catch (e) { return reply(res, fail('文件解析失败：' + String(e.message || e).slice(0, 60))); }
    if (!rows.length) return reply(res, fail('未读取到任务行'));
    const head = rows[0].map((s) => String(s || '').trim());
    const col = (cands, fb) => { const i = head.findIndex((h) => cands.some((c) => h.includes(c))); return i >= 0 ? i : fb; };
    const cName = col(['任务名称', '任务', '内容', '名称'], 0);
    const cShot = col(['镜号', '段落'], 1);
    const cContent = col(['描述', '详情', '制作要求'], 2);
    const cAss = col(['负责人', '责任人', '执行'], -1);
    const cSt = col(['状态', '进度'], -1);
    const cDl = col(['截止', '交付'], -1);
    const cRm = col(['备注', '说明'], -1);
    f.tasks = f.tasks || [];
    let added = 0;
    for (const row of rows.slice(1, 1001)) {
      const name = String(row[cName] || '').trim();
      if (!name) continue;
      const stRaw = cSt >= 0 ? String(row[cSt] || '') : '';
      const st = /完成|done/i.test(stRaw) ? 'done' : /进行|doing/i.test(stRaw) ? 'doing' : /审核|review/i.test(stRaw) ? 'review' : 'todo';
      f.tasks.push({
        id: uid('ft_'), name: name.slice(0, 80),
        shot: cShot >= 0 ? String(row[cShot] || '') : '',
        content: cContent >= 0 ? String(row[cContent] || '') : '',
        assignee: cAss >= 0 ? String(row[cAss] || '') : '',
        status: st, deadline: cDl >= 0 ? String(row[cDl] || '') : '',
        remark: cRm >= 0 ? String(row[cRm] || '') : '', createdAt: now()
      });
      added++;
    }
    f.updatedAt = now();
    save();
    reply(res, ok({ added, total: f.tasks.length, head }));
  });

  /* ---------- 资产（文件夹 + 素材） ---------- */
  r.post('/api/film/:id/folder', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.folders = f.folders || [];
    const b = ctx.body || {};
    const parentId = b.parentId || null;
    if (parentId) {
      const parent = f.folders.find((x) => x.id === parentId);
      if (!parent) return reply(res, fail('父文件夹不存在'));
      if ((parent.depth || 0) >= 2) return reply(res, fail('文件夹层级已达上限（最多 3 级）'));
    }
    const parent = parentId ? f.folders.find((x) => x.id === parentId) : null;
    const row = { id: uid('ff_'), name: String(b.name || '新建文件夹').slice(0, 40), parentId, depth: parent ? (parent.depth || 0) + 1 : 0, createdAt: now() };
    f.folders.push(row);
    save();
    reply(res, ok(row));
  });

  r.post('/api/film/:id/folder/:fid/delete', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const kill = new Set([ctx.params.fid]);
    let grew = true;
    while (grew) { grew = false; for (const x of f.folders || []) if (x.parentId && kill.has(x.parentId) && !kill.has(x.id)) { kill.add(x.id); grew = true; } }
    f.folders = (f.folders || []).filter((x) => !kill.has(x.id));
    f.assets = (f.assets || []).filter((a) => !kill.has(a.folderId));
    save();
    reply(res, ok({ removed: kill.size }));
  });

  r.post('/api/film/:id/assets', async (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.assets = f.assets || [];
    const b = ctx.body || {};
    /* 从全局资产库导入 */
    if (Array.isArray(b.assetIds) && b.assetIds.length) {
      const d = db();
      let added = 0;
      for (const id of b.assetIds.slice(0, 200)) {
        const a = (d.assets || []).find((x) => x.id === id);
        if (!a || f.assets.some((x) => x.assetId === id)) continue;
        f.assets.push({ id: uid('fa_'), assetId: a.id, name: a.name, kind: a.kind, rel: a.rel, thumbRel: a.thumbRel || a.thumb || null, folderId: b.folderId || null, prompt: a.prompt || '', createdAt: now() });
        added++;
      }
      f.updatedAt = now(); save();
      return reply(res, ok({ added, total: f.assets.length }));
    }
    /* 本地上传 */
    const files = ctx.files || [];
    let added = 0;
    if (files.length) {
      const dir = path.join(MEDIA, 'film', f.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const fl of files.slice(0, 200)) {
        if (!fl.data || !fl.data.length) continue;
        const id = uid('fa_');
        const ext = (path.extname(fl.filename || '') || '.bin').toLowerCase();
        const dest = path.join(dir, id + ext);
        fs.writeFileSync(dest, fl.data);
        const isImg = /^image\//.test(fl.mime || '') || /\.(png|jpe?g|webp|gif)$/i.test(ext);
        const isVid = /^video\//.test(fl.mime || '') || /\.(mp4|mov|webm)$/i.test(ext);
        f.assets.push({
          id, assetId: null, name: fl.filename || id + ext, kind: isImg ? 'image' : isVid ? 'video' : 'file',
          rel: '/media/film/' + f.id + '/' + id + ext, thumbRel: isImg ? '/media/film/' + f.id + '/' + id + ext : null,
          folderId: b.folderId || (ctx.fields && ctx.fields.folderId) || null, prompt: '', createdAt: now()
        });
        added++;
      }
      f.updatedAt = now(); save();
    }
    reply(res, ok({ added, total: f.assets.length }));
  });

  r.post('/api/film/:id/asset/:aid/delete', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.assets = (f.assets || []).filter((x) => x.id !== ctx.params.aid);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ---------- 成员 ---------- */
  r.post('/api/film/:id/members', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.members = f.members || [];
    const b = ctx.body || {};
    const ids = Array.isArray(b.ids) ? b.ids : [b.id || b.memberId];
    const d = db();
    let added = 0;
    for (const id of ids.filter(Boolean)) {
      if (f.members.some((m) => m.id === id)) continue;
      const m = (d.members || []).find((x) => x.id === id);
      if (!m) continue;
      f.members.push({ id: m.id, name: m.name, role: b.role || '成员', joinedAt: now() });
      added++;
    }
    save();
    reply(res, ok({ added, total: f.members.length }));
  });

  r.post('/api/film/:id/member/:mid/delete', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.members = (f.members || []).filter((x) => x.id !== ctx.params.mid);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ---------- 制作（画布） ---------- */
  r.post('/api/film/:id/produce', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.canvases = f.canvases || [];
    const b = ctx.body || {};
    const d = db();
    let canvasId = b.canvasId || null;
    if (!canvasId) {
      const c = { id: uid('cv_'), name: String(b.name || '未命名画布').slice(0, 40), nodes: [], edges: [], filmId: f.id, createdAt: now(), updatedAt: now() };
      d.canvasProjects = d.canvasProjects || [];
      d.canvasProjects.unshift(c);
      canvasId = c.id;
    }
    if (f.canvases.some((x) => x.id === canvasId)) return reply(res, ok({ ok: true, id: canvasId }));
    f.canvases.push({ id: canvasId, title: String(b.name || '无限画布').slice(0, 40), createdAt: now() });
    save();
    reply(res, ok({ ok: true, id: canvasId }));
  });

  r.post('/api/film/:id/produce/:cid/delete', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    f.canvases = (f.canvases || []).filter((x) => x.id !== ctx.params.cid);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ---------- 统计 ---------- */
  r.get('/api/film/:id/stats', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const tasks = f.tasks || [];
    const byStatus = {};
    for (const k of Object.keys(TASK_ST)) byStatus[k] = tasks.filter((t) => (t.status || 'todo') === k).length;
    const byPerson = {};
    for (const t of tasks) { const k = t.assignee || '未指派'; byPerson[k] = (byPerson[k] || 0) + 1; }
    const byKind = {};
    for (const a of f.assets || []) byKind[a.kind || 'file'] = (byKind[a.kind || 'file'] || 0) + 1;
    reply(res, ok({
      tasks: tasks.length, done: byStatus.done, rate: tasks.length ? Math.round((byStatus.done / tasks.length) * 100) : 0,
      byStatus, byPerson, byKind,
      assets: (f.assets || []).length, folders: (f.folders || []).length,
      members: (f.members || []).length, canvases: (f.canvases || []).length, exports: (f.exports || []).length
    }));
  });

  /* ---------- 导出记录：提交结果打包 / 任务表下载 ---------- */
  r.get('/api/film/:id/exports', (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    reply(res, ok({ list: (f.exports || []).slice(0, 50) }));
  });

  r.post('/api/film/:id/export', async (req, res, ctx) => {
    const f = (ensure(db()).filmProjects || []).find((x) => x.id === ctx.params.id);
    if (!f) return reply(res, fail('影视项目不存在'), 404);
    const b = ctx.body || {};
    const kind = b.kind === 'table' ? 'table' : 'result';
    f.exports = f.exports || [];
    const row = { id: uid('fx_'), kind, name: '', count: 0, bytes: 0, rel: null, createdAt: now(), by: '本地用户' };
    if (kind === 'result') {
      const done = (f.tasks || []).filter((t) => t.status === 'done');
      if (!done.length) return reply(res, fail('导出失败，没有审核结果可用于导出'));
      const entries = done.map((t) => ({ name: safeEntryName((t.shot ? t.shot + '_' : '') + t.name) + '.txt', data: [t.name, '镜号：' + (t.shot || '—'), '负责人：' + (t.assignee || '—'), '状态：' + (TASK_ST[t.status] || t.status), '制作要求：' + (t.content || '—'), '备注：' + (t.remark || '—')].join('\n') }));
      const dir = path.join(MEDIA, 'film');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, row.id + '.zip');
      const z = zipTo(file, entries);
      row.name = '提交结果_' + f.title + '_' + done.length + '项.zip';
      row.count = done.length; row.bytes = z.bytes; row.rel = relOf(file);
    } else {
      const tasks = f.tasks || [];
      const head = ['任务名称', '镜号', '内容', '负责人', '状态', '截止', '备注'];
      const lines = [head.join('\t')].concat(tasks.map((t) => [t.name, t.shot, t.content, t.assignee, TASK_ST[t.status] || t.status, t.deadline, t.remark].map((v) => String(v == null ? '' : v).replace(/[\t\n]/g, ' ')).join('\t')));
      const dir = path.join(MEDIA, 'film');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, row.id + '.tsv');
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      row.name = '任务表_' + f.title + '.tsv';
      row.count = tasks.length;
      row.bytes = Buffer.byteLength(lines.join('\n'), 'utf8');
      row.rel = relOf(file);
    }
    f.exports.unshift(row);
    save();
    reply(res, ok(row));
  });
}
