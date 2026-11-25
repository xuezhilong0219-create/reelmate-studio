
import { api, esc, toast, openModal, closeModal, pollTask, pickFile, uploadFile, fmtTime } from '../lib.js';

/* 官方 common.nodeType 的 8 种画布节点 */
const NODE_TYPES = [
  { type: 'text', label: '文本', ico: 'T', color: '#5ec8ff' },
  { type: 'script', label: '分镜', ico: '☰', color: '#f472b6' },
  { type: 'image', label: '图片', ico: '▣', color: '#8b7cff' },
  { type: 'video', label: '视频', ico: '▶', color: '#34d399' },
  { type: 'audio', label: '音频', ico: '♪', color: '#fbbf24' },
  { type: 'clip', label: '合成', ico: '▤', color: '#22d3ee' },
  { type: 'asset', label: '资产', ico: '❖', color: '#a3e635' },
  { type: 'group', label: '分组', ico: '▢', color: '#94a3b8' },
  { type: 'director', label: '3D导演台', ico: '◉', color: '#f59e0b' },
  { type: 'threeDWorld', label: '3D世界', ico: '◎', color: '#60a5fa' },
  { type: 'table', label: '表格', ico: '▦', color: '#c084fc' },
  { type: 'upload', label: '上传', ico: '⤒', color: '#f87171' },
];
const SHOT_SIZES = ['远景', '全景', '中景', '近景', '特写'];
const TABLE_TEMPLATE = '镜号|景别|画面描述|台词\n01|远景|城市天际线，晨雾未散|（环境声）\n02|中景|主角站在天台边缘回头|我早就知道会这样。\n03|近景|眼神特写，瞳孔收缩|\n04|特写|手指扣紧栏杆|（心跳声）';
const WORLD_TURNS = [['2', '720° 全景'], ['1', '360° 全景']];

let mode = 'canvas';
let board = null;
const cache = { assets: [], directors: [] };
let drag = null;
let linkFrom = null;
let selId = null;

export async function render(params) {
  mode = params && params.fixed === 'workflow' ? 'workflow' : 'canvas';
  const d = await api(mode === 'workflow' ? '/api/workflows' : '/api/canvas');
  const list = d.list || [];
  try { const a = await api('/api/assets?limit=120'); cache.assets = a.list || []; } catch (e) { cache.assets = []; }
  try { const dr = await api('/api/director'); cache.directors = dr.list || []; } catch (e) { cache.directors = []; }
  return [
    '<div class="page-head">',
    '  <div><h1>' + (mode === 'workflow' ? '工作流' : '自由画布') + '</h1><p>' +
      (mode === 'workflow' ? '把多个生成能力串成可复跑的生产线：文本 → 图片 → 视频 / 音频' : '在无限画布上铺开节点，任意连线，逐个执行') + '</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="new">' + (mode === 'workflow' ? '新建工作流' : '新建画布') + '</button>',
    '</div>',
    list.length ? '<div class="grid g3">' + list.map(card).join('') + '</div>'
      : '<div class="empty">还没有内容，点右上角新建</div>',
  ].join('');
}

function defaultData(type) {
  const label = (NODE_TYPES.find((t) => t.type === type) || {}).label || '';
  const base = { prompt: '新 ' + label + ' 节点', rel: null };
  if (type === 'script') return { ...base, prompt: '', scene: '室内 · 傍晚', size: '中景', dialog: '' };
  if (type === 'clip') return { ...base, prompt: '', transition: 'dissolve', rel: null };
  if (type === 'asset') return { ...base, prompt: '', assetId: '', rel: null, kind: 'video' };
  if (type === 'group') return { ...base, prompt: '', title: '新分组', color: '#94a3b8', collapsed: false };
  if (type === 'table') return { ...base, prompt: '', title: '分镜表', text: TABLE_TEMPLATE, header: true };
  if (type === 'threeDWorld') return { ...base, prompt: '雪山湖泊 黄昏，镜头环绕', turns: 2, elevation: 0 };
  if (type === 'director') return { ...base, prompt: '', directorId: '', title: '画布导演台' };
  if (type === 'upload') return { ...base, prompt: '', rel: null, fileName: '' };
  return base;
}

function card(c) {
  const n = (c.nodes || []).length;
  const title = c.title || c.name || '未命名';
  return '<div class="card hover" data-cv="' + c.id + '" style="cursor:pointer">' +
    '<div style="display:flex;gap:6px;margin-bottom:8px"><span class="chip">' + n + ' 节点</span>' +
    (c.share && c.share.enabled ? '<span class="chip ok">已分享</span>' : '') +
    (c.runs && c.runs.length ? '<span class="chip">跑过 ' + c.runs.length + ' 次</span>' : '') + '</div>' +
    '<h3>' + esc(title) + '</h3>' +
    '<p>' + (c.updatedAt ? esc(String(c.updatedAt).slice(0, 16).replace('T', ' ')) : '') + '</p></div>';
}

export async function mount(view) {
  view.querySelector('#new').addEventListener('click', async () => {
    const row = mode === 'workflow'
      ? await api('/api/workflows', { method: 'POST', body: { name: '新工作流', nodes: [], edges: [] } })
      : await api('/api/canvas', { method: 'POST', body: { title: '未命名画布', nodes: [], edges: [] } });
    openBoard(row);
  });
  view.querySelectorAll('[data-cv]').forEach((c) => c.addEventListener('click', async () => {
    const id = c.getAttribute('data-cv');
    const row = await api((mode === 'workflow' ? '/api/workflows/' : '/api/canvas/') + id);
    openBoard(row);
  }));
  /* 从审核抽屉「进入画布」跳过来：自动打开指定画布 */
  const auto = localStorage.getItem('cv_open');
  if (auto) {
    localStorage.removeItem('cv_open');
    try {
      const row = await api((mode === 'workflow' ? '/api/workflows/' : '/api/canvas/') + auto);
      if (row && row.id) openBoard(row);
    } catch (e) { toast('画布不存在或已被删除', 'err'); }
  }
}

async function openBoard(row) {
  board = row;
  board.nodes = board.nodes || [];
  board.edges = board.edges || [];
  selId = null; linkFrom = null;
  const m = openModal([
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">',
    '<input id="cv-title" type="text" value="' + esc(row.title || row.name || '') + '" style="flex:1;background:#0d131d;border:1px solid #253143;color:#e8edf7;padding:7px 10px;border-radius:8px;font-size:13px" />',
    (mode === 'workflow' ? '<button class="primary tiny" id="run-all">运行</button>' : ''),
    '<button class="ghost tiny" id="cv-task">任务</button>',
    '<button class="ghost tiny" id="cv-collab">协同</button>',
    '<button class="ghost tiny" id="share">分享</button>',
    '<button class="ghost tiny" id="close">完成</button>',
    '</div>',
    '<div id="cv-tools" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">' +
      NODE_TYPES.map((t) => '<button class="ghost tiny" data-add="' + t.type + '" style="border-color:' + t.color + '55;color:' + t.color + '">+ ' + t.label + '</button>').join('') +
      '<span style="flex:1"></span><span id="cv-hint" style="font-size:11.5px;color:var(--dim);align-self:center"></span></div>',
    '<div style="display:grid;grid-template-columns:1fr 300px;gap:10px" class="cv-split">',
    '  <div id="cv-stage" class="cv-stage"></div>',
    '  <div id="cv-side" class="cv-side"><div class="empty" style="padding:26px 10px;font-size:12px">点选节点后可编辑提示词与出边</div></div>',
    '</div>',
    '<div id="cv-run"></div>',
    '<div style="font-size:11.5px;color:var(--dim);margin-top:8px">拖动节点移动 · 单击选中后在右侧编辑 · 点「→」再点另一个节点可连线 · 双击空白处新建节点</div>',
  ].join(''), { wide: true });

  const stage = m.querySelector('#cv-stage');
  const side = m.querySelector('#cv-side');
  const hint = m.querySelector('#cv-hint');
  const runBox = m.querySelector('#cv-run');
  drawStage(stage);
  paintSide(side);

  function setHint(t) { hint.textContent = t || ''; }
  setHint(mode === 'workflow' ? '按连线顺序执行' : '逐个节点执行');

  stage.addEventListener('dblclick', (e) => {
    if (e.target !== stage) return;
    const r = stage.getBoundingClientRect();
    addNode('image', e.clientX - r.left - 90 + stage.scrollLeft, e.clientY - r.top - 30 + stage.scrollTop);
  });

  m.querySelector('#close').addEventListener('click', async () => { await persist(); closeModal(); });
  m.querySelector('#cv-title').addEventListener('change', async () => {
    const t = m.querySelector('#cv-title').value.trim();
    if (mode === 'workflow') board.name = t; else board.title = t;
    await persist();
  });
  m.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addNode(b.getAttribute('data-add'))));

  const ra = m.querySelector('#run-all');
  if (ra) ra.addEventListener('click', async () => {
    await persistNow();
    ra.disabled = true;
    runBox.innerHTML = '<div class="card" style="margin-top:10px"><div class="progress"><i style="width:6%"></i></div><div id="wf-step" style="font-size:11.5px;color:var(--muted);margin-top:6px">提交中…</div></div>';
    const t = await api('/api/workflows/' + board.id + '/run', { method: 'POST' });
    pollTask(t.id, async (tk) => {
      const bar = runBox.querySelector('.progress i');
      if (bar) bar.style.width = (tk.progress || 0) + '%';
      const st = runBox.querySelector('#wf-step');
      if (st) st.textContent = tk.step || '';
      if (tk.status === 'done') {
        ra.disabled = false;
        renderRun(runBox, tk.result && tk.result.run);
        try {
          const row = await api('/api/workflows/' + board.id);
          board.nodes = row.nodes || board.nodes;
          board.edges = row.edges || board.edges;
          drawStage(stage); paintSide(side);
        } catch (e) { /* 忽略 */ }
        toast('工作流执行完成', 'ok');
      }
      if (tk.status === 'failed') {
        ra.disabled = false;
        runBox.innerHTML = '<div class="card" style="margin-top:10px;color:#fda4b4">' + esc(tk.error || '失败') + '</div>';
      }
    });
  });


  /* ---------- 浮层面板（不覆盖画布弹窗） ---------- */
  function popin(html) {
    // 同页多画布切换时，旧弹层先清掉，避免 #cb-online 之类的 id 被旧节点抢先命中
    document.querySelectorAll('body > div[data-cvpop]').forEach((e) => e.remove());
    const wrap = document.createElement('div');
    wrap.dataset.cvpop = '1';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(6,10,16,.62);display:grid;place-items:center;padding:20px';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(760px,94vw);max-height:86vh;overflow:auto;background:#0d141d;border:1px solid #253143;border-radius:14px;padding:18px;color:#e8edf7';
    box.innerHTML = html;
    wrap.appendChild(box);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    return { wrap, box };
  }

  /* ---------- 任务绑定 / 提交结果版本 ---------- */
  const taskBtn = m.querySelector('#cv-task');
  if (taskBtn) taskBtn.addEventListener('click', async () => {
    await persistNow();
    const d = await api('/api/canvas/' + board.id + '/tasks');
    const bound = d.bound;
    const subs = d.submissions || [];
    const { wrap, box } = popin([
      '<h3 style="margin:0 0 10px">关联任务与提交结果</h3>',
      '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">' + (bound ? ('当前绑定：' + esc(bound.filmTitle) + ' · ' + esc(bound.name)) : '当前未绑定任务') + '</div>',
      '<label class="field">关联任务<select id="ct-sel"><option value="">— 不绑定 —</option>',
      d.list.map((t) => '<option value="' + t.id + '"' + (bound && bound.taskId === t.id ? ' selected' : '') + '>' + esc(t.filmTitle + ' · ' + t.name + (t.shot ? ' · ' + t.shot : '')) + '</option>').join(''),
      '</select></label>',
      '<div style="display:flex;gap:8px;margin-top:12px"><button class="ghost" id="ct-bind">保存绑定</button><button class="primary" id="ct-submit">提交本次结果</button></div>',
      '<div class="section-title" style="margin-top:16px">提交记录</div>',
      subs.length ? '<table class="tbl"><thead><tr><th>版本</th><th>时间</th><th>产出</th><th>关联任务</th></tr></thead><tbody>' +
        subs.slice().reverse().map((s) => '<tr><td>' + esc(s.version) + '</td><td>' + esc(fmtTime(s.at)) + '</td><td>' + (s.outputs || []).length + ' 项</td><td>' + (s.taskId ? esc(s.taskId) : '—') + '</td></tr>').join('') + '</tbody></table>'
        : '<div class="empty" style="padding:10px">还没有提交记录</div>',
      '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="ghost" id="ct-close">关闭</button></div>'
    ].join(''));
    box.querySelector('#ct-close').addEventListener('click', () => wrap.remove());
    box.querySelector('#ct-bind').addEventListener('click', async () => {
      const taskId = box.querySelector('#ct-sel').value;
      const rr = await api('/api/canvas/' + board.id + '/task', { method: 'POST', body: { taskId } });
      board.task = rr.bound;
      toast(rr.bound ? '已绑定 ' + rr.bound.name : '已解除绑定', 'ok');
      wrap.remove();
    });
    box.querySelector('#ct-submit').addEventListener('click', async () => {
      try {
        const rr = await api('/api/canvas/' + board.id + '/submit', { method: 'POST', body: { name: '画布提交' } });
        toast('已提交 ' + rr.version + ' · ' + rr.count + ' 个结果', 'ok');
        if (rr.task) toast('已回写任务「' + rr.task.name + '」', 'ok');
        wrap.remove();
      } catch (e) { toast(e.message, 'err'); }
    });
  });

  /* ---------- 演示与跟随 ---------- */
  let demoOn = false;
  let following = null;
  let lastFollowNode = null;
  let presenceTimer = null;
  const userName = '本地用户';

  function cvHint(t) { const h = m.querySelector('#cv-hint'); if (h) h.textContent = t || ''; }

  function followTo(nid) {
    if (!nid || nid === lastFollowNode) return;
    lastFollowNode = nid;
    const n = board.nodes.find((x) => x.id === nid);
    if (!n) return;
    stage.scrollTo({ left: Math.max(0, (n.x || 0) - 60), top: Math.max(0, (n.y || 0) - 40), behavior: 'smooth' });
    const nodeEl = stage.querySelector('[data-node="' + nid + '"]');
    if (nodeEl) { nodeEl.classList.add('follow-flash'); setTimeout(() => nodeEl.classList.remove('follow-flash'), 1500); }
    cvHint('跟随中 · ' + (following || '') + ' 的节点 ' + nid);
  }

  function onlineHtml(list) {
    if (!list || !list.length) return '暂无其他在线成员';
    return list.map((p) => '<div class="row" style="gap:6px;align-items:center;padding:3px 0">' +
      '<span style="font-size:12px">' + esc(p.user) + '</span>' +
      (p.demo ? '<span class="chip ok" style="font-size:10px">演示中</span>' : '') +
      (p.follow ? '<span class="chip" style="font-size:10px">跟随 ' + esc(p.follow) + '</span>' : '') +
      '<span style="flex:1"></span>' +
      (p.user === userName
        ? '<span class="chip" style="font-size:10px">我</span>'
        : '<button class="ghost tiny" data-follow="' + esc(p.user) + '">' + (following === p.user ? '退出跟随' : '跟随') + '</button>') +
      '</div>').join('');
  }

  function bindFollow() {
    document.querySelectorAll('#cb-online [data-follow]').forEach((b) => {
      if (b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', async () => {
        const u = b.getAttribute('data-follow');
        following = following === u ? null : u;
        lastFollowNode = null;
        if (!following) cvHint('');
        await beat();
      });
    });
  }

  async function beat() {
    try {
      const rr = await api('/api/canvas/' + board.id + '/presence', { method: 'POST', body: { user: userName, demo: demoOn, follow: following, nodeId: selId || null } });
      if (following) {
        const t = (rr.online || []).find((x) => x.user === following);
        if (t && t.nodeId) followTo(t.nodeId);
      }
      const o = document.querySelector('#cb-online');
      if (o) { o.innerHTML = onlineHtml(rr.online || []); bindFollow(); }
    } catch (e) { /* 离线时静默 */ }
  }

  function startPresence() { if (presenceTimer) clearInterval(presenceTimer); beat(); presenceTimer = setInterval(beat, 2000); }
  function stopPresence() { if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null; }

  /* ---------- 多人协同 ---------- */
  const collabBtn = m.querySelector('#cv-collab');
  if (collabBtn) collabBtn.addEventListener('click', async () => {
    const info = await api('/api/canvas/' + board.id);
    const cb = info.collab || { enabled: false, collaborators: [] };
    const { wrap, box } = popin([
      '<h3 style="margin:0 0 10px">多人协同</h3>',
      '<label class="switch"><input type="checkbox" id="cb-on"' + (cb.enabled ? ' checked' : '') + ' /> 开启协同编辑</label>',
      '<div class="section-title" style="margin-top:14px">在线成员</div><div id="cb-online" style="font-size:12px;color:var(--dim)">检测中…</div>',
      '<div style="display:flex;gap:8px;margin-top:10px;align-items:center"><button class="ghost" id="cb-demo">' + (demoOn ? '停止演示' : '开始演示') + '</button>' +
        '<span style="font-size:11.5px;color:var(--dim)">演示时其他人点「跟随」会跟着你的选中节点</span></div>',
      '<div class="section-title" style="margin-top:14px">节点锁</div>',
      '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">选中节点后可锁定，避免他人同时改动</div>',
      '<div style="display:flex;gap:8px"><button class="ghost" id="cb-lock">锁定选中节点</button><button class="ghost" id="cb-unlock">解除锁定</button></div>',
      '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="ghost" id="cb-close">关闭</button></div>'
    ].join(''));
    box.querySelector('#cb-close').addEventListener('click', () => {
      wrap.remove();
      if (!following) stopPresence();
    });
    startPresence();
    box.querySelector('#cb-demo').addEventListener('click', async () => {
      demoOn = !demoOn;
      box.querySelector('#cb-demo').textContent = demoOn ? '停止演示' : '开始演示';
      cvHint(demoOn ? '演示中 · 选中节点后其他人可跟随' : '');
      toast(demoOn ? '已开始演示' : '已停止演示', 'ok');
      await beat();
    });
    box.querySelector('#cb-on').addEventListener('change', async (e) => {
      await api('/api/canvas/' + board.id + '/collab', { method: 'POST', body: { enabled: e.target.checked } });
      toast(e.target.checked ? '协同已开启' : '协同已关闭', 'ok');
    });
    box.querySelector('#cb-lock').addEventListener('click', async () => {
      if (!selId) return toast('请先选择节点', 'err');
      try {
        await api('/api/canvas/' + board.id + '/lock', { method: 'POST', body: { nodeId: selId, on: true } });
        toast('已锁定节点', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    box.querySelector('#cb-unlock').addEventListener('click', async () => {
      if (!selId) return toast('请先选择节点', 'err');
      await api('/api/canvas/' + board.id + '/lock', { method: 'POST', body: { nodeId: selId, on: false } });
      toast('已解除锁定', 'ok');
    });
  });

  m.querySelector('#share').addEventListener('click', async () => {
    const s = await api((mode === 'workflow' ? '/api/workflows/' : '/api/canvas/') + board.id + (mode === 'workflow' ? '' : '/share'), { method: 'POST', body: mode === 'workflow' ? {} : { enabled: true } });
    if (mode === 'workflow') toast('工作流已保存，可直接复制节点配置分享', 'ok');
    else toast('分享链接：' + location.origin + '/?s=' + s.token, 'ok');
  });

  function addNode(type, x, y) {
    const i = board.nodes.length;
    const node = {
      id: 'n_' + Math.random().toString(36).slice(2, 8),
      type,
      x: typeof x === 'number' ? Math.max(0, x) : 24 + (i % 4) * 210,
      y: typeof y === 'number' ? Math.max(0, y) : 24 + Math.floor(i / 4) * 148,
      data: defaultData(type),
      status: 'idle',
    };
    board.nodes.push(node);
    selId = node.id;
    drawStage(stage); paintSide(side); persist();
  }

  function drawStage(el) {
    const edges = board.edges || [];
    const svg = edges.map((e) => {
      const a = board.nodes.find((n) => n.id === (e.from || e.source));
      const b = board.nodes.find((n) => n.id === (e.to || e.target));
      if (!a || !b) return '';
      const x1 = (a.x || 0) + 93, y1 = (a.y || 0) + 74;
      const x2 = (b.x || 0) + 93, y2 = (b.y || 0) + 74;
      const mx = (x1 + x2) / 2;
      return '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" stroke="#3b4a63" stroke-width="1.6" fill="none" marker-end="url(#arw)"/>';
    }).join('');
    const nodes = board.nodes.map((n) => {
      const t = NODE_TYPES.find((x) => x.type === n.type) || NODE_TYPES[0];
      const rel = n.data && n.data.rel;
      const dt = n.data || {};
      let media;
      if (n.type === 'group') {
        media = '<div class="ph" style="border-style:dashed;color:' + esc(dt.color || t.color) + '">▢ ' + esc(dt.title || '分组') + '</div>';
      } else if (n.type === 'script' && !rel) {
        media = '<div class="ph" style="line-height:1.5;font-size:11px;color:#f472b6">' + esc(dt.scene || '场景') + '<br><span style="color:var(--dim)">' + esc(dt.size || '中景') + '</span>' + (dt.dialog ? '<br><span style="color:var(--dim)">' + esc(String(dt.dialog).slice(0, 16)) + '</span>' : '') + '</div>';
      } else if (n.type === 'clip' && !rel) {
        const ups = (board.edges || []).filter((e) => (e.to || e.target) === n.id).length;
        media = '<div class="ph" style="color:#22d3ee">▤ 合成 ' + ups + ' 段</div>';
      } else if (n.type === 'asset' && !rel) {
        media = '<div class="ph" style="color:#a3e635">❖ 未选素材</div>';
      } else if (n.type === 'table' && !rel) {
        const nrow = String(dt.text || '').split('\n').filter((x) => x.trim()).length;
        media = '<div class="ph" style="color:#c084fc">▦ ' + esc(dt.title || '表格') + '<br><span style="color:var(--dim);font-size:11px">' + nrow + ' 行</span></div>';
      } else if (n.type === 'threeDWorld' && !rel) {
        media = '<div class="ph" style="color:#60a5fa">◎ ' + (Number(dt.turns) === 1 ? '360°' : '720°') + ' 全景<br><span style="color:var(--dim);font-size:11px">' + esc(String(dt.prompt || '').slice(0, 14)) + '</span></div>';
      } else if (n.type === 'director' && !rel) {
        media = '<div class="ph" style="color:#f59e0b">◉ ' + esc(dt.directorId || '画布导演台') + '<br><span style="color:var(--dim);font-size:11px">渲染当前机位</span></div>';
      } else if (n.type === 'upload' && !rel) {
        media = '<div class="ph" style="color:#f87171">⤒ 未上传文件</div>';
      } else if (rel) {
        const isVideo = n.type === 'video' || n.type === 'clip' || ((n.type === 'asset' || n.type === 'upload') && dt.kind === 'video');
        const isAudio = n.type === 'audio' || ((n.type === 'asset' || n.type === 'upload') && dt.kind === 'audio');
        media = isVideo
          ? '<video src="' + esc(rel) + '" muted loop autoplay playsinline></video>'
          : isAudio
            ? '<audio src="' + esc(rel) + '" controls style="width:100%"></audio>'
            : '<img src="' + esc(rel) + '"' + (n.type === 'threeDWorld' ? ' style="width:100%;height:100%;object-fit:cover"' : '') + ' />';
      } else {
        media = '<div class="ph">' + esc(t.label) + '</div>';
      }
      return '<div class="cv-node' + (n.status === 'done' ? ' done' : '') + (selId === n.id ? ' sel' : '') + '" data-node="' + n.id + '" style="left:' + (n.x || 0) + 'px;top:' + (n.y || 0) + 'px;border-color:' + (selId === n.id ? t.color : t.color + '44') + '">' +
        '<div class="cv-node-head" style="color:' + t.color + '"><b>' + esc(t.ico) + '</b> ' + esc(t.label) +
        '<span class="sp"></span>' +
        '<span class="cv-link" data-link="' + n.id + '" title="连线到…">→</span>' +
        '<span class="cv-run" data-run="' + n.id + '" title="执行">▶</span>' +
        '<span class="cv-del" data-del="' + n.id + '" title="删除">✕</span></div>' +
        '<div class="cv-node-body">' + media + '</div>' +
        '<div class="cv-node-foot">' + esc((n.type === 'group' ? (dt.title || '分组') : n.type === 'table' ? (dt.title || '表格') : n.type === 'upload' ? (dt.fileName || '上传') : (dt.prompt || '')).slice(0, 22)) + '</div></div>';
    }).join('');
    el.innerHTML = '<svg width="100%" height="100%" style="position:absolute;inset:0;pointer-events:none;min-width:2000px;min-height:1200px">' +
      '<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#3b4a63"/></marker></defs>' + svg + '</svg>' + nodes;
    bindStage(el, stage, side);
  }

  function bindStage(el, stageEl, sideEl) {
    el.querySelectorAll('.cv-node').forEach((nodeEl) => {
      const id = nodeEl.getAttribute('data-node');
      nodeEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-run]') || e.target.closest('[data-del]') || e.target.closest('[data-link]')) return;
        const n = board.nodes.find((x) => x.id === id);
        if (!n) return;
        drag = { id, ox: e.clientX - (n.x || 0), oy: e.clientY - (n.y || 0), moved: false };
        nodeEl.style.zIndex = 99;
      });
      nodeEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-run]') || e.target.closest('[data-del]') || e.target.closest('[data-link]')) return;
        if (linkFrom && linkFrom !== id) {
          const from = linkFrom; linkFrom = null;
          const dup = board.edges.some((x) => (x.from || x.source) === from && (x.to || x.target) === id);
          if (!dup) board.edges.push({ id: 'e_' + Math.random().toString(36).slice(2, 7), from, to: id });
          persist();
        }
        selId = id;
        drawStage(stageEl); paintSide(sideEl);
      });
      nodeEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-run]') || e.target.closest('[data-del]') || e.target.closest('[data-link]')) return;
        selId = id; drawStage(stageEl); paintSide(sideEl);
      });
    });
    el.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      linkFrom = linkFrom === b.getAttribute('data-link') ? null : b.getAttribute('data-link');
      setHint(linkFrom ? '再点一个节点完成连线（点「→」取消）' : (mode === 'workflow' ? '按连线顺序执行' : '逐个节点执行'));
      drawStage(stageEl);
    }));
    el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-run');
      if (mode === 'workflow') return toast('工作流用右上角「运行」');
      b.textContent = '…';
      const t = await api('/api/canvas/' + board.id + '/run-node', { method: 'POST', body: { nodeId: id } });
      pollTask(t.id, async (tk) => {
        if (tk.status === 'done') {
          const row = await api('/api/canvas/' + board.id);
          board.nodes = row.nodes;
          drawStage(stageEl); paintSide(sideEl);
          toast('节点执行完成', 'ok');
        }
        if (tk.status === 'failed') { b.textContent = '▶'; toast(tk.error || '失败', 'err'); }
      });
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-del');
      board.nodes = board.nodes.filter((x) => x.id !== id);
      board.edges = board.edges.filter((x) => (x.from || x.source) !== id && (x.to || x.target) !== id);
      if (selId === id) selId = null;
      drawStage(stageEl); paintSide(sideEl);
      await persist();
    }));
  }

  function paintSide(sideEl) {
    const n = board.nodes.find((x) => x.id === selId);
    if (!n) {
      sideEl.innerHTML = '<div class="empty" style="padding:26px 10px;font-size:12px">点选节点后可编辑提示词与出边</div>';
      return;
    }
    const t = NODE_TYPES.find((x) => x.type === n.type) || NODE_TYPES[0];
    const outs = board.edges.filter((e) => (e.from || e.source) === n.id);
    sideEl.innerHTML = [
      '<div style="padding:4px 2px">',
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span class="chip" style="color:' + t.color + ';border-color:' + t.color + '55">' + esc(t.label) + '节点</span>',
      '<span style="font-size:11px;color:var(--dim)">' + esc(n.id) + '</span></div>',
      n.type === 'group'
        ? '<label class="field">分组名<input id="nd-title" value="' + esc((n.data && n.data.title) || '') + '"></label><label class="field">颜色<input id="nd-color" type="color" value="' + esc((n.data && n.data.color) || '#94a3b8') + '"></label>'
        : n.type === 'table'
          ? '<label class="field">表格标题<input id="nd-title" value="' + esc((n.data && n.data.title) || '') + '"></label>'
            + '<label class="field">表格内容（每行一条，用 | 或逗号分列）<textarea id="nd-text" rows="8" style="font-size:12px">' + esc((n.data && n.data.text) || '') + '</textarea></label>'
            + '<label class="switch"><input id="nd-header" type="checkbox"' + ((n.data && n.data.header) !== false ? ' checked' : '') + '><span>首行为表头</span></label>'
          : '<label class="field">提示词 / 文本<textarea id="nd-p" rows="5" style="font-size:12px">' + esc((n.data && n.data.prompt) || '') + '</textarea></label>',
      n.type === 'script' ? '<label class="field">场景<select id="nd-scene">' + ['室内 · 傍晚', '室内 · 白天', '街道 · 夜', '山野 · 清晨', '天台 · 黄昏', '车站 · 雨夜', '办公室 · 白天', '酒吧 · 夜'].map((s) => '<option value="' + s + '"' + ((n.data && n.data.scene) === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>'
        + '<label class="field">景别<select id="nd-size">' + SHOT_SIZES.map((s) => '<option value="' + s + '"' + ((n.data && n.data.size) === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>'
        + '<label class="field">台词<input id="nd-dialog" value="' + esc((n.data && n.data.dialog) || '') + '"></label>' : '',
      n.type === 'clip' ? '<label class="field">转场<select id="nd-trans">' + ['dissolve', 'fade', 'wipeleft', 'slideup', 'circleopen', 'none'].map((s) => '<option value="' + s + '"' + ((n.data && n.data.transition) === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' : '',
      n.type === 'asset' ? '<label class="field">素材<select id="nd-asset"><option value="">— 选择素材 —</option>' + (cache.assets || []).slice(0, 200).map((a) => '<option value="' + esc(a.id) + '"' + ((n.data && n.data.assetId) === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select></label>' : '',
      n.type === 'image' ? '<label class="field">风格<select id="nd-style">' + ['cinematic', 'anime', 'ink', 'cyber', 'warm', 'noir'].map((s) => '<option value="' + s + '"' + ((n.data && n.data.style) === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' : '',
      n.type === 'video' ? '<label class="field">运镜<select id="nd-motion">' + ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'tilt-up', 'shake'].map((s) => '<option value="' + s + '"' + ((n.data && n.data.motion) === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' : '',
      n.type === 'threeDWorld' ? '<label class="field">全景范围<select id="nd-turns">' + WORLD_TURNS.map(([v, l]) => '<option value="' + v + '"' + (String((n.data && n.data.turns) || 2) === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>'
        + '<label class="field">俯仰角<input id="nd-elev" type="number" min="-30" max="30" step="1" value="' + Number((n.data && n.data.elevation) || 0) + '"></label>' : '',
      n.type === 'director' ? '<label class="field">导演台工程<select id="nd-dir"><option value="">— 用节点内置场景 —</option>' + (cache.directors || []).map((x) => '<option value="' + esc(x.id) + '"' + ((n.data && n.data.directorId) === x.id ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('') + '</select></label>' : '',
      n.type === 'upload' ? '<label class="field">本机文件<input id="nd-file" type="file"></label><div style="font-size:11px;color:var(--dim);margin:-4px 0 8px">选择后立即上传到资产库并挂到本节点</div>' : '',
      '<div class="kv" style="font-size:11.5px;margin:8px 0"><span>出边</span><div>' + (outs.length ? outs.map((e) => esc(e.to || e.target)).join(', ') : '—') + '</div></div>',
      '<div style="display:flex;gap:6px;margin-top:6px"><button class="primary tiny" id="nd-save">保存</button>',
      '<button class="ghost tiny" id="nd-run">执行此节点</button></div>',
      '</div>',
    ].join('');
    sideEl.querySelector('#nd-save').addEventListener('click', async () => {
      n.data = { ...(n.data || {}) };
      const p = sideEl.querySelector('#nd-p'); if (p) n.data.prompt = p.value;
      const st = sideEl.querySelector('#nd-style'); if (st) n.data.style = st.value;
      const mo = sideEl.querySelector('#nd-motion'); if (mo) n.data.motion = mo.value;
      const sc = sideEl.querySelector('#nd-scene'); if (sc) n.data.scene = sc.value;
      const sz = sideEl.querySelector('#nd-size'); if (sz) n.data.size = sz.value;
      const dg = sideEl.querySelector('#nd-dialog'); if (dg) n.data.dialog = dg.value;
      const tr = sideEl.querySelector('#nd-trans'); if (tr) n.data.transition = tr.value;
      const tt = sideEl.querySelector('#nd-title'); if (tt) n.data.title = tt.value;
      const cl = sideEl.querySelector('#nd-color'); if (cl) n.data.color = cl.value;
      const tb = sideEl.querySelector('#nd-text'); if (tb) n.data.text = tb.value;
      const hd = sideEl.querySelector('#nd-header'); if (hd) n.data.header = !!hd.checked;
      const tu = sideEl.querySelector('#nd-turns'); if (tu) n.data.turns = Number(tu.value) || 2;
      const el2 = sideEl.querySelector('#nd-elev'); if (el2) n.data.elevation = Number(el2.value) || 0;
      const dr = sideEl.querySelector('#nd-dir'); if (dr) n.data.directorId = dr.value;
      const as = sideEl.querySelector('#nd-asset');
      if (as) {
        const hit = (cache.assets || []).find((a) => a.id === as.value);
        n.data.assetId = as.value;
        n.data.rel = hit ? hit.rel : null;
        n.data.kind = hit ? hit.kind : 'video';
      }
      await persistNow();
      drawStage(stage); paintSide(side);
      toast('已保存', 'ok');
    });
    const upInput = sideEl.querySelector('#nd-file');
    if (upInput) upInput.addEventListener('change', async () => {
      const f = upInput.files && upInput.files[0];
      if (!f) return;
      upInput.disabled = true;
      try {
        const a = await uploadFile(f);
        n.data = { ...(n.data || {}), rel: a.rel, kind: a.kind || 'image', fileName: a.name || f.name, assetId: a.id };
        await persistNow();
        drawStage(stage); paintSide(side);
        toast('已上传并挂到节点', 'ok');
      } catch (e) {
        toast(e.message || '上传失败', 'err');
        upInput.disabled = false;
      }
    });
    sideEl.querySelector('#nd-run').addEventListener('click', async () => {
      if (mode === 'workflow') return toast('工作流用右上角「运行」');
      const pEl = sideEl.querySelector('#nd-p');
      if (pEl) n.data = { ...(n.data || {}), prompt: pEl.value };
      await persistNow();
      const t = await api('/api/canvas/' + board.id + '/run-node', { method: 'POST', body: { nodeId: n.id } });
      pollTask(t.id, async (tk) => {
        if (tk.status === 'done') {
          const row = await api('/api/canvas/' + board.id);
          board.nodes = row.nodes;
          drawStage(stage); paintSide(side);
        }
        if (tk.status === 'failed') toast(tk.error || '失败', 'err');
      });
    });
  }

  function renderRun(box, run) {
    if (!run) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card" style="margin-top:10px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
      '<span class="chip ok">执行完成</span><span style="font-size:11.5px;color:var(--dim)">' + (run.nodes || []).length + ' 个节点 · ' + ((run.duration || 0) / 1000).toFixed(1) + 's</span></div>' +
      '<div class="grid g4" style="gap:8px">' + (run.nodes || []).map((x) => {
        const o = x.out || {};
        const view = o.rel ? (/\.mp4$/.test(o.rel) ? '<video src="' + esc(o.rel) + '" muted loop autoplay playsinline style="width:100%;border-radius:8px"></video>'
          : /\.mp3$/.test(o.rel) ? '<audio src="' + esc(o.rel) + '" controls style="width:100%"></audio>'
            : '<img src="' + esc(o.rel) + '" style="width:100%;border-radius:8px" />') : '<div class="empty" style="padding:14px;font-size:11px">' + esc(o.text || (x.ok ? '无输出' : (x.error || '失败'))) + '</div>';
        return '<div style="background:#0e141e;border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:11px;color:var(--dim);margin-bottom:6px">' + esc(x.type) + ' · ' + esc(x.id) + (x.ok ? '' : ' ✕') + '</div>' + view + '</div>';
      }).join('') + '</div></div>';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const n = (board && board.nodes || []).find((x) => x.id === drag.id);
    if (!n) return;
    drag.moved = true;
    n.x = Math.max(0, e.clientX - drag.ox);
    n.y = Math.max(0, e.clientY - drag.oy);
    const el = document.querySelector('[data-node="' + drag.id + '"]');
    if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
  });
  window.addEventListener('mouseup', () => { if (drag) { const moved = drag.moved; drag = null; if (moved) persist(); } });
}

let saveTimer = null;
function persist() {
  if (!board) return Promise.resolve();
  clearTimeout(saveTimer);
  return new Promise((resolve) => {
    saveTimer = setTimeout(async () => {
      try {
        if (mode === 'workflow') await api('/api/workflows/' + board.id, { method: 'POST', body: { name: board.name, nodes: board.nodes, edges: board.edges } });
        else await api('/api/canvas/' + board.id, { method: 'POST', body: { title: board.title, nodes: board.nodes, edges: board.edges } });
      } catch (e) { /* 静默 */ }
      resolve();
    }, 400);
  });
}

async function persistNow() {
  if (!board) return;
  clearTimeout(saveTimer);
  if (mode === 'workflow') await api('/api/workflows/' + board.id, { method: 'POST', body: { name: board.name, nodes: board.nodes, edges: board.edges } });
  else await api('/api/canvas/' + board.id, { method: 'POST', body: { title: board.title, nodes: board.nodes, edges: board.edges } });
}