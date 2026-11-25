import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA, ROOT } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { zipTo, safeEntryName } from '../../engine/zip.mjs';

const REVIEW = ['not_reviewed', 'pass', 'fail'];

function relFile(rel) {
  if (!rel) return null;
  return path.join(MEDIA, String(rel).replace(/^\/media\//, ''));
}

function extOf(a) {
  const f = a.file || a.rel || '';
  const e = path.extname(f).toLowerCase();
  return e || '.bin';
}

/* 素材表：按资产给出角色 / 场景 / 道具 / 图片 / 备注 / 责任人 / 审阅状态 */
function rowOf(a) {
  const m = a.meta || {};
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    rel: a.rel,
    thumb: a.thumb || a.rel,
    cat: a.cat || '',
    role: m.role || (a.cat === 'character' ? a.name : ''),
    setting: m.setting || (a.cat === 'scene' ? a.name : ''),
    implement: m.implement || (a.cat === 'prop' ? a.name : ''),
    imageRel: a.kind === 'image' ? a.rel : (a.thumb || null),
    remark: m.remark || '',
    assignee: a.assignee || '',
    review: REVIEW.includes(a.review) ? a.review : 'not_reviewed',
    teamLib: !!a.teamLib,
    projectIds: a.projectIds || [],
    createdAt: a.createdAt
  };
}

export function registerSheet(r) {
  /* 全局统计（KPI 卡用，不受筛选影响） */
  r.get('/api/sheet/stats', (req, res) => {
    const d = db();
    const stat = { total: d.assets.length, not_reviewed: 0, pass: 0, fail: 0, assigned: 0, teamLib: 0 };
    d.assets.forEach((a) => {
      const rv = REVIEW.includes(a.review) ? a.review : 'not_reviewed';
      stat[rv]++;
      if (a.assignee) stat.assigned++;
      if (a.teamLib) stat.teamLib++;
    });
    reply(res, ok(stat));
  });

  /* 列表：可按项目 / 分类 / 责任人 / 审阅状态过滤 */
  r.get('/api/sheet', (req, res, ctx) => {
    const q = ctx.query || {};
    const d = db();
    let rows = d.assets.slice();
    if (q.cat) rows = rows.filter((a) => (a.cat || '') === String(q.cat));
    if (q.projectId) rows = rows.filter((a) => (a.projectIds || []).includes(String(q.projectId)));
    if (q.assignee) rows = rows.filter((a) => String(a.assignee || '') === String(q.assignee));
    if (q.review) rows = rows.filter((a) => (REVIEW.includes(a.review) ? a.review : 'not_reviewed') === String(q.review));
    if (q.q) {
      const s = String(q.q).toLowerCase();
      rows = rows.filter((a) => String(a.name || '').toLowerCase().includes(s));
    }
    const out = rows.slice(0, Number(q.limit) || 300).map(rowOf);
    const stat = { total: out.length, not_reviewed: 0, pass: 0, fail: 0 };
    out.forEach((x) => { stat[x.review] = (stat[x.review] || 0) + 1; });
    reply(res, ok({
      list: out,
      total: out.length,
      all: rows.length,
      stat,
      members: (d.members || []).map((m) => ({ id: m.id, name: m.name }))
    }));
  });

  /* 批量：指定负责人 / 改审阅状态 / 保存主体（把素材名写成角色·场景·道具主体） / 删除 */
  r.post('/api/sheet/batch', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const ids = new Set(b.ids || []);
    const picked = d.assets.filter((a) => ids.has(a.id));
    if (!picked.length) return reply(res, fail('请先选择素材'));
    const act = String(b.action || '');
    let n = 0;

    if (act === 'assignee') {
      const who = String(b.assignee || '');
      picked.forEach((a) => { a.assignee = who; n++; });
    } else if (act === 'review') {
      const rv = REVIEW.includes(b.review) ? b.review : 'not_reviewed';
      picked.forEach((a) => { a.review = rv; n++; });
    } else if (act === 'subject') {
      /* 保存主体：把该素材设为角色/场景/道具的主体，并标记已保存 */
      picked.forEach((a) => {
        if (a.subject) return;
        a.meta = a.meta || {};
        const cat = a.cat || (b.cat && ['character', 'scene', 'prop'].includes(b.cat) ? b.cat : '');
        if (!cat) return;
        a.cat = cat;
        if (cat === 'character' && !a.meta.role) a.meta.role = a.name;
        if (cat === 'scene' && !a.meta.setting) a.meta.setting = a.name;
        if (cat === 'prop' && !a.meta.implement) a.meta.implement = a.name;
        a.subject = true;
        n++;
      });
      if (!n) return reply(res, ok({ updated: 0, message: '所选资产均已保存为主体或缺少分类，无需重复保存' }));
    } else if (act === 'delete') {
      const gone = new Set(picked.map((a) => a.id));
      for (const a of picked) {
        const f = relFile(a.rel);
        if (f) { try { fs.unlinkSync(f); } catch {} }
      }
      d.assets = d.assets.filter((a) => !gone.has(a.id));
      n = gone.size;
    } else {
      return reply(res, fail('未知操作：' + act));
    }

    save();
    reply(res, ok({ action: act, updated: n }));
  });

  /* 批量下载：把所选素材打成 ZIP，返回任务 id，前端轮询后跳 /api/sheet/download/:id */
  const packs = new Map();

  r.post('/api/sheet/download', (req, res, ctx) => {
    const d = db();
    const ids = new Set((ctx.body || {}).ids || []);
    const picked = d.assets.filter((a) => ids.has(a.id) && a.rel);
    if (!picked.length) return reply(res, fail('请先选择要下载的素材'));
    const id = uid('zip_');
    const name = '素材包_' + new Date().toISOString().slice(0, 10) + '_' + picked.length + '项.zip';
    const dest = path.join(ROOT, '.tmp', 'pack', id + '.zip');
    const entries = [];
    const used = new Set();
    let total = 0;
    for (const a of picked) {
      const f = relFile(a.rel);
      if (!f || !fs.existsSync(f)) continue;
      let size = 0;
      try { size = fs.statSync(f).size; } catch {}
      total += size;
      if (total > 400 * 1024 * 1024) return reply(res, fail('所选素材超过 400MB，请分批打包'));
      let base = safeEntryName(a.name || a.id);
      if (!path.extname(base)) base += extOf(a);
      let entry = base;
      let k = 1;
      while (used.has(entry)) { entry = base.replace(/(\.[^.]+)?$/, '_' + (k++) + '$1'); }
      used.add(entry);
      entries.push({ name: entry, file: f, store: size > 4 * 1024 * 1024 });
    }
    let info;
    try {
      info = zipTo(dest, entries);
    } catch (e) {
      return reply(res, fail('打包失败：' + String((e && e.message) || e)));
    }
    packs.set(id, { id, file: dest, name, count: info.count, bytes: info.bytes, at: Date.now() });
    reply(res, ok({ id, name, count: info.count, bytes: info.bytes, url: '/api/sheet/download/' + id }));
  });

  r.get('/api/sheet/download/:id', (req, res, ctx) => {
    const p = packs.get(ctx.params.id);
    if (!p || !fs.existsSync(p.file)) return reply(res, fail('打包文件已过期，请重新打包'), 404);
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': p.bytes,
      'content-disposition': 'attachment; filename="' + encodeURIComponent(p.name) + '"; filename*=UTF-8\'\'' + encodeURIComponent(p.name)
    });
    fs.createReadStream(p.file).pipe(res);
  });

  /* 单行改：责任人 / 审阅状态 / 备注 / 角色名 / 场景名 / 道具名（必须在所有静态子路径之后注册） */
  r.post('/api/sheet/:id', (req, res, ctx) => {
    const a = db().assets.find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('素材不存在'), 404);
    const b = ctx.body || {};
    a.meta = a.meta || {};
    if (b.assignee !== undefined) a.assignee = String(b.assignee || '').slice(0, 40);
    if (b.review !== undefined) a.review = REVIEW.includes(b.review) ? b.review : 'not_reviewed';
    if (b.remark !== undefined) a.meta.remark = String(b.remark || '').slice(0, 200);
    if (b.role !== undefined) a.meta.role = String(b.role || '').slice(0, 60);
    if (b.setting !== undefined) a.meta.setting = String(b.setting || '').slice(0, 60);
    if (b.implement !== undefined) a.meta.implement = String(b.implement || '').slice(0, 60);
    save();
    reply(res, ok(rowOf(a)));
  });

  /* 打包状态查询（前端轮询用，与任务接口兼容） */
  r.get('/api/sheet/pack/:id', (req, res, ctx) => {
    const p = packs.get(ctx.params.id);
    if (!p) return reply(res, ok({ id: ctx.params.id, status: 'gone' }));
    reply(res, ok({ id: p.id, name: p.name, count: p.count, bytes: p.bytes, status: 'done', url: '/api/sheet/download/' + p.id }));
  });
}