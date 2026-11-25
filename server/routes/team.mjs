import { db, uid, now, save, addLedger } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';

/* 团队 / 成员 / 分组 / 积分（本地版：积分不阻塞任何操作） */
export function registerTeam(r) {

  r.get('/api/team', (req, res) => {
    const d = db();
    reply(res, ok({ team: d.team, members: d.members, groups: d.groups }));
  });

  r.post('/api/team', (req, res, ctx) => {
    const d = db();
    Object.assign(d.team, ctx.body || {}, { id: d.team.id });
    save();
    reply(res, ok(d.team));
  });

  r.get('/api/team/members', (req, res) => reply(res, ok({ list: db().members })));

  r.post('/api/team/members', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    if (!String(b.name || '').trim()) return reply(res, fail('请填写成员名称'));
    const row = {
      id: uid('mb_'), name: String(b.name).slice(0, 30), email: String(b.email || '').slice(0, 60),
      groupId: b.groupId || 'g_editor', role: b.role || 'member',
      joinedAt: now(), status: 'active', creditsUsed: 0, projects: 0
    };
    d.members.push(row);
    save();
    reply(res, ok(row));
  });

  r.post('/api/team/members/:id', (req, res, ctx) => {
    const d = db();
    const m = d.members.find((x) => x.id === ctx.params.id);
    if (!m) return reply(res, fail('成员不存在'), 404);
    Object.assign(m, ctx.body || {}, { id: m.id });
    save();
    reply(res, ok(m));
  });

  r.post('/api/team/members/:id/delete', (req, res, ctx) => {
    const d = db();
    d.members = d.members.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  r.post('/api/team/members/batch', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const ids = new Set(b.ids || []);
    const patch = {};
    if (b.groupId) patch.groupId = b.groupId;
    if (b.status) patch.status = b.status;
    d.members.forEach((m) => { if (ids.has(m.id)) Object.assign(m, patch); });
    save();
    reply(res, ok({ updated: ids.size }));
  });

  r.get('/api/team/groups', (req, res) => reply(res, ok({ list: db().groups })));

  r.post('/api/team/groups', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = { id: uid('g_'), name: String(b.name || '新分组').slice(0, 20), permissions: Array.isArray(b.permissions) ? b.permissions : ['view'] };
    d.groups.push(row);
    save();
    reply(res, ok(row));
  });

  r.post('/api/team/groups/:id', (req, res, ctx) => {
    const d = db();
    const g = d.groups.find((x) => x.id === ctx.params.id);
    if (!g) return reply(res, fail('分组不存在'), 404);
    Object.assign(g, ctx.body || {}, { id: g.id });
    save();
    reply(res, ok(g));
  });

  r.post('/api/team/groups/:id/delete', (req, res, ctx) => {
    const d = db();
    if (d.groups.length <= 1) return reply(res, fail('至少保留一个分组'));
    d.groups = d.groups.filter((x) => x.id !== ctx.params.id);
    d.members.forEach((m) => { if (m.groupId === ctx.params.id) m.groupId = d.groups[0].id; });
    save();
    reply(res, ok({ ok: true }));
  });

  /* 权限矩阵 */
  r.get('/api/team/permissions', (req, res) => {
    const modules = [
      { key: 'project', label: '项目管理', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'episode', label: '剧集与分镜', actions: ['view', 'create', 'edit', 'delete', 'generate'] },
      { key: 'asset', label: '资产库', actions: ['view', 'upload', 'edit', 'delete', 'download'] },
      { key: 'generate', label: 'AI 生成', actions: ['image', 'video', 'audio', 'text'] },
      { key: 'team', label: '团队管理', actions: ['view', 'invite', 'edit', 'delete'] },
      { key: 'credit', label: '积分', actions: ['view', 'allocate', 'recover'] }
    ];
    reply(res, ok({ modules, groups: db().groups }));
  });

  /* 积分流水（只记不阻塞） */
  r.get('/api/team/points-flow', (req, res) => {
    const d = db();
    reply(res, ok({ list: d.ledger.slice(0, 120), balance: d.team.credits, unlimited: true }));
  });

  /* 团队统计（官方 team statistics） */
  r.get('/api/team/statistics', (req, res) => {
    const d = db();
    const day = 86400000;
    /* createdAt 是 ISO 字符串，统一转毫秒时间戳再比较 */
    const ts = (v) => {
      if (typeof v === 'number') return v;
      const n = Date.parse(String(v || ''));
      return Number.isFinite(n) ? n : 0;
    };
    const t0 = Date.now();
    const since = t0 - 7 * day;
    const tasks = d.tasks || [];
    const done = tasks.filter((t) => t.status === 'done');
    const byKind = {};
    for (const t of tasks) byKind[t.kind || 'other'] = (byKind[t.kind || 'other'] || 0) + 1;
    const byStatus = {};
    for (const t of tasks) byStatus[t.status || 'pending'] = (byStatus[t.status || 'pending'] || 0) + 1;
    const week = tasks.filter((t) => ts(t.createdAt) >= since);
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const from = t0 - (i + 1) * day, to = t0 - i * day;
      daily.push({
        date: new Date(to).toISOString().slice(5, 10),
        count: tasks.filter((t) => { const x = ts(t.createdAt); return x >= from && x < to; }).length
      });
    }
    const assetsByKind = { image: 0, video: 0, audio: 0, file: 0 };
    for (const a of d.assets) assetsByKind[a.kind] = (assetsByKind[a.kind] || 0) + 1;
    const cats = { character: 0, scene: 0, prop: 0, ip: 0 };
    for (const a of d.assets) if (a.cat && cats[a.cat] !== undefined) cats[a.cat]++;
    const memberRows = (d.members || []).map((m) => {
      const own = tasks.filter((t) => t.memberId === m.id).length;
      return { id: m.id, name: m.name, tasks: own, creditsUsed: m.creditsUsed || 0, status: m.status || 'active' };
    }).sort((a, b) => b.tasks - a.tasks);
    /* 官方 team 统计四块：创作消耗 / 项目参与 / 资产成本 / 成员参与 */
    const consumption = {};
    for (const t of tasks) {
      const k = t.tool || t.kind || 'other';
      consumption[k] = consumption[k] || { count: 0, credits: 0, done: 0 };
      consumption[k].count++;
      consumption[k].credits += Number(t.credits) || 0;
      if (t.status === 'done') consumption[k].done++;
    }
    const projectRows = d.projects.map((p) => {
      const eps = d.episodes.filter((e) => e.projectId === p.id);
      const epIds = new Set(eps.map((e) => e.id));
      return {
        id: p.id, title: p.title,
        episodes: eps.length,
        storyboards: d.storyboards.filter((b) => epIds.has(b.episodeId)).length,
        assets: d.assets.filter((a) => (a.projectIds || []).includes(p.id)).length
      };
    }).sort((a, b) => b.storyboards - a.storyboards);
    const assetCost = {};
    for (const a of d.assets) {
      const k = a.kind || 'file';
      assetCost[k] = assetCost[k] || { count: 0, size: 0, credits: 0 };
      assetCost[k].count++;
      assetCost[k].size += Number((a.meta && a.meta.size) || 0);
      assetCost[k].credits += Number(a.credits) || 0;
    }
    reply(res, ok({
      consumption, projectRows, assetCost,
      projects: d.projects.length,
      episodes: d.episodes.length,
      storyboards: d.storyboards.length,
      assets: d.assets.length,
      assetsByKind, cats,
      tasks: tasks.length, done: done.length, failed: tasks.filter((t) => t.status === 'failed').length,
      running: tasks.filter((t) => t.status === 'running' || t.status === 'queued').length,
      week: week.length, byKind, byStatus, daily, members: memberRows,
      unlimited: true
    }));
  });

  /* 团队资产：角色 / 场景 / 道具 三个分类视图（与资产库同一份数据） */
  r.get('/api/team/assets', (req, res, ctx) => {
    const d = db();
    const cat = String((ctx.query || {}).cat || 'character');
    const rows = d.assets.filter((a) => (a.cat || '') === cat);
    reply(res, ok({ cat, list: rows.slice(0, 200), total: rows.length, teamLib: d.assets.filter((a) => a.teamLib).length }));
  });

  r.get('/api/team/ranking', (req, res) => {
    const d = db();
    const rows = d.members.map((m) => ({ id: m.id, name: m.name, used: m.creditsUsed || 0 })).sort((a, b) => b.used - a.used);
    reply(res, ok({ members: rows, projects: d.projects.slice(0, 10).map((p) => ({ id: p.id, title: p.title, episodes: p.episodes })) }));
  });

  r.post('/api/team/points-allocation', (req, res, ctx) => {
    const b = ctx.body || {};
    addLedger(Number(b.amount) || 0, '团队积分分配 ' + (b.memberName || ''));
    reply(res, ok({ unlimited: true, note: '本地版积分不设上限，分配仅作记录' }));
  });

  /* 邀请 */
  r.get('/api/invites', (req, res) => reply(res, ok({ list: db().invites })));
  r.post('/api/invites', (req, res, ctx) => {
    const d = db();
    const row = { id: uid('iv_'), code: 'RM' + Math.random().toString(36).slice(2, 8).toUpperCase(), email: String((ctx.body || {}).email || ''), role: (ctx.body || {}).role || 'editor', used: false, createdAt: now() };
    d.invites.unshift(row);
    save();
    reply(res, ok(row));
  });

  /* 项目成员绑定 */
  r.get('/api/projects/:id/members', (req, res, ctx) => {
    const d = db();
    const p = d.projects.find((x) => x.id === ctx.params.id);
    if (!p) return reply(res, fail('项目不存在'), 404);
    const rows = (p.members || []).map((id) => d.members.find((m) => m.id === id)).filter(Boolean);
    reply(res, ok({ list: rows, all: d.members }));
  });

  r.post('/api/projects/:id/members', (req, res, ctx) => {
    const d = db();
    const p = d.projects.find((x) => x.id === ctx.params.id);
    if (!p) return reply(res, fail('项目不存在'), 404);
    const ids = (ctx.body || {}).memberIds || [];
    p.members = Array.from(new Set(ids));
    p.updatedAt = now();
    save();
    reply(res, ok({ list: p.members }));
  });
}
