import { state, api, esc, toast, openDrawer, closeDrawer, closeModal, refreshBadge, pollTask, fmtTime } from './lib.js';
import { TOOLS, TOOL_BY_ID } from './tools-spec.js';

import * as home from './pages/home.js';
import * as toolbox from './pages/toolbox.js';
import * as toolPage from './pages/tool.js';
import * as postPage from './pages/post.js';
import * as editorPage from './pages/editor.js';
import * as vpostPage from './pages/vpost.js';
import * as sheetPage from './pages/sheet.js';
import * as dramaPage from './pages/drama-workflow.js';
import * as mcpPage from './pages/mcp.js';
import * as accountPage from './pages/account.js';
import * as assetsPage from './pages/assets.js';
import * as projectsPage from './pages/projects.js';
import * as importPage from './pages/import.js';
import * as projectPage from './pages/project.js';
import * as scriptPage from './pages/script.js';
import * as novelPage from './pages/novel.js';
import * as marketPage from './pages/market.js';
import * as canvasPage from './pages/canvas.js';
import * as directorPage from './pages/director.js';
import * as teamPage from './pages/team.js';
import * as tasksPage from './pages/tasks.js';
import * as settingsPage from './pages/settings.js';
import * as filmPage from './pages/film.js';
import * as adDramaPage from './pages/ad-drama.js';
import * as translatePage from './pages/translate.js';
import * as redrawPage from './pages/redraw.js';
import * as worksPage from './pages/works.js';
import * as partnerPage from './pages/partner.js';
import * as activitiesPage from './pages/activities.js';
import * as knowledgePage from './pages/knowledge.js';
import * as promptsPage from './pages/prompts.js';
import * as tutorialPage from './pages/tutorial.js';

const NAV = [
  { group: '创作' },
  { path: '/', label: '首页', ico: '◆' },
  { path: '/tools', label: '工具箱', ico: '▦', tag: String(TOOLS.length) },
  { path: '/agent', label: '灵感成片', ico: '✧' },
  { path: '/post', label: '图片后期', ico: '▧' },
  { path: '/vpost', label: '视频后期', ico: '▮' },
  { path: '/sheet', label: '素材表', ico: '☰' },
  { path: '/editor', label: '剪辑台', ico: '▬' },
  { group: '剧本与剧集' },
  { path: '/script', label: '剧本创作', ico: '✎' },
  { path: '/novel', label: '小说改编', ico: '❖' },
  { path: '/market', label: '小说市场', ico: '❑' },
  { path: '/projects', label: '剧集项目', ico: '▤' },
  { path: '/import', label: '导入剧本', ico: '⤒' },
  { path: '/film', label: '影视项目', ico: '▬' },
  { path: '/drama', label: '短剧工作流', ico: '⇢' },
  { group: '资产与舞台' },
  { path: '/assets', label: '资产库', ico: '▩' },
  { path: '/canvas', label: '自由画布', ico: '◈' },
  { path: '/workflow', label: '工作流', ico: '⇄' },
  { path: '/director', label: '3D 导演台', ico: '◉' },
  { group: '工作室' },
  { path: '/translate', label: '视频翻译', ico: '文' },
  { path: '/redraw', label: '视频重绘', ico: '✧' },
  { path: '/ad-drama', label: '广告短剧', ico: '▣' },
  { path: '/works', label: '创作者中心', ico: '★' },
  { path: '/partner', label: '合作中心', ico: '◇' },
  { path: '/activities', label: '活动中心', ico: '✦' },
  { group: '知识与团队' },
  { path: '/knowledge', label: '知识库', ico: '▢' },
  { path: '/prompts', label: '提示词库', ico: '≡' },
  { path: '/mcp', label: 'MCP & CLI', ico: '⌘' },
  { path: '/team', label: '团队', ico: '☰' },
  { path: '/tasks', label: '任务中心', ico: '⏱' },
  { path: '/tutorial', label: '教程', ico: '?' },
  { path: '/account', label: '账号中心', ico: '☺' },
  { path: '/settings', label: '设置', ico: '⚙' },
];

const ROUTES = [
  { re: /^\/$/, page: home, title: '首页' },
  { re: /^\/tools$/, page: toolbox, title: '工具箱' },
  { re: /^\/tools\/([^/]+)$/, page: toolPage, title: '工具', keys: ['toolId'] },
  { re: /^\/agent$/, page: toolPage, title: '灵感成片', keys: ['toolId'], fixed: 'agent-to-video' },
  { re: /^\/post$/, page: postPage, title: '图片后期' },
  { re: /^\/vpost$/, page: vpostPage, title: '视频后期' },
  { re: /^\/sheet$/, page: sheetPage, title: '素材表' },
  { re: /^\/editor$/, page: editorPage, title: '剪辑台' },
  { re: /^\/assets$/, page: assetsPage, title: '资产库' },
  { re: /^\/projects$/, page: projectsPage, title: '剧集项目' },
  { re: /^\/projects\/([^/]+)$/, page: projectPage, title: '项目详情', keys: ['projectId'] },
  { re: /^\/import$/, page: importPage, title: '导入剧本' },
  { re: /^\/script$/, page: scriptPage, title: '剧本创作' },
  { re: /^\/novel$/, page: novelPage, title: '小说改编' },
  { re: /^\/market$/, page: marketPage, title: '小说市场' },
  { re: /^\/canvas$/, page: canvasPage, title: '自由画布' },
  { re: /^\/workflow$/, page: canvasPage, title: '工作流', fixed: 'workflow' },
  { re: /^\/director$/, page: directorPage, title: '3D 导演台' },
  { re: /^\/team$/, page: teamPage, title: '团队' },
  { re: /^\/tasks$/, page: tasksPage, title: '任务中心' },
  { re: /^\/settings$/, page: settingsPage, title: '设置' },
  { re: /^\/film$/, page: filmPage, title: '影视项目' },
  { re: /^\/film\/([^/]+)$/, page: filmPage, title: '影视项目', keys: ['filmId'] },
  { re: /^\/drama$/, page: dramaPage, title: '短剧工作流' },
  { re: /^\/ad-drama$/, page: adDramaPage, title: '广告短剧' },
  { re: /^\/translate$/, page: translatePage, title: '视频翻译' },
  { re: /^\/redraw$/, page: redrawPage, title: '视频重绘' },
  { re: /^\/works$/, page: worksPage, title: '创作者中心' },
  { re: /^\/partner$/, page: partnerPage, title: '合作中心' },
  { re: /^\/activities$/, page: activitiesPage, title: '活动中心' },
  { re: /^\/knowledge$/, page: knowledgePage, title: '知识库' },
  { re: /^\/prompts$/, page: promptsPage, title: '提示词库' },
  { re: /^\/tutorial$/, page: tutorialPage, title: '教程' },
  { re: /^\/mcp$/, page: mcpPage, title: 'MCP & CLI' },
  { re: /^\/account$/, page: accountPage, title: '账号中心' },
];

export function go(path) {
  if (location.hash.slice(1) === path) render();
  else location.hash = '#' + path;
}

function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h && h.startsWith('/') ? h.split('?')[0] : '/';
}

function renderNav(path) {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map((n) => {
    if (n.group) return '<div class="nav-group">' + esc(n.group) + '</div>';
    const on = path === n.path || (n.path !== '/' && path.startsWith(n.path));
    return '<a class="nav-item' + (on ? ' active' : '') + '" href="#' + n.path + '">' +
      '<span class="ico">' + esc(n.ico) + '</span><span>' + esc(n.label) + '</span>' +
      (n.tag ? '<span class="tag">' + esc(n.tag) + '</span>' : '') +
    '</a>';
  }).join('');
}

function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = {};
    (r.keys || []).forEach((k, i) => { params[k] = m[i + 1]; });
    if (r.fixed) { params.toolId = r.fixed; params.fixed = r.fixed; }
    return { route: r, params };
  }
  return null;
}

let renderSeq = 0;
async function render() {
  const path = currentPath();
  const hit = matchRoute(path);
  renderNav(path);
  const view = document.getElementById('view');
  const crumbs = document.getElementById('crumbs');
  const seq = ++renderSeq;
  if (!hit) {
    crumbs.innerHTML = '<b>404</b>';
    view.innerHTML = '<div class="empty">页面不存在：' + esc(path) + '</div>';
    return;
  }
  let title = hit.route.title;
  if (hit.params.toolId && TOOL_BY_ID[hit.params.toolId]) title = TOOL_BY_ID[hit.params.toolId].title;
  crumbs.innerHTML = '<span>' + (hit.route.title === '首页' ? '' : esc(hit.route.title === '工具' ? '工具箱' : hit.route.title)) + '</span>' + (title && title !== hit.route.title ? '<span>/</span><b>' + esc(title) + '</b>' : '');
  document.title = title + ' · 剧作工坊';
  try {
    const html = await hit.route.page.render(hit.params);
    if (seq !== renderSeq) return;
    view.innerHTML = html;
    view.scrollTop = 0;
    if (hit.route.page.mount) await hit.route.page.mount(view, hit.params);
  } catch (e) {
    if (seq !== renderSeq) return;
    view.innerHTML = '<div class="empty">加载失败：' + esc(e.message || e) + '</div>';
    console.error(e);
  }
}

/* ---------- 全局动作 ---------- */
async function openTaskDrawer() {
  openDrawer('任务中心', '<div id="task-list"><div class="loading">加载中…</div></div>');
  const box = document.getElementById('task-list');
  const load = async () => {
    try {
      const d = await api('/api/tasks?limit=60');
      if (!d.list.length) { box.innerHTML = '<div class="empty">还没有任务，去工具箱试试</div>'; return; }
      box.innerHTML = d.list.map((t) => taskRow(t)).join('');
      box.querySelectorAll('[data-task-open]').forEach((n) => n.addEventListener('click', () => {
        const t = d.list.find((x) => x.id === n.getAttribute('data-task-open'));
        if (t) showTaskDetail(t);
      }));
    } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  };
  load();
  const timer = setInterval(() => {
    if (!document.getElementById('drawer').classList.contains('on')) return clearInterval(timer);
    load();
  }, 2200);
}

export function taskRow(t) {
  return '<div class="task-row" data-task-open="' + t.id + '" style="cursor:pointer">' +
    '<span class="nm">' + esc(t.title || t.kind) + '</span>' +
    '<span class="st ' + t.status + '">' + statusLabel(t.status) + '</span>' +
    '<span style="color:var(--dim);font-size:11px">' + fmtTime(t.createdAt) + '</span>' +
  '</div>';
}
export function statusLabel(s) {
  return ({ queued: '排队', running: '生成中', done: '完成', failed: '失败', cancelled: '已取消' })[s] || s;
}

export function showTaskDetail(t) {
  const r = t.result || {};
  let preview = '';
  if (r.rel) {
    if (/\.(mp4|webm)$/i.test(r.rel)) preview = '<video src="' + esc(r.rel) + '" controls style="width:100%;border-radius:10px"></video>';
    else if (/\.(mp3|wav|m4a)$/i.test(r.rel)) preview = '<audio src="' + esc(r.rel) + '" controls style="width:100%"></audio>';
    else preview = '<img src="' + esc(r.rel) + '" style="width:100%;border-radius:10px" />';
  }
  const html = [
    '<h3 style="margin:0 0 10px">' + esc(t.title || t.kind) + '</h3>',
    '<div class="kv" style="margin-bottom:12px">',
    '<span>状态</span><div>' + statusLabel(t.status) + '</div>',
    '<span>进度</span><div>' + (t.progress || 0) + '% · ' + esc(t.step || '') + '</div>',
    '<span>创建</span><div>' + fmtTime(t.createdAt) + '</div>',
    '<span>耗时</span><div>' + (t.finishedAt ? Math.round((new Date(t.finishedAt) - new Date(t.createdAt)) / 100) / 10 + 's' : '进行中') + '</div>',
    t.error ? '<span>错误</span><div style="color:#fda4b4">' + esc(t.error) + '</div>' : '',
    '</div>',
    preview,
    '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">',
    '<button class="ghost" data-close>关闭</button>',
    r.assetId ? '<button class="primary" data-goto="/assets">去资产库</button>' : '',
    '</div>'
  ].join('');
  import('./lib.js').then((m) => {
    const modal = m.openModal(html);
    modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => m.closeModal()));
    modal.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { m.closeModal(); go(b.getAttribute('data-goto')); }));
  });
}

async function quickCreate() {
  const html = [
    '<h3 style="margin:0 0 4px">新建创作</h3>',
    '<p style="color:var(--muted);font-size:12.5px;margin:0 0 14px">选一个起点，剩下的交给本地引擎</p>',
    '<div class="grid g3">',
    [['/tools/text-to-video', '🎬', '文生视频'], ['/tools/text-to-image', '🖌️', '文生图'], ['/script', '✎', '剧本创作'], ['/novel', '❖', '小说改编'], ['/agent', '✧', '灵感成片'], ['/canvas', '◈', '自由画布']]
      .map((x) => '<a class="card hover" href="#" data-go="' + x[0] + '" style="text-decoration:none"><div style="font-size:18px">' + x[1] + '</div><div style="margin-top:6px;color:var(--text)">' + x[2] + '</div></a>').join(''),
    '</div>'
  ].join('');
  const m = (await import('./lib.js')).openModal(html);
  m.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); closeModal(); go(a.getAttribute('data-go')); }));
}

function bindGlobal() {
  document.body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.getAttribute('data-action');
    if (a === 'open-tasks') openTaskDrawer();
    else if (a === 'close-drawer') closeDrawer();
    else if (a === 'quick-create') quickCreate();
    else if (a === 'toggle-side') document.getElementById('sidebar').classList.toggle('on');
  });
  document.getElementById('drawer-mask').addEventListener('click', closeDrawer);
  document.getElementById('modal-mask').addEventListener('click', (e) => { if (e.target.id === 'modal-mask') closeModal(); });
  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (a && window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('on');
  });
}

async function boot() {
  bindGlobal();
  try {
    const h = await api('/api/health');
    state.health = h;
    const chip = document.getElementById('engine-chip');
    chip.className = 'chip ' + (h.ffmpeg ? 'ok' : 'warn');
    chip.textContent = '本地引擎 ' + (h.ffmpeg ? '就绪' : '缺少 ffmpeg') + ' · ' + (h.llm ? 'LLM 已接入' : '离线模式') + ' · 无限额度';
  } catch (e) {
    toast('后端未连接：' + e.message, 'err');
  }
  refreshBadge();
  setInterval(refreshBadge, 5000);
  render();
}

boot();
