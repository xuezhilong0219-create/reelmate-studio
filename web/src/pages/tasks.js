import { api, esc, toast, fmtTime, fmtDur, statusLabel, openModal, closeModal } from '../lib.js';
import { openReview } from '../components/review.js';

/* 任务中心 · 表格视图（官方 task.json）：字段管理 / 多视图 / 筛选排序 / 子任务 / 审核 / 导出 */

const ST = [['all', '全部任务'], ['running', '进行中'], ['queued', '排队'], ['done', '已完成'], ['failed', '失败'], ['cancelled', '已取消']];
const REVIEW = [['', '未审阅'], ['pending', '待审核'], ['pass', '通过'], ['fail', '驳回']];
const SCOL = { queued: 'var(--dim)', running: '#7dd3fc', done: 'var(--ok,#34d399)', failed: 'var(--err,#f87171)', cancelled: 'var(--dim)' };
const DEF_COLS = ['title', 'tool', 'status', 'progress', 'review', 'duration', 'createdAt'];

let q = { status: 'all', tool: '', review: '', q: '', from: '', to: '', sort: 'createdAt', dir: 'desc' };
let cols = DEF_COLS.slice();
let meta = { builtin: [], custom: [], views: [], tools: [] };
let rows = [];
let total = 0;
let opened = {};

const qs = () => Object.keys(q).filter((k) => q[k] !== '' && q[k] !== undefined).map((k) => k + '=' + encodeURIComponent(q[k])).join('&');
const defOf = (k) => (meta.builtin || []).find((f) => f.k === k) || (meta.custom || []).find((f) => f.k === k) || { k: k, label: k };
const allCols = () => (meta.builtin || []).concat((meta.custom || []).map((f) => ({ k: f.k, label: f.label, custom: true })));

async function load() {
  const d = await api('/api/taskboard?' + qs());
  rows = d.list || [];
  total = d.total || 0;
}

function head() {
  return [
    '<div class="page-head">',
    '  <div><h1>任务中心</h1><p>表格视图 · 字段可配 · 子任务与审核 · 全部任务本地执行</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="ghost" id="tb-cols">字段管理</button>',
    '  <button class="ghost" id="tb-tpllib">模板</button>',
    '  <button class="ghost" id="tb-saveview">保存视图</button>',
    '  <button class="ghost" id="tb-export">导出 CSV</button>',
    '  <a class="ghost" id="tb-tpl" href="/api/taskboard/template" download>模板表</a>',
    '  <button class="primary" id="tb-refresh">刷新</button>',
    '</div>'
  ].join('');
}

function tabs() {
  const pills = ST.map((s) => '<button data-st="' + s[0] + '" class="' + (q.status === s[0] ? 'on' : '') + '">' + s[1] + '</button>').join('');
  const views = (meta.views || []).map((v) => '<span class="chip" data-view="' + esc(v.id) + '" style="cursor:pointer">' + esc(v.name) +
    ' <b data-vdel="' + esc(v.id) + '" style="cursor:pointer;color:var(--dim)">×</b></span>').join('');
  return '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="pill-tabs" id="tb-status">' + pills + '</div>' + views + '</div>';
}

function filterBar() {
  const tools = (meta.tools || []).map((t) => '<option value="' + esc(t) + '"' + (q.tool === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  const revs = REVIEW.map((r) => '<option value="' + r[0] + '"' + (q.review === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('');
  return [
    '<div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">',
    '  <label class="field" style="margin:0;min-width:150px">类型<select id="tb-tool"><option value="">全部类型</option>' + tools + '</select></label>',
    '  <label class="field" style="margin:0;min-width:120px">审核<select id="tb-review">' + revs + '</select></label>',
    '  <label class="field" style="margin:0;min-width:180px;flex:1">关键词<input id="tb-q" value="' + esc(q.q) + '" placeholder="任务名 / 步骤 / 报错" /></label>',
    '  <label class="field" style="margin:0">起始日期<input id="tb-from" type="date" value="' + esc(q.from) + '" /></label>',
    '  <label class="field" style="margin:0">结束日期<input id="tb-to" type="date" value="' + esc(q.to) + '" /></label>',
    '  <button class="ghost" id="tb-reset">清空</button>',
    '</div>'
  ].join('');
}

function cell(r, k) {
  if (k === 'title') return '<button class="icon-btn" data-x="' + r.id + '" style="margin-right:6px">' + (opened[r.id] ? '▾' : '▸') + '</button>' +
    '<span data-rvw="' + r.id + '" title="打开审核" style="color:var(--brand);cursor:pointer;margin-right:6px;font-size:11.5px">审核</span>' +
    '<span style="font-size:12.5px">' + esc(r.title) + '</span>' +
    (r.subTotal ? ' <span class="chip" style="font-size:10px">' + r.subDone + '/' + r.subTotal + '</span>' : '') +
    (r.error ? ' <span class="chip warn" style="font-size:10px">报错</span>' : '');
  if (k === 'tool') return '<span class="chip" style="font-size:10.5px">' + esc(r.tool) + '</span>';
  if (k === 'status') return '<span style="font-size:12px;color:' + (SCOL[r.status] || 'var(--muted)') + '">' + esc(statusLabel(r.status)) + '</span>';
  if (k === 'progress') return r.status === 'running' || r.status === 'queued'
    ? '<div class="progress" style="width:80px"><i style="width:' + (r.progress || 0) + '%"></i></div>'
    : '<span style="font-size:12px;color:var(--dim)">' + (r.progress || 0) + '%</span>';
  if (k === 'review') return '<select data-review="' + r.id + '" style="font-size:11.5px;padding:3px 6px">' +
    REVIEW.map((x) => '<option value="' + x[0] + '"' + (r.review === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>';
  if (k === 'credits') return '<span style="font-size:12px;color:var(--dim)">' + (r.credits || 0) + '</span>';
  if (k === 'duration') return '<span style="font-size:12px;color:var(--dim)">' + (r.duration ? fmtDur(r.duration) : '—') + '</span>';
  if (k === 'createdAt') return '<span style="font-size:11.5px;color:var(--dim)">' + fmtTime(r.createdAt) + '</span>';
  if (k === 'step') return '<span style="font-size:11.5px;color:var(--muted)">' + esc(r.step || '—') + '</span>';
  return '<input data-fld="' + esc(k) + '" data-id="' + r.id + '" value="' + esc((r.fields || {})[k] || '') + '" style="width:100%;font-size:11.5px;padding:3px 6px" />';
}

function detailRow(r) {
  const subs = (r.subtasks || []).map((s) => '<div class="row" style="gap:6px;align-items:center">' +
    '<input type="checkbox" data-sub-toggle="' + r.id + '|' + s.i + '"' + (s.done ? ' checked' : '') + ' style="width:auto" />' +
    '<span style="font-size:12px;' + (s.done ? 'text-decoration:line-through;color:var(--dim)' : '') + '">' + esc(s.title) + '</span>' +
    '<button class="icon-btn" data-sub-del="' + r.id + '|' + s.i + '">×</button></div>').join('');
  const custom = (meta.custom || []).map((f) => '<div class="st-kv"><span>' + esc(f.label) + '</span><b>' + esc((r.fields || {})[f.k] || '—') + '</b></div>').join('');
  return '<tr><td colspan="' + (cols.length + 1) + '" style="background:#0b1219;padding:12px 14px">' +
    '<div class="grid g2" style="gap:14px">' +
    '<div><div class="section-title" style="font-size:12px">子任务 · ' + r.subDone + '/' + r.subTotal + '</div>' +
    '<div>' + (subs || '<div style="font-size:12px;color:var(--dim)">还没有子任务</div>') + '</div>' +
    '<div class="row" style="gap:6px;margin-top:8px"><input id="tb-sub-' + r.id + '" placeholder="新增子任务" style="font-size:12px;padding:4px 8px;flex:1" />' +
    '<button class="ghost tiny" data-sub-add="' + r.id + '">添加</button></div></div>' +
    '<div><div class="section-title" style="font-size:12px">详情</div>' +
    '<div class="st-kv"><span>任务 ID</span><b style="font-size:11px">' + esc(r.id) + '</b></div>' +
    '<div class="st-kv"><span>当前步骤</span><b>' + esc(r.step || '—') + '</b></div>' +
    '<div class="st-kv"><span>耗时</span><b>' + (r.duration ? fmtDur(r.duration) : '—') + '</b></div>' +
    '<div class="st-kv"><span>错误</span><b style="color:' + (r.error ? 'var(--err)' : 'var(--muted)') + '">' + esc(r.error || '无') + '</b></div>' + custom +
    '<div class="row" style="gap:6px;margin-top:8px"><button class="ghost tiny" data-detail="' + r.id + '">查看参数与结果</button></div></div>' +
    '</div></td></tr>';
}

function table() {
  const th = '<th style="width:34px"></th>' + cols.map((k) => {
    const f = defOf(k);
    const on = q.sort === k;
    return '<th data-sort="' + k + '" style="cursor:pointer;width:' + (f.w || 120) + 'px">' + esc(f.label) + (on ? (q.dir === 'asc' ? ' ↑' : ' ↓') : '') + '</th>';
  }).join('');
  const body = rows.length ? rows.map((r) => '<tr data-row="' + r.id + '">' +
    '<td style="padding:6px 4px">' + (r.hasResult ? '<span title="有产出" style="color:var(--ok)">●</span>' : '') + '</td>' +
    cols.map((k) => '<td style="padding:6px 8px">' + cell(r, k) + '</td>').join('') + '</tr>' +
    (opened[r.id] ? detailRow(r) : '')).join('') : '<tr><td colspan="' + (cols.length + 1) + '"><div class="empty">没有符合条件的任务</div></td></tr>';
  return '<div class="card" style="padding:0;overflow:auto"><table class="tbl"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    '<div style="font-size:11.5px;color:var(--dim);margin-top:8px">共 ' + total + ' 条，当前显示 ' + rows.length + ' 条 · 点表头排序，点 ▸ 展开子任务与详情</div>';
}

function paint(view) { view.querySelector('#tb-box').innerHTML = table(); bindRows(view); }
async function reload(view) { await load(); paint(view); }

function bindRows(view) {
  view.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', async () => {
    const k = th.getAttribute('data-sort');
    if (q.sort === k) q.dir = q.dir === 'asc' ? 'desc' : 'asc'; else { q.sort = k; q.dir = 'desc'; }
    await reload(view);
  }));
  view.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
    const id = b.getAttribute('data-x');
    opened[id] = !opened[id];
    paint(view);
  }));
  view.querySelectorAll('[data-review]').forEach((s) => s.addEventListener('change', async () => {
    try { await api('/api/taskboard/' + s.getAttribute('data-review') + '/review', { method: 'POST', body: { result: s.value } }); toast('审核结果已保存', 'ok'); await reload(view); }
    catch (e) { toast(e.message, 'err'); }
  }));
  view.querySelectorAll('[data-fld]').forEach((i) => i.addEventListener('change', async () => {
    try { await api('/api/taskboard/' + i.getAttribute('data-id') + '/field', { method: 'POST', body: { name: i.getAttribute('data-fld'), value: i.value } }); }
    catch (e) { toast(e.message, 'err'); }
  }));
  view.querySelectorAll('[data-sub-add]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-sub-add');
    const inp = view.querySelector('#tb-sub-' + id);
    if (!inp || !inp.value.trim()) return toast('先写子任务名称', 'err');
    try { await api('/api/taskboard/' + id + '/subtasks', { method: 'POST', body: { add: inp.value } }); await reload(view); }
    catch (e) { toast(e.message, 'err'); }
  }));
  view.querySelectorAll('[data-sub-toggle]').forEach((c) => c.addEventListener('change', async () => {
    const p = c.getAttribute('data-sub-toggle').split('|');
    try { await api('/api/taskboard/' + p[0] + '/subtasks', { method: 'POST', body: { toggle: Number(p[1]) } }); await reload(view); }
    catch (e) { toast(e.message, 'err'); }
  }));
  view.querySelectorAll('[data-sub-del]').forEach((b) => b.addEventListener('click', async () => {
    const p = b.getAttribute('data-sub-del').split('|');
    try { await api('/api/taskboard/' + p[0] + '/subtasks', { method: 'POST', body: { remove: Number(p[1]) } }); await reload(view); }
    catch (e) { toast(e.message, 'err'); }
  }));
  view.querySelectorAll('[data-rvw]').forEach((b) => b.addEventListener('click', () => openTaskDrawer(b.getAttribute('data-rvw'), view)));
  view.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const d = await api('/api/taskboard/' + b.getAttribute('data-detail'));
      openModal('<div class="section-title">参数</div><pre class="wk-pre">' + esc(JSON.stringify(d.params, null, 2)) + '</pre>' +
        '<div class="section-title">结果</div><pre class="wk-pre">' + esc(JSON.stringify(d.result, null, 2).slice(0, 4000)) + '</pre>', { wide: true });
    } catch (e) { toast(e.message, 'err'); }
  }));
}

const tplCond = (f) => {
  const bits = [];
  if (f && f.status && f.status !== 'all') bits.push('状态 ' + statusLabel(f.status));
  if (f && f.tool) bits.push('类型 ' + f.tool);
  if (f && f.review) bits.push('审核 ' + (f.review === 'none' ? '未审阅' : f.review === 'pass' ? '通过' : '驳回'));
  if (f && f.q) bits.push('关键词 ' + f.q);
  return bits.length ? bits.join(' · ') : '全部任务';
};

function tplRow(t, team, view) {
  return '<div class="row" data-tpl="' + esc(t.id) + '" style="gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)">' +
    '<div style="flex:1"><div style="font-size:13px">' + esc(t.name) + '</div>' +
    '<div style="font-size:11.5px;color:var(--dim)">' + esc(t.desc || tplCond(t.filter)) + '</div></div>' +
    '<button class="ghost" data-apply="' + esc(t.id) + '">应用</button>' +
    (team ? '<button class="icon-btn" data-tpldel="' + esc(t.id) + '">×</button>' : '') + '</div>';
}

function openTemplates(view) {
  const team = (meta.templates || []).slice();
  const off = (meta.official || []).slice();
  let tab = team.length ? 'team' : 'official';
  const body = () => {
    const list = tab === 'team' ? team : off;
    const html = list.length
      ? list.map((t) => tplRow(t, tab === 'team', view)).join('')
      : '<p style="color:var(--dim);font-size:12.5px;padding:12px 0">还没有团队模板。设置好筛选与字段后，点下方「保存当前视图为团队模板」。</p>';
    return '<div class="pill-tabs" id="tb-tpl-tabs" style="margin-bottom:8px">' +
      '<button data-tt="team" class="' + (tab === 'team' ? 'on' : '') + '">团队模板 ' + team.length + '</button>' +
      '<button data-tt="official" class="' + (tab === 'official' ? 'on' : '') + '">官方模板 ' + off.length + '</button></div>' +
      '<div id="tb-tpl-list">' + html + '</div>' +
      '<p style="color:var(--dim);font-size:11.5px;margin:8px 0 0">使用模板后将覆盖当前视图的原有内容（筛选条件与显示字段）。</p>';
  };
  openModal('<div class="section-title">模板</div><div id="tb-tplbox">' + body() + '</div>' +
    '<div class="row" style="gap:6px;margin-top:12px"><input id="tb-tplname" placeholder="团队模板名称（不超过 50 字）" maxlength="50" style="flex:1;font-size:12.5px" />' +
    '<button class="ghost" id="tb-tplsave">保存当前视图为团队模板</button></div>' +
    '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="ghost" id="tb-tplclose">关闭</button></div>', { wide: true });
  const box = document.getElementById('modal') || document.body;
  const wire = () => {
    box.querySelectorAll('[data-tt]').forEach((b) => b.addEventListener('click', () => { tab = b.getAttribute('data-tt'); box.querySelector('#tb-tplbox').innerHTML = body(); wire(); }));
    box.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-apply');
      const t = (tab === 'team' ? team : off).find((x) => x.id === id);
      if (!t) return;
      try {
        localStorage.setItem('tb_pending_view', JSON.stringify({ filter: Object.assign({ status: 'all', tool: '', review: '', q: '', from: '', to: '' }, t.filter || {}), fields: t.fields || [] }));
      } catch (e) { /* 忽略 */ }
      closeModal();
      location.reload();
    }));
    box.querySelectorAll('[data-tpldel]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api('/api/taskboard/templates/' + b.getAttribute('data-tpldel') + '/delete', { method: 'POST' });
        meta = await api('/api/taskboard/meta');
        team.length = 0; (meta.templates || []).forEach((x) => team.push(x));
        box.querySelector('#tb-tplbox').innerHTML = body(); wire();
      } catch (e) { toast(e.message, 'err'); }
    }));
  };
  wire();
  box.querySelector('#tb-tplclose').addEventListener('click', () => { closeModal(); });
  box.querySelector('#tb-tplsave').addEventListener('click', async () => {
    const name = String((box.querySelector('#tb-tplname') || {}).value || '').trim();
    try {
      await api('/api/taskboard/templates', { method: 'POST', body: { name: name, filter: q, fields: cols } });
      meta = await api('/api/taskboard/meta');
      team.length = 0; (meta.templates || []).forEach((x) => team.push(x));
      tab = 'team';
      toast('模板已保存', 'ok');
      box.querySelector('#tb-tplbox').innerHTML = body(); wire();
    } catch (e) { toast(e.message, 'err'); }
  });
}

function openFields(view) {
  const list = allCols().map((f) => '<label class="row" style="gap:8px;align-items:center;margin:4px 0">' +
    '<input type="checkbox" data-col="' + esc(f.k) + '"' + (cols.indexOf(f.k) >= 0 ? ' checked' : '') + ' style="width:auto" />' +
    '<span style="font-size:12.5px">' + esc(f.label) + (f.custom ? ' <span class="chip" style="font-size:10px">自定义</span>' : '') + '</span>' +
    (f.custom ? '<button class="icon-btn" data-coldel="' + esc(f.k) + '">×</button>' : '') + '</label>').join('');
  openModal('<div class="section-title">显示字段</div><div id="tb-cbox">' + list + '</div>' +
    '<div class="row" style="gap:6px;margin-top:12px"><input id="tb-newname" placeholder="自定义字段名" style="flex:1;font-size:12.5px" />' +
    '<button class="ghost" id="tb-addcol">新增字段</button></div>' +
    '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="ghost" id="tb-cclose">关闭</button></div>');
  const box = document.getElementById('modal') || document.body;
  box.querySelector('#tb-cclose').addEventListener('click', () => { closeModal(); paint(view); });
  box.querySelectorAll('[data-col]').forEach((c) => c.addEventListener('change', () => {
    const k = c.getAttribute('data-col');
    if (c.checked) { if (cols.indexOf(k) < 0) cols.push(k); } else cols = cols.filter((x) => x !== k);
    if (!cols.length) cols = ['title'];
  }));
  box.querySelectorAll('[data-coldel]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/taskboard/fields', { method: 'POST', body: { action: 'remove', name: b.getAttribute('data-coldel') } });
      meta = await api('/api/taskboard/meta');
      cols = cols.filter((x) => allCols().some((f) => f.k === x));
      closeModal(); openFields(view);
    } catch (e) { toast(e.message, 'err'); }
  }));
  box.querySelector('#tb-addcol').addEventListener('click', async () => {
    const el = box.querySelector('#tb-newname');
    const name = String((el && el.value) || '').trim();
    try {
      await api('/api/taskboard/fields', { method: 'POST', body: { action: 'add', name: name } });
      meta = await api('/api/taskboard/meta');
      if (name && cols.indexOf(name) < 0) cols.push(name);
      closeModal(); openFields(view);
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function openTaskDrawer(tid, view) {
  const d = await api('/api/taskboard/' + tid);
  let h = null;
  h = openReview({
    title: d.task.title || '未命名任务',
    subtitle: [d.task.tool, statusLabel(d.task.status)].filter(Boolean).join(' · '),
    version: 0,
    files: d.files,
    comments: d.comments,
    reviewStatus: d.task.review || '',
    canvasId: null,
    canvases: [],
    canUpload: false,
    onComment: async (text) => (await api('/api/taskboard/' + tid + '/comment', { method: 'POST', body: { text } })).comments,
    onAction: async (action) => {
      let note = '';
      if (action === 'fail') { const s = window.prompt('驳回原因（可留空）', ''); if (s === null) throw new Error('已取消'); note = s; }
      const result = action === 'submit' ? 'pending' : action;
      const rr = await api('/api/taskboard/' + tid + '/review', { method: 'POST', body: { result, note } });
      await reload(view);
      return { review: { status: result } };
    }
  });
  void h;
}

export async function render() {
  // 已存视图切换会 location.reload()，用 localStorage 携带一次筛选状态
  try {
    const raw = localStorage.getItem('tb_pending_view');
    if (raw) {
      localStorage.removeItem('tb_pending_view');
      const v = JSON.parse(raw);
      q = Object.assign({ status: 'all', tool: '', review: '', q: '', from: '', to: '', sort: 'createdAt', dir: 'desc' }, v.filter || {});
      if (Array.isArray(v.fields) && v.fields.length) cols = v.fields.slice();
    }
  } catch (e) { /* 忽略损坏的视图状态 */ }
  meta = await api('/api/taskboard/meta');
  cols = cols.filter((k) => allCols().some((f) => f.k === k));
  if (!cols.length) cols = DEF_COLS.slice();
  await load();
  return [head(), tabs(), filterBar(), '<div id="tb-box">' + table() + '</div>'].join('');
}

export async function mount(view) {
  bindRows(view);
  view.querySelector('#tb-refresh').addEventListener('click', () => reload(view));
  view.querySelector('#tb-export').addEventListener('click', () => window.open('/api/taskboard/export?' + qs(), '_blank'));
  view.querySelector('#tb-cols').addEventListener('click', () => openFields(view));
  view.querySelector('#tb-tpllib').addEventListener('click', () => openTemplates(view));
  view.querySelector('#tb-reset').addEventListener('click', () => {
    q = { status: 'all', tool: '', review: '', q: '', from: '', to: '', sort: 'createdAt', dir: 'desc' };
    location.reload();
  });
  view.querySelector('#tb-saveview').addEventListener('click', () => {
    openModal('<label class="field">视图名称<input id="tb-vname" placeholder="例如：本周失败任务" maxlength="50" /></label>' +
      '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="ghost" id="tb-vcancel">取消</button><button class="primary" id="tb-vok">保存</button></div>');
    const box = document.getElementById('modal') || document.body;
    box.querySelector('#tb-vcancel').addEventListener('click', closeModal);
    box.querySelector('#tb-vok').addEventListener('click', async () => {
      try {
        await api('/api/taskboard/views', { method: 'POST', body: { name: box.querySelector('#tb-vname').value, filter: q, fields: cols } });
        closeModal(); toast('视图已保存', 'ok'); location.reload();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
  view.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => {
    q.status = b.getAttribute('data-st');
    view.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x === b));
    await reload(view);
  }));
  const bind = (id, key, ev) => { const el = view.querySelector(id); if (el) el.addEventListener(ev, async () => { q[key] = el.value; await reload(view); }); };
  bind('#tb-tool', 'tool', 'change');
  bind('#tb-review', 'review', 'change');
  bind('#tb-from', 'from', 'change');
  bind('#tb-to', 'to', 'change');
  const qEl = view.querySelector('#tb-q');
  if (qEl) { let t = 0; qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { q.q = qEl.value; await reload(view); }, 300); }); }
  view.querySelectorAll('[data-view]').forEach((c) => c.addEventListener('click', () => {
    const v = (meta.views || []).find((x) => x.id === c.getAttribute('data-view'));
    if (!v) return;
    try { localStorage.setItem('tb_pending_view', JSON.stringify({ filter: v.filter || {}, fields: v.fields || [] })); } catch (e) { /* 忽略 */ }
    location.reload();
  }));
  view.querySelectorAll('[data-vdel]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await api('/api/taskboard/views/' + b.getAttribute('data-vdel') + '/delete', { method: 'POST' }); location.reload(); }
    catch (err) { toast(err.message, 'err'); }
  }));
}
