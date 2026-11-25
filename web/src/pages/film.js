
import { api, esc, toast, openModal, closeModal, fmtTime, fmtBytes, pollTask, uploadFile, pickFile } from '../lib.js';
import { openReview } from '../components/review.js';

/* 影视项目：列表 + 项目壳（项目 / 资产库 / 团队 三 tab；任务 / 资产 / 制作 / 成员 / 统计 五导航）
   对应官方 film.json */

const KINDS = [['film', '电影'], ['series', '剧集'], ['short', '短片'], ['doc', '纪录片']];
const KN = Object.fromEntries(KINDS);
const ST = { todo: '待开始', doing: '进行中', review: '待审核', done: '已完成', failed: '已驳回' };
const ST_COLOR = { todo: 'var(--dim)', doing: '#7dd3fc', review: '#f5c688', done: 'var(--ok,#34d399)', failed: '#f87171' };

let listQ = '';
let shell = 'project';
let nav = 'task';

/* ---------------- 列表 ---------------- */
export async function render(params) {
  if (params && params.filmId) return detailPage(params.filmId);
  const d = await api('/api/film' + (listQ ? '?q=' + encodeURIComponent(listQ) : ''));
  const rows = d.list || [];
  return [
    '<div class="page-head">',
    '  <div><h1>影视项目</h1><p>任务分配、资产管理、制作与统计</p></div>',
    '  <div class="spacer"></div>',
    '  <input id="film-q" type="text" placeholder="搜索项目名称" value="' + esc(listQ) + '" style="width:220px" />',
    '  <button class="primary" id="film-new">新建项目</button>',
    '</div>',
    rows.length ? '<div class="grid g3">' + rows.map(card).join('') + '</div>' : [
      '<div class="wk-drop" style="cursor:default">',
      '  <div style="font-size:34px;opacity:.5">▬</div>',
      '  <div class="wk-drop-t">好故事一定有市场！</div>',
      '  <div class="wk-drop-h">暂无影视项目</div>',
      '  <button class="primary" id="film-new2" style="margin-top:12px">创建项目</button>',
      '</div>'
    ].join(''),
  ].join('');
}

function card(f) {
  const cover = f.cover ? '<img src="' + esc(f.cover) + '" />' : '<div class="film-noimg">▬</div>';
  return '<div class="card film-card" data-open="' + f.id + '">' +
    '<div class="film-cover">' + cover + '<span class="chip">' + esc(KN[f.kind] || f.kind) + '</span></div>' +
    '<div style="padding:11px 13px">' +
    '<div class="film-title">' + esc(f.title) + '</div>' +
    '<div class="wk-sub" style="margin-top:4px">' + esc((f.logline || '暂无一句话企划').slice(0, 40)) + '</div>' +
    '<div class="film-meta"><span>任务 ' + f.tasks + '</span><span>资产 ' + f.assets + '</span><span>成员 ' + f.members + '</span></div>' +
    '</div></div>';
}

/* ---------------- 详情壳 ---------------- */
async function detailPage(id) {
  const d = await api('/api/film/' + id);
  const p = d.project;
  const det = d.detail || {};
  const n = d.nav || {};
  const SHELLS = [['project', '项目'], ['asset', '资产库'], ['team', '团队']];
  const NAVS = [['task', '任务', n.task && n.task.total], ['asset', '资产', n.asset && n.asset.total], ['produce', '制作', n.produce && n.produce.total], ['member', '成员', n.member && n.member.total], ['stats', '统计', null]];
  return [
    '<div class="page-head">',
    '  <div><h1>' + esc(p.title) + '</h1><p>' + esc(KN[p.kind] || p.kind) + ' · ' + esc(p.logline || '暂无一句话企划') + '</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="ghost" id="film-cover">上传封面图</button>',
    '  <button class="ghost" id="film-back">返回列表</button>',
    '</div>',
    '<div class="film-shell"><div class="tabs-line" id="film-shell">' + SHELLS.map(([k, s]) => '<button class="' + (shell === k ? 'on' : '') + '" data-shell="' + k + '">' + s + '</button>').join('') + '</div>',
    '<div class="film-cover-hero">' + (p.cover ? '<img src="' + esc(p.cover) + '" />' : '<div class="film-noimg">▬</div>') + '</div></div>',
    '<div class="film-nav" id="film-nav">' + NAVS.map(([k, s, c]) => '<button class="film-navi ' + (nav === k ? 'on' : '') + '" data-nav="' + k + '">' + s + (c != null ? '<em>' + c + '</em>' : '') + '</button>').join('') + '</div>',
    '<div id="film-body">' + bodyHtml(shell, nav, d) + '</div>'
  ].join('');
}

function bodyHtml(sh, nv, d) {
  const p = d.project;
  const det = d.detail || {};
  if (sh === 'asset') {
    const folders = det.folders || [];
    const assets = det.assets || [];
    return [
      '<div class="section-title">图片视频库</div>',
      '<div style="display:flex;gap:8px;margin-bottom:12px"><button class="ghost" id="film-mkfolder">新建文件夹</button>',
      '<button class="ghost" id="film-import-asset">从资产库导入</button>',
      '<button class="ghost" id="film-upload-asset">上传素材</button></div>',
      folders.length ? '<div class="film-folders">' + folders.map((f) => '<div class="film-folder" data-fdel="' + f.id + '"><b>' + esc(f.name) + '</b><span class="wk-sub">' + assets.filter((a) => a.folderId === f.id).length + ' 项</span><i>×</i></div>').join('') + '</div>' : '',
      assets.length ? '<div class="grid g4" style="margin-top:12px">' + assets.map((a) => '<div class="card" style="padding:0;overflow:hidden">' +
        (a.kind === 'image' ? '<img src="' + esc(a.rel) + '" style="width:100%;height:110px;object-fit:cover" />' : '<div class="film-noimg" style="height:110px">' + (a.kind === 'video' ? '▶' : '▤') + '</div>') +
        '<div style="padding:8px 10px"><div class="wk-name" style="font-size:12.5px">' + esc(a.name) + '</div><div class="wk-sub">' + esc(a.kind) + ' · <span data-adel="' + a.id + '" style="color:#f87171;cursor:pointer">删除</span></div></div></div>').join('') + '</div>'
        : '<div class="empty">该文件夹暂未导入素材</div>'
    ].join('');
  }
  if (sh === 'team') {
    const ms = det.members || [];
    return [
      '<div class="section-title">项目成员</div>',
      '<div style="margin-bottom:12px"><button class="ghost" id="film-addmember">添加成员</button></div>',
      ms.length ? '<table class="tbl"><thead><tr><th>成员</th><th>角色</th><th>加入时间</th><th>操作</th></tr></thead><tbody>' +
        ms.map((m) => '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.role || '成员') + '</td><td>' + esc(fmtTime(m.joinedAt)) + '</td><td><span data-mdel="' + m.id + '" style="color:#f87171;cursor:pointer">移除</span></td></tr>').join('') + '</tbody></table>'
        : '<div class="empty">尚未添加成员，仅影视组成员可使用</div>'
    ].join('');
  }
  /* project shell：按 nav 展示 */
  if (nv === 'task') return taskHtml(det, d);
  if (nv === 'asset') return bodyHtml('asset', 'asset', d);
  if (nv === 'produce') return produceHtml(det);
  if (nv === 'member') return bodyHtml('team', 'team', d);
  return statsHtml(det, d);
}

function taskHtml(det, d) {
  const tasks = det.tasks || [];
  const exports = det.exports || [];
  return [
    '<div class="section-title">任务管理 <span class="wk-sub">共 ' + tasks.length + ' 项，已完成 ' + tasks.filter((t) => t.status === 'done').length + '</span></div>',
    '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">',
    '  <button class="ghost" id="film-addtask">新增任务</button>',
    '  <button class="ghost" id="film-imptask">导入 Excel</button>',
    '  <button class="ghost" id="film-tpltask">使用模板表</button>',
    '  <div style="flex:1"></div>',
    '  <button class="subtle" id="film-ex-result">提交结果下载</button>',
    '  <button class="subtle" id="film-ex-table">任务表下载</button>',
    '</div>',
    tasks.length ? '<div class="card" style="padding:0;overflow:auto"><table class="tbl"><thead><tr><th>任务名称</th><th>镜号</th><th>内容</th><th>负责人</th><th>状态</th><th>截止</th><th>操作</th></tr></thead><tbody>' +
      tasks.map((t) => '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.shot || '—') + '</td><td class="wk-sub">' + esc((t.content || '').slice(0, 30)) + '</td><td>' + esc(t.assignee || '未指派') + '</td>' +
        '<td><select data-tst="' + t.id + '">' + Object.entries(ST).map(([k, v]) => '<option value="' + k + '"' + (t.status === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></td>' +
        '<td>' + esc(t.deadline || '—') + '</td>' +
        '<td><span data-trev="' + t.id + '" style="color:var(--brand);cursor:pointer">审核</span> · <span data-tdel="' + t.id + '" style="color:#f87171;cursor:pointer">删除</span></td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">暂无任务，可导入 Excel 或使用模板表</div>',
    exports.length ? '<div class="section-title" style="margin-top:18px">导出记录</div><table class="tbl"><thead><tr><th>时间</th><th>类型</th><th>文件</th><th>大小</th><th>操作</th></tr></thead><tbody>' +
      exports.map((x) => '<tr><td>' + esc(fmtTime(x.createdAt)) + '</td><td>' + (x.kind === 'result' ? '提交结果打包' : '任务表') + '</td><td>' + esc(x.name) + '</td><td>' + esc(fmtBytes(x.bytes)) + '</td>' +
        '<td><a href="' + esc(x.rel) + '" download style="color:var(--brand)">下载</a></td></tr>').join('') + '</tbody></table>'
      : '<div class="section-title" style="margin-top:18px">导出记录</div><div class="empty">暂无导出记录</div>'
  ].join('');
}

function produceHtml(det) {
  const cs = det.canvases || [];
  return [
    '<div class="section-title">新建制作空间</div>',
    '<div class="grid g2" style="margin-bottom:16px">',
    '<div class="card film-prod" data-prod="canvas"><div style="font-size:22px">◫</div><b>无限画布</b><div class="wk-sub">无限自由画布 + Agent 精细化创作，自定义工作流</div></div>',
    '<div class="card film-prod" data-prod="toolbox"><div style="font-size:22px">▧</div><b>AI 工具箱</b><div class="wk-sub">集成精细化编辑工具，快速完成单点影视加工任务</div></div>',
    '</div>',
    '<div class="section-title">已建画布 <span class="wk-sub">' + cs.length + ' 个</span></div>',
    cs.length ? '<table class="tbl"><thead><tr><th>画布</th><th>创建时间</th><th>操作</th></tr></thead><tbody>' +
      cs.map((c) => '<tr><td>' + esc(c.title) + '</td><td>' + esc(fmtTime(c.createdAt)) + '</td><td><a href="#/canvas" style="color:var(--brand)">打开</a> · <span data-pdel="' + c.id + '" style="color:#f87171;cursor:pointer">删除</span></td></tr>').join('') + '</tbody></table>'
      : '<div class="empty">暂无画布</div>'
  ].join('');
}

function statsHtml(det, d) {
  const s = (d.nav && d.nav.task) || {};
  const bs = s.byStatus || {};
  const byPerson = {};
  const byKind = {};
  for (const t of det.tasks || []) { const k = t.assignee || '未指派'; byPerson[k] = (byPerson[k] || 0) + 1; }
  for (const a of det.assets || []) byKind[a.kind || 'file'] = (byKind[a.kind || 'file'] || 0) + 1;
  const bar = (label, v, max) => '<div class="st-kv"><span>' + esc(label) + '</span><b>' + v + '</b></div>';
  return [
    '<div class="grid g4" style="margin-bottom:16px">',
    '<div class="card"><div style="font-size:24px;font-weight:700">' + (s.total || 0) + '</div><div class="wk-sub">全部任务 · 完成率 ' + (s.rate || 0) + '%</div></div>',
    '<div class="card"><div style="font-size:24px;font-weight:700">' + (bs.done || 0) + '</div><div class="wk-sub">已完成</div></div>',
    '<div class="card"><div style="font-size:24px;font-weight:700">' + ((det.assets || []).length) + '</div><div class="wk-sub">项目资产</div></div>',
    '<div class="card"><div style="font-size:24px;font-weight:700">' + ((det.exports || []).length) + '</div><div class="wk-sub">导出记录</div></div>',
    '</div>',
    '<div class="grid g3" style="gap:14px">',
    '<div class="card"><div class="section-title" style="margin-top:0">任务状态</div>' + Object.entries(ST).map(([k, v]) => bar(v, bs[k] || 0)).join('') + '</div>',
    '<div class="card"><div class="section-title" style="margin-top:0">成员参与</div>' + (Object.keys(byPerson).length ? Object.entries(byPerson).map(([k, v]) => bar(k, v)).join('') : '<div class="empty" style="padding:10px">暂无</div>') + '</div>',
    '<div class="card"><div class="section-title" style="margin-top:0">资产构成</div>' + (Object.keys(byKind).length ? Object.entries(byKind).map(([k, v]) => bar(k, v)).join('') : '<div class="empty" style="padding:10px">暂无</div>') + '</div>',
    '</div>'
  ].join('');
}

/* ---------------- 交互 ---------------- */
async function reload() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

export async function mount(view, params) {
  if (!params || !params.filmId) return mountList(view);
  return mountDetail(view, params.filmId);
}

function mountList(view) {
  const openNew = () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">新建项目</h3>',
      '<label class="field">项目名称<input id="f-t" type="text" /></label>',
      '<label class="field" style="margin-top:10px">一句话企划<textarea id="f-l" rows="2"></textarea></label>',
      '<label class="field" style="margin-top:10px">类型<select id="f-k">' + KINDS.map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('') + '</select></label>',
      '<div class="wk-drop sm" id="f-cover" style="margin-top:12px"><div class="wk-drop-t">上传封面图</div><div class="wk-drop-h">可选</div><input id="f-coverf" type="file" accept="image/*" style="display:none" /></div>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="f-c">取消</button><button class="primary" id="f-ok">创建</button></div>'
    ].join(''));
    let coverFile = null;
    m.querySelector('#f-cover').addEventListener('click', () => m.querySelector('#f-coverf').click());
    m.querySelector('#f-coverf').addEventListener('change', (e) => {
      coverFile = e.target.files[0] || null;
      if (coverFile) m.querySelector('#f-cover').innerHTML = '<div class="wk-drop-t">已选择</div><div class="wk-drop-h">' + esc(coverFile.name) + '</div>';
    });
    m.querySelector('#f-c').addEventListener('click', closeModal);
    m.querySelector('#f-ok').addEventListener('click', async () => {
      const title = m.querySelector('#f-t').value.trim();
      if (!title) return toast('请填写项目名称', 'err');
      try {
        const fd = new FormData();
        fd.append('title', title);
        fd.append('logline', m.querySelector('#f-l').value);
        fd.append('kind', m.querySelector('#f-k').value);
        if (coverFile) fd.append('cover', coverFile);
        const r = await fetch('/api/film', { method: 'POST', body: fd });
        const j = await r.json();
        if (j.code !== 0) throw new Error(j.msg);
        closeModal(); toast('已创建', 'ok'); location.hash = '#/film/' + j.data.id;
      } catch (e) { toast(e.message, 'err'); }
    });
  };
  const b1 = view.querySelector('#film-new'); if (b1) b1.addEventListener('click', openNew);
  const b2 = view.querySelector('#film-new2'); if (b2) b2.addEventListener('click', openNew);
  const q = view.querySelector('#film-q');
  if (q) { let t = null; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { listQ = q.value.trim(); await reload(); }, 320); }); }
  view.querySelectorAll('[data-open]').forEach((c) => c.addEventListener('click', () => { location.hash = '#/film/' + c.dataset.open; }));
}

async function openTaskReview(id, tid) {
  const d = await api('/api/film/' + id + '/task/' + tid + '/review');
  let h = null;
  const reloadDrawer = async () => {
    const nd = await api('/api/film/' + id + '/task/' + tid + '/review');
    if (h) h.refresh({ files: nd.files, comments: nd.comments, reviewStatus: nd.review.status });
    return nd;
  };
  h = openReview({
    title: d.task.name || '未命名任务',
    subtitle: [d.task.shot, d.task.assignee].filter(Boolean).join(' · ') || '未指派',
    version: d.review.version,
    files: d.files,
    comments: d.comments,
    reviewStatus: d.review.status,
    canvasId: d.canvasId,
    canvases: d.canvases,
    canUpload: true,
    onComment: async (text) => (await api('/api/film/' + id + '/task/' + tid + '/comment', { method: 'POST', body: { text } })).comments,
    onAction: async (action) => {
      let note = '';
      if (action === 'fail') { const s = window.prompt('驳回原因（可留空）', ''); if (s === null) throw new Error('已取消'); note = s; }
      const rr = await api('/api/film/' + id + '/task/' + tid + '/review', { method: 'POST', body: { action, note } });
      await reload();
      return rr;
    },
    onUpload: () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true;
      inp.addEventListener('change', async () => {
        if (!inp.files.length) return;
        const fd = new FormData();
        for (const f of inp.files) fd.append('file', f, f.name);
        const res = await fetch('/api/film/' + id + '/task/' + tid + '/file', { method: 'POST', body: fd });
        const j = await res.json();
        if (j.code !== 0) return toast(j.msg, 'err');
        await reloadDrawer();
        toast('已上传 ' + inp.files.length + ' 个素材', 'ok');
      });
      inp.click();
    },
    onEnterCanvas: (cid) => { localStorage.setItem('cv_open', cid); closeModal(); location.hash = '#/canvas'; }
  });
}

function mountDetail(view, id) {
  view.querySelectorAll('[data-shell]').forEach((b) => b.addEventListener('click', async () => { shell = b.dataset.shell; await reload(); }));
  view.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', async () => { nav = b.dataset.nav; await reload(); }));
  const back = view.querySelector('#film-back'); if (back) back.addEventListener('click', () => { location.hash = '#/film'; });
  const cov = view.querySelector('#film-cover');
  if (cov) cov.addEventListener('click', async () => {
    const f = await pickFile('image/*');
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/film/' + id + '/cover', { method: 'POST', body: fd });
    const j = await r.json();
    if (j.code !== 0) return toast(j.msg, 'err');
    toast('封面已更新', 'ok'); await reload();
  });

  /* 资产库 */
  const mkf = view.querySelector('#film-mkfolder');
  if (mkf) mkf.addEventListener('click', async () => {
    const m = openModal('<h3 style="margin:0 0 12px">新建文件夹</h3><label class="field">名称<input id="ff-n" type="text" /></label><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="ff-c">取消</button><button class="primary" id="ff-ok">创建</button></div>');
    m.querySelector('#ff-c').addEventListener('click', closeModal);
    m.querySelector('#ff-ok').addEventListener('click', async () => {
      const name = m.querySelector('#ff-n').value.trim();
      if (!name) return toast('请填写名称', 'err');
      await api('/api/film/' + id + '/folder', { method: 'POST', body: { name } });
      closeModal(); toast('已创建', 'ok'); await reload();
    });
  });
  const impA = view.querySelector('#film-import-asset');
  if (impA) impA.addEventListener('click', async () => {
    const d = await api('/api/assets?limit=120');
    const m = openModal('<h3 style="margin:0 0 12px">从资产库导入</h3><div style="max-height:340px;overflow:auto" id="fa-box">' +
      (d.list || []).map((a) => '<label class="row" style="padding:6px 0;gap:8px"><input type="checkbox" value="' + a.id + '" style="width:auto" /><span>' + esc(a.name) + '</span></label>').join('') +
      '</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="fa-c">取消</button><button class="primary" id="fa-ok">导入</button></div>', { wide: true });
    m.querySelector('#fa-c').addEventListener('click', closeModal);
    m.querySelector('#fa-ok').addEventListener('click', async () => {
      const ids = [...m.querySelectorAll('#fa-box input:checked')].map((i) => i.value);
      if (!ids.length) return toast('请选择素材', 'err');
      const r = await api('/api/film/' + id + '/assets', { method: 'POST', body: { assetIds: ids } });
      closeModal(); toast('已导入 ' + r.added + ' 项', 'ok'); await reload();
    });
  });
  const upA = view.querySelector('#film-upload-asset');
  if (upA) upA.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,video/*';
    inp.addEventListener('change', async () => {
      if (!inp.files.length) return;
      const fd = new FormData();
      for (const f of inp.files) fd.append('files', f);
      const r = await fetch('/api/film/' + id + '/assets', { method: 'POST', body: fd });
      const j = await r.json();
      if (j.code !== 0) return toast(j.msg, 'err');
      toast('已上传 ' + j.data.added + ' 项', 'ok'); await reload();
    });
    inp.click();
  });
  view.querySelectorAll('[data-fdel]').forEach((n) => n.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('确认删除文件夹？')) return;
    await api('/api/film/' + id + '/folder/' + n.dataset.fdel + '/delete', { method: 'POST' });
    toast('已删除', 'ok'); await reload();
  }));
  view.querySelectorAll('[data-adel]').forEach((n) => n.addEventListener('click', async () => {
    await api('/api/film/' + id + '/asset/' + n.dataset.adel + '/delete', { method: 'POST' });
    toast('已删除', 'ok'); await reload();
  }));

  /* 团队 */
  const addM = view.querySelector('#film-addmember');
  if (addM) addM.addEventListener('click', async () => {
    const d = await api('/api/film/' + id);
    const m = openModal('<h3 style="margin:0 0 12px">添加成员</h3><label class="field">成员<select id="fm-s">' +
      (d.members || []).map((x) => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') +
      '</select></label><label class="field" style="margin-top:10px">角色<input id="fm-r" type="text" value="成员" /></label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="fm-c">取消</button><button class="primary" id="fm-ok">添加</button></div>');
    m.querySelector('#fm-c').addEventListener('click', closeModal);
    m.querySelector('#fm-ok').addEventListener('click', async () => {
      await api('/api/film/' + id + '/members', { method: 'POST', body: { id: m.querySelector('#fm-s').value, role: m.querySelector('#fm-r').value } });
      closeModal(); toast('已添加', 'ok'); await reload();
    });
  });
  view.querySelectorAll('[data-mdel]').forEach((n) => n.addEventListener('click', async () => {
    await api('/api/film/' + id + '/member/' + n.dataset.mdel + '/delete', { method: 'POST' });
    toast('已移除', 'ok'); await reload();
  }));

  /* 任务 */
  const addT = view.querySelector('#film-addtask');
  if (addT) addT.addEventListener('click', async () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">新增任务</h3>',
      '<label class="field">任务名称<input id="ft-n" type="text" /></label>',
      '<div class="grid g2" style="gap:10px;margin-top:10px">',
      '<label class="field">镜号<input id="ft-s" type="text" /></label>',
      '<label class="field">负责人<input id="ft-a" type="text" value="本地用户" /></label>',
      '</div>',
      '<label class="field" style="margin-top:10px">制作要求<textarea id="ft-c" rows="2"></textarea></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="ft-x">取消</button><button class="primary" id="ft-ok">创建</button></div>'
    ].join(''));
    m.querySelector('#ft-x').addEventListener('click', closeModal);
    m.querySelector('#ft-ok').addEventListener('click', async () => {
      const name = m.querySelector('#ft-n').value.trim();
      if (!name) return toast('请填写任务名称', 'err');
      await api('/api/film/' + id + '/tasks', { method: 'POST', body: { name, shot: m.querySelector('#ft-s').value, assignee: m.querySelector('#ft-a').value, content: m.querySelector('#ft-c').value } });
      closeModal(); toast('已创建', 'ok'); await reload();
    });
  });
  const impT = view.querySelector('#film-imptask');
  if (impT) impT.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx';
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      const fd = new FormData(); fd.append('file', inp.files[0]);
      const r = await fetch('/api/film/' + id + '/tasks/import', { method: 'POST', body: fd });
      const j = await r.json();
      if (j.code !== 0) return toast(j.msg, 'err');
      toast('已导入 ' + j.data.added + ' 行任务', 'ok'); await reload();
    });
    inp.click();
  });
  const tplT = view.querySelector('#film-tpltask');
  if (tplT) tplT.addEventListener('click', async () => {
    await api('/api/film/' + id + '/tasks', { method: 'POST', body: { rows: [
      { name: '概念设计', shot: 'S01', content: '主视觉概念图 2 张', assignee: '本地用户', status: 'todo' },
      { name: '分镜绘制', shot: 'S02', content: '按剧本拆 12 格分镜', assignee: '', status: 'todo' },
      { name: '场景建模', shot: 'S03', content: '主场景三视图', assignee: '', status: 'todo' },
      { name: '成片剪辑', shot: 'S04', content: '粗剪 + 精剪', assignee: '', status: 'todo' }
    ] } });
    toast('模板表已套用', 'ok'); await reload();
  });
  view.querySelectorAll('[data-tst]').forEach((s) => s.addEventListener('change', async () => {
    await api('/api/film/' + id + '/task/' + s.dataset.tst, { method: 'POST', body: { status: s.value } });
    toast('状态已更新', 'ok'); await reload();
  }));
  view.querySelectorAll('[data-trev]').forEach((n) => n.addEventListener('click', () => openTaskReview(id, n.dataset.trev)));
  view.querySelectorAll('[data-tdel]').forEach((n) => n.addEventListener('click', async () => {
    if (!confirm('删除后，该任务不可恢复，确认删除？')) return;
    await api('/api/film/' + id + '/task/' + n.dataset.tdel + '/delete', { method: 'POST' });
    toast('已删除', 'ok'); await reload();
  }));

  /* 导出 */
  const exR = view.querySelector('#film-ex-result');
  if (exR) exR.addEventListener('click', async () => {
    try {
      const r = await api('/api/film/' + id + '/export', { method: 'POST', body: { kind: 'result' } });
      toast(r.name, 'ok');
      const a = document.createElement('a'); a.href = r.rel; a.download = r.name; a.click();
      await reload();
    } catch (e) { toast(e.message, 'err'); }
  });
  const exT = view.querySelector('#film-ex-table');
  if (exT) exT.addEventListener('click', async () => {
    try {
      const r = await api('/api/film/' + id + '/export', { method: 'POST', body: { kind: 'table' } });
      toast(r.name, 'ok');
      const a = document.createElement('a'); a.href = r.rel; a.download = r.name; a.click();
      await reload();
    } catch (e) { toast(e.message, 'err'); }
  });

  /* 制作 */
  view.querySelectorAll('[data-prod]').forEach((c) => c.addEventListener('click', async () => {
    if (c.dataset.prod === 'toolbox') { location.hash = '#/tools'; return; }
    const name = prompt('画布名称', '无限画布') || '无限画布';
    const r = await api('/api/film/' + id + '/produce', { method: 'POST', body: { name } });
    toast('已创建画布', 'ok');
    location.hash = '#/canvas';
  }));
  view.querySelectorAll('[data-pdel]').forEach((n) => n.addEventListener('click', async () => {
    await api('/api/film/' + id + '/produce/' + n.dataset.pdel + '/delete', { method: 'POST' });
    toast('已删除', 'ok'); await reload();
  }));
}
