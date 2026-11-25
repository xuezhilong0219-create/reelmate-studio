import { db, now, uid, save } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { listTasks, getTask, queueStats } from '../queue.mjs';

/* 任务表格视图（官方 task.json）：字段管理 / 多视图 / 筛选排序 / 子任务 / 审核 / 导出 */

const BUILTIN = [
  { k: 'title', label: '任务名称', w: 230, locked: true },
  { k: 'tool', label: '类型', w: 110 },
  { k: 'status', label: '状态', w: 88 },
  { k: 'progress', label: '进度', w: 84 },
  { k: 'review', label: '审核', w: 86 },
  { k: 'credits', label: '额度', w: 64 },
  { k: 'duration', label: '耗时', w: 78 },
  { k: 'createdAt', label: '创建时间', w: 150 },
  { k: 'step', label: '当前步骤', w: 200 }
];
const ST = ['queued', 'running', 'done', 'failed', 'cancelled'];
const REVIEW = ['', 'pending', 'pass', 'fail'];

/* 官方 film.json tasks.templates：官方模板 + 团队模板（保存/应用/删除） */
const OFFICIAL_TPL = [
  { id: 'of_running', name: '本周进行中', desc: '只看正在跑的任务，带进度与耗时', filter: { status: 'running' }, fields: ['title', 'tool', 'status', 'progress', 'duration'] },
  { id: 'of_review', name: '待审核交付', desc: '已完成但还没审的任务，逐个过审', filter: { status: 'done', review: 'none' }, fields: ['title', 'tool', 'status', 'review', 'duration', 'step'] },
  { id: 'of_failed', name: '失败排查', desc: '失败任务与报错步骤', filter: { status: 'failed' }, fields: ['title', 'tool', 'status', 'step', 'createdAt'] },
  { id: 'of_all', name: '全字段总览', desc: '不筛选，展示全部可用列', filter: {}, fields: ['title', 'tool', 'status', 'progress', 'review', 'credits', 'duration', 'createdAt', 'step'] }
];

function board() {
  const d = db();
  if (!d.taskBoard) d.taskBoard = { fields: [], views: [], templates: [] };
  if (!Array.isArray(d.taskBoard.fields)) d.taskBoard.fields = [];
  if (!Array.isArray(d.taskBoard.views)) d.taskBoard.views = [];
  if (!Array.isArray(d.taskBoard.templates)) d.taskBoard.templates = [];
  return d.taskBoard;
}

const durOf = (t) => {
  if (!t.startedAt) return 0;
  const a = Date.parse(t.startedAt) || 0;
  const b = Date.parse(t.finishedAt || '') || Date.now();
  return Math.max(0, Math.round((b - a) / 1000));
};

function rowOf(t) {
  const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
  return {
    id: t.id, kind: t.kind, title: t.title || t.kind, tool: t.tool || t.kind,
    status: t.status, progress: t.progress || 0, step: t.step || '',
    credits: t.credits || 0, error: t.error || null,
    review: t.review || '', reviewNote: t.reviewNote || '',
    createdAt: t.createdAt, finishedAt: t.finishedAt || null, duration: durOf(t),
    fields: t.fields || {},
    subtasks: subs.map((s, i) => ({ i, title: s.title, done: !!s.done })),
    subTotal: subs.length, subDone: subs.filter((s) => s.done).length,
    hasResult: !!(t.result && (t.result.rel || t.result.images || t.result.file))
  };
}

function filtered(q) {
  let rows = db().tasks.slice();
  if (q.status && q.status !== 'all' && ST.includes(q.status)) rows = rows.filter((t) => t.status === q.status);
  if (q.tool) rows = rows.filter((t) => (t.tool || t.kind) === q.tool);
  if (q.kind) rows = rows.filter((t) => t.kind === q.kind);
  if (q.review === 'none') rows = rows.filter((t) => !t.review);
  else if (q.review && REVIEW.includes(q.review)) rows = rows.filter((t) => t.review === q.review);
  if (q.from) { const a = Date.parse(q.from) || 0; rows = rows.filter((t) => (Date.parse(t.createdAt) || 0) >= a); }
  if (q.to) { const b = Date.parse(q.to) || 0; rows = rows.filter((t) => (Date.parse(t.createdAt) || 0) <= b + 86400000); }
  const kw = String(q.q || '').trim().toLowerCase();
  if (kw) rows = rows.filter((t) => ((t.title || '') + ' ' + (t.tool || '') + ' ' + (t.step || '') + ' ' + (t.error || '')).toLowerCase().includes(kw));
  if (q.customField) {
    const fv = String(q.customValue || '').toLowerCase();
    rows = rows.filter((t) => String(((t.fields || {})[q.customField]) || '').toLowerCase().includes(fv));
  }
  const sort = q.sort || 'createdAt';
  const dir = q.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = sort === 'duration' ? durOf(a) : sort === 'title' ? String(a.title || '') : sort === 'status' ? String(a.status || '') : sort === 'progress' ? (a.progress || 0) : (Date.parse(a.createdAt) || 0);
    const vb = sort === 'duration' ? durOf(b) : sort === 'title' ? String(b.title || '') : sort === 'status' ? String(b.status || '') : sort === 'progress' ? (b.progress || 0) : (Date.parse(b.createdAt) || 0);
    return va === vb ? 0 : (va > vb ? dir : -dir);
  });
  return rows;
}

const csvCell = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';

export function registerTaskBoard(r) {

  r.get('/api/taskboard/meta', (req, res) => {
    const b = board();
    const d = db();
    const stats = {
      total: d.tasks.length,
      byStatus: ST.reduce((m, s) => { m[s] = d.tasks.filter((t) => t.status === s).length; return m; }, {}),
      reviewed: d.tasks.filter((t) => t.review === 'pass').length,
      rejected: d.tasks.filter((t) => t.review === 'fail').length,
      queue: queueStats()
    };
    const tools = Array.from(new Set(d.tasks.map((t) => t.tool || t.kind))).sort();
    reply(res, ok({ builtin: BUILTIN, custom: b.fields, views: b.views, templates: b.templates, official: OFFICIAL_TPL, stats, tools, review: REVIEW }));
  });

  r.post('/api/taskboard/fields', (req, res, ctx) => {
    const t = board();
    const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (b.action === 'add') {
      if (!name) return reply(res, fail('请填写字段名称'));
      if (name.length > 20) return reply(res, fail('字段名称不超过 20 个字符'));
      if (t.fields.some((f) => f.k === name) || BUILTIN.some((f) => f.label === name)) return reply(res, fail('字段已存在'));
      if (t.fields.length >= 12) return reply(res, fail('自定义字段最多 12 个'));
      t.fields.push({ k: name, label: name, custom: true });
    } else if (b.action === 'remove') {
      t.fields = t.fields.filter((f) => f.k !== name);
    } else return reply(res, fail('未知操作'));
    save();
    reply(res, ok({ fields: t.fields }));
  });

  r.post('/api/taskboard/views', (req, res, ctx) => {
    const t = board();
    const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (!name) return reply(res, fail('请填写视图名称'));
    if (name.length > 50) return reply(res, fail('视图名称不超过 50 个字符'));
    const same = t.views.find((v) => v.name === name);
    if (same) {
      same.filter = b.filter || {};
      same.fields = b.fields || [];
      same.updatedAt = now();
      save();
      return reply(res, ok(same));
    }
    const row = { id: uid('tvw_'), name, filter: b.filter || {}, fields: b.fields || [], createdAt: now() };
    t.views.unshift(row);
    t.views = t.views.slice(0, 20);
    save();
    reply(res, ok(row));
  });

  r.post('/api/taskboard/views/:id/delete', (req, res, ctx) => {
    const t = board();
    const n = t.views.length;
    t.views = t.views.filter((v) => v.id !== ctx.params.id);
    save();
    reply(res, ok({ removed: n - t.views.length }));
  });

  r.get('/api/taskboard/templates', (req, res) => {
    const t = board();
    reply(res, ok({ official: OFFICIAL_TPL, team: t.templates }));
  });

  r.post('/api/taskboard/templates', (req, res, ctx) => {
    const t = board();
    const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (!name) return reply(res, fail('请填写模板名称'));
    if (name.length > 50) return reply(res, fail('模板名称不超过 50 个字符'));
    const fields = Array.isArray(b.fields) ? b.fields.filter((k) => typeof k === 'string').slice(0, 24) : [];
    const same = t.templates.find((x) => x.name === name);
    if (same) {
      same.filter = b.filter || {};
      same.fields = fields;
      same.updatedAt = now();
      save();
      return reply(res, ok(same));
    }
    if (t.templates.length >= 30) return reply(res, fail('团队模板最多 30 个'));
    const row = { id: uid('ttpl_'), name, filter: b.filter || {}, fields, by: String(b.by || '本地用户'), createdAt: now() };
    t.templates.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.post('/api/taskboard/templates/:id/delete', (req, res, ctx) => {
    const t = board();
    const n = t.templates.length;
    t.templates = t.templates.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ removed: n - t.templates.length, team: t.templates }));
  });

  r.get('/api/taskboard', (req, res, ctx) => {
    const q = ctx.query || {};
    const rows = filtered(q);
    const limit = Math.max(1, Math.min(500, Number(q.limit) || 200));
    reply(res, ok({ list: rows.slice(0, limit).map(rowOf), total: rows.length, shown: Math.min(limit, rows.length), fields: board().fields, stats: queueStats() }));
  });

  r.get('/api/taskboard/export', (req, res, ctx) => {
    const q = ctx.query || {};
    const rows = filtered(q).map(rowOf);
    const b = board();
    const cols = ['任务名称', '类型', '状态', '进度', '审核', '额度', '耗时(秒)', '创建时间', '当前步骤'].concat(b.fields.map((f) => f.k));
    const lines = [cols.map(csvCell).join(',')];
    rows.forEach((x) => lines.push([x.title, x.tool, x.status, x.progress + '%', x.review || '未审阅', x.credits, x.duration, x.createdAt, x.step]
      .concat(b.fields.map((f) => (x.fields || {})[f.k] || '')).map(csvCell).join(',')));
    const body = '\uFEFF' + lines.join('\r\n');
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tasks.csv"; filename*=UTF-8\'\'%E4%BB%BB%E5%8A%A1%E8%A1%A8.csv' });
    res.end(body);
  });

  r.get('/api/taskboard/template', (req, res) => {
    const body = '\uFEFF' + ['任务名称\t类型\t状态\t负责人\t截止时间\t备注', '主角特写镜头\tvideo\t待开始\t本地用户\t2026-12-01\t需补拍'].join('\r\n');
    res.writeHead(200, { 'content-type': 'text/tab-separated-values; charset=utf-8', 'content-disposition': 'attachment; filename="task-template.tsv"; filename*=UTF-8\'\'%E4%BB%BB%E5%8A%A1%E6%A8%A1%E6%9D%BF.tsv' });
    res.end(body);
  });

  r.post('/api/taskboard/:id/review', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const b = ctx.body || {};
    const rv = String(b.result || '');
    if (!REVIEW.includes(rv)) return reply(res, fail('审核结果只能是 pending / pass / fail / 清空'));
    t.review = rv;
    t.reviewNote = String(b.note || '').slice(0, 200);
    t.reviewedAt = rv && rv !== 'pending' ? now() : null;
    if (rv === 'pending') t.submittedAt = now();
    save();
    reply(res, ok(rowOf(t)));
  });

  r.post('/api/taskboard/:id/subtasks', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    const b = ctx.body || {};
    if (b.add) {
      const title = String(b.add).trim();
      if (!title) return reply(res, fail('请填写子任务名称'));
      if (t.subtasks.length >= 20) return reply(res, fail('子任务最多 20 条'));
      t.subtasks.push({ title: title.slice(0, 60), done: false, createdAt: now() });
    } else if (b.toggle !== undefined) {
      const i = Number(b.toggle);
      if (t.subtasks[i]) t.subtasks[i].done = !t.subtasks[i].done;
    } else if (b.remove !== undefined) {
      t.subtasks.splice(Number(b.remove), 1);
    }
    save();
    reply(res, ok(rowOf(t)));
  });

  r.post('/api/taskboard/:id/field', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const b = ctx.body || {};
    const name = String(b.name || '').trim();
    if (!name) return reply(res, fail('请指定字段'));
    if (!t.fields) t.fields = {};
    t.fields[name] = String(b.value === undefined ? '' : b.value).slice(0, 200);
    save();
    reply(res, ok(rowOf(t)));
  });

  r.post('/api/taskboard/:id/comment', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    if (!Array.isArray(t.comments)) t.comments = [];
    const text = String((ctx.body || {}).text || '').trim();
    if (!text) return reply(res, fail('请输入批注内容'));
    t.comments.push({ id: uid('cm_'), text: text.slice(0, 500), by: String((ctx.body || {}).by || '本地用户'), at: now() });
    save();
    reply(res, ok({ comments: t.comments }));
  });

  r.get('/api/taskboard/:id', (req, res, ctx) => {
    const t = getTask(ctx.params.id);
    if (!t) return reply(res, fail('任务不存在'), 404);
    const res0 = t.result || null;
    /* 结果里任何 /media/ 链接都视为可审核素材（各任务返回结构不同，做浅层收集） */
    const files = [];
    const seen = new Set();
    const kindBy = (rel) => (/\.(mp4|webm|mov|mkv)$/i.test(rel) ? 'video' : /\.(mp3|wav|m4a|aac)$/i.test(rel) ? 'audio' : /\.(png|jpe?g|webp|gif|bmp)$/i.test(rel) ? 'image' : 'file');
    const pushRel = (rel, name) => {
      if (typeof rel !== 'string' || !rel.startsWith('/media/') || seen.has(rel)) return;
      seen.add(rel);
      const base = rel.split('/').pop();
      files.push({ id: 'r' + files.length, name: String(name || base).slice(0, 120), rel, kind: kindBy(rel), at: t.finishedAt || t.createdAt });
    };
    const walk = (o, d) => {
      if (!o || d > 3) return;
      if (typeof o === 'string') return pushRel(o);
      if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); return; }
      if (typeof o !== 'object') return;
      if (typeof o.rel === 'string') pushRel(o.rel, o.label || o.name || o.title);
      for (const k of Object.keys(o)) if (k !== 'rel') walk(o[k], d + 1);
    };
    walk(res0, 0);
    reply(res, ok({ task: rowOf(t), params: t.params || {}, result: res0, comments: t.comments || [], files, reviewNote: t.reviewNote || '' }));
  });
}
