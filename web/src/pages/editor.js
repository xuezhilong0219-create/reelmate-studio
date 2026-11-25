import { api, esc, toast, pollTask, statusLabel, fmtDur } from '../lib.js';

/* 时间线剪辑台（对应官方 /agent/editor）
   左侧素材面板 + 右侧 V2/V1/A1/A2 四轨时间线；片段支持 起点/入点/出点/变速/音量，
   时间线导出由服务端 ffmpeg 完成（engine/timeline.mjs）。 */

const PPS = 68;          /* 每秒像素 */
const TRACK_H = 56;
const MIN_MS = 1000;

let S = { list: [], tracks: [], materials: [], proj: null, sel: null, play: 0, dirty: false };

const trackKind = (id) => (String(id).startsWith('A') ? 'audio' : 'video');
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function clipDur(c) {
  const sp = Math.max(0.25, Math.min(4, n(c.speed, 1)));
  const len = Math.max(0.2, n(c.out, 0) > n(c.in, 0) ? n(c.out, 0) - n(c.in, 0) : n(c.len, 2));
  return len / sp;
}

function totalDur(p) {
  return (p.clips || []).reduce((m, c) => Math.max(m, n(c.start) + clipDur(c)), 0) || 12;
}

function timelineHtml() {
  const p = S.proj;
  if (!p) return '<div class="empty">选择或新建一个剪剪辑工程</div>';
  const dur = Math.max(20, Math.ceil(totalDur(p) + 2));
  const width = dur * PPS;
  const ruler = [];
  for (let s = 0; s <= dur; s += 1) {
    ruler.push('<i style="left:' + (s * PPS) + 'px" class="' + (s % 5 === 0 ? 'maj' : '') + '">' + (s % 5 === 0 ? s + 's' : '') + '</i>');
  }
  const rows = S.tracks.map((t) => {
    const clips = (p.clips || []).filter((c) => c.track === t.id);
    const blocks = clips.map((c) => {
      const w = Math.max(18, clipDur(c) * PPS);
      const on = S.sel === c.id ? ' on' : '';
      const thumb = c.kind === 'image'
        ? '<i class="th" style="background-image:url(' + esc(c.rel) + ')"></i>'
        : '<i class="th ' + (c.kind === 'audio' ? 'au' : 'vi') + '">' + (c.kind === 'audio' ? '♪' : '▶') + '</i>';
      return '<div class="tl-clip' + on + '" data-clip="' + esc(c.id) + '" style="left:' + (n(c.start) * PPS) + 'px;width:' + w + 'px">' +
        thumb + '<b>' + esc(c.name || '片段') + '</b><s>' + clipDur(c).toFixed(1) + 's</s>' +
      '</div>';
    }).join('');
    return '<div class="tl-track" data-track="' + esc(t.id) + '">' +
      '<div class="tl-label"><b>' + esc(t.id) + '</b><span>' + esc(t.label.replace(t.id + ' ', '')) + '</span></div>' +
      '<div class="tl-lane" style="width:' + width + 'px">' + blocks + '</div>' +
    '</div>';
  }).join('');
  return '<div class="tl-wrap"><div class="tl-ruler" style="width:' + width + 'px">' + ruler.join('') +
      '<u class="play" style="left:' + (S.play * PPS) + 'px"></u></div>' + rows + '</div>';
}

function inspectorHtml() {
  const p = S.proj;
  const c = p && (p.clips || []).find((x) => x.id === S.sel);
  if (!c) return '<div class="empty" style="padding:18px">在时间线上点一个片段来编辑</div>';
  return '<div class="kv" style="grid-template-columns:76px 1fr">' +
    '<span>片段</span><b style="font-weight:600">' + esc(c.name || '') + '</b>' +
    '<span>轨道</span><b style="font-weight:600">' + esc(c.track) + '</b>' +
  '</div>' +
  '<label class="field">轨道<select id="i-track">' + S.tracks.map((t) => '<option value="' + t.id + '"' + (t.id === c.track ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('') + '</select></label>' +
  '<div class="row"><label class="field" style="flex:1">起点 s<input id="i-start" type="number" step="0.1" value="' + n(c.start) + '"></label>' +
  '<label class="field" style="flex:1">入点 s<input id="i-in" type="number" step="0.1" value="' + n(c.in) + '"></label>' +
  '<label class="field" style="flex:1">出点 s<input id="i-out" type="number" step="0.1" value="' + n(c.out) + '"></label></div>' +
  '<div class="row"><label class="field" style="flex:1">变速 0.25–4<input id="i-speed" type="number" step="0.05" value="' + n(c.speed, 1) + '"></label>' +
  '<label class="field" style="flex:1">音量 0–3<input id="i-volume" type="number" step="0.05" value="' + n(c.volume, 1) + '"></label></div>' +
  '<div class="row"><button class="ghost tiny" id="i-split">在播放头分割</button><button class="ghost tiny" id="i-del">删除片段</button></div>';
}

function shelfHtml() {
  const groups = new Map();
  for (const m of S.materials) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push(m);
  }
  return [...groups.entries()].map(([g, rows]) =>
    '<div class="tl-group">' + esc(g) + '</div>' + rows.map((m) =>
      '<div class="tl-mat" data-mat="' + esc(m.id) + '" data-rel="' + esc(m.rel) + '" data-kind="' + esc(m.kind) + '" data-name="' + esc(m.name) + '">' +
        '<i class="' + (m.kind === 'audio' ? 'au' : m.kind === 'image' ? 'im' : 'vi') + '">' + (m.kind === 'audio' ? '♪' : m.kind === 'image' ? '▣' : '▶') + '</i>' +
        '<span>' + esc(m.name) + '</span>' +
      '</div>').join('')).join('');
}

export async function render() {
  const [ed, mats] = await Promise.all([api('/api/editor'), api('/api/editor/materials')]);
  S.tracks = ed.tracks || [];
  S.list = ed.list || [];
  S.materials = mats.list || [];
  if (S.proj && !S.list.some((x) => x.id === S.proj.id)) S.proj = null;

  return '<div class="page-head"><h1>时间线剪辑台</h1>' +
      '<p>多轨剪辑 · 片段裁剪与变速 · 音轨混流 · 一键导出成片</p><div class="spacer"></div>' +
      '<button class="ghost" id="ed-new">新建工程</button>' +
      '<button class="ghost" id="ed-save">保存</button>' +
      '<button class="primary" id="ed-export">导出成片</button>' +
    '</div>' +
    '<div class="studio" style="grid-template-columns:minmax(230px,270px) minmax(0,1fr)">' +
      '<div class="panel" style="gap:8px;max-height:76vh;overflow:auto">' +
        '<h3>工程</h3>' +
        '<select id="ed-pick"><option value="">— 选择工程 —</option>' +
          S.list.map((e) => '<option value="' + esc(e.id) + '"' + (S.proj && e.id === S.proj.id ? ' selected' : '') + '>' + esc(e.title) + ' · ' + e.clips + ' 片段</option>').join('') +
        '</select>' +
        '<h3 style="margin-top:6px">素材</h3>' +
        '<div id="shelf">' + (S.materials.length ? shelfHtml() : '<div class="empty" style="padding:16px">还没有可用素材</div>') + '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
        '<div class="panel" style="gap:10px;padding:10px">' +
          '<div id="tl">' + timelineHtml() + '</div>' +
        '</div>' +
        '<div class="row" style="align-items:flex-start;gap:12px">' +
          '<div class="panel" style="flex:1.1;gap:9px" id="insp">' + inspectorHtml() + '</div>' +
          '<div class="panel" style="flex:1;gap:8px">' +
            '<div class="stage" id="ed-stage" style="min-height:220px"><div class="placeholder">选中片段预览</div></div>' +
            '<div class="stage-bar" id="ed-bar"><span>就绪</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function refresh() {
  const tl = document.getElementById('tl');
  if (tl) tl.innerHTML = timelineHtml();
  const insp = document.getElementById('insp');
  if (insp) insp.innerHTML = inspectorHtml();
  bindTimeline();
  bindInspector();
  preview();
}

function preview() {
  const st = document.getElementById('ed-stage');
  if (!st) return;
  const p = S.proj;
  const c = p && (p.clips || []).find((x) => x.id === S.sel);
  if (!c) { st.innerHTML = '<div class="placeholder">选中片段预览</div>'; return; }
  if (c.kind === 'image') st.innerHTML = '<img src="' + esc(c.rel) + '">';
  else if (c.kind === 'audio') st.innerHTML = '<audio controls style="width:88%" src="' + esc(c.rel) + '"></audio>';
  else st.innerHTML = '<video controls src="' + esc(c.rel) + '"></video>';
}

function touch() {
  S.dirty = true;
  if (!S.proj) return;
  S.proj.updatedAt = Date.now();
}

function save(silent) {
  if (!S.proj) return Promise.resolve();
  return api('/api/editor/' + S.proj.id, {
    method: 'POST',
    body: { title: S.proj.title, width: S.proj.width, height: S.proj.height, fps: S.proj.fps, clips: S.proj.clips }
  }).then((r) => {
    S.dirty = false;
    S.proj = r;
    if (!silent) toast('已保存', 'ok');
  }).catch((e) => toast(e.message, 'err'));
}

function addClip(mat, track) {
  if (!S.proj) return toast('先新建工程', 'err');
  const tk = track || (mat.kind === 'audio' ? 'A1' : 'V1');
  const kind = trackKind(tk);
  if (kind === 'audio' && mat.kind !== 'audio' && mat.kind !== 'video') return toast('该轨只接受音频或视频', 'err');
  const same = (S.proj.clips || []).filter((c) => c.track === tk);
  const start = same.reduce((m, c) => Math.max(m, n(c.start) + clipDur(c)), 0);
  const dur = n(mat.duration, 0) || 3;
  const c = {
    id: 'cl_' + Math.random().toString(36).slice(2, 9),
    track: tk, kind: mat.kind, rel: mat.rel, name: mat.name,
    assetId: mat.id, start: Math.round(start * 100) / 100,
    in: 0, out: kind === 'audio' && mat.kind === 'audio' ? Math.min(dur, 12) : Math.min(dur, 8),
    speed: 1, volume: 1
  };
  S.proj.clips = [...(S.proj.clips || []), c];
  S.sel = c.id;
  touch();
  refresh();
  save(true);
}

function bindTimeline() {
  const tl = document.getElementById('tl');
  if (!tl) return;
  tl.querySelectorAll('[data-clip]').forEach((el) => el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    S.sel = el.getAttribute('data-clip');
    refresh();
  }));
  tl.querySelectorAll('.tl-lane').forEach((lane) => {
    lane.addEventListener('click', (ev) => {
      const rect = lane.getBoundingClientRect();
      S.play = Math.max(0, Math.round(((ev.clientX - rect.left) / PPS) * 20) / 20);
      tl.querySelector('.play').style.left = (S.play * PPS) + 'px';
    });
  });
}

function bindInspector() {
  const p = S.proj;
  const c = p && (p.clips || []).find((x) => x.id === S.sel);
  if (!c) return;
  const g = (id) => document.getElementById(id);
  const apply = () => {
    c.track = g('i-track').value;
    c.start = Math.max(0, n(g('i-start').value));
    c.in = Math.max(0, n(g('i-in').value));
    c.out = Math.max(c.in + 0.2, n(g('i-out').value));
    c.speed = Math.max(0.25, Math.min(4, n(g('i-speed').value, 1)));
    c.volume = Math.max(0, Math.min(3, n(g('i-volume').value, 1)));
    touch();
    save(true);
    refresh();
  };
  ['i-track', 'i-start', 'i-in', 'i-out', 'i-speed', 'i-volume'].forEach((id) => {
    const el = g(id);
    if (el) el.addEventListener('change', apply);
  });
  const split = g('i-split');
  if (split) split.addEventListener('click', () => {
    const cut = S.play;
    if (cut <= n(c.start) + 0.1 || cut >= n(c.start) + clipDur(c) - 0.1) return toast('播放头不在片段内', 'err');
    const off = (cut - n(c.start)) * n(c.speed, 1);
    const right = { ...c, id: 'cl_' + Math.random().toString(36).slice(2, 9), start: cut, in: n(c.in) + off };
    c.out = n(c.in) + off;
    c.volume = n(c.volume, 1);
    S.proj.clips = [...S.proj.clips, right];
    touch(); save(true); refresh();
  });
  const del = g('i-del');
  if (del) del.addEventListener('click', () => {
    S.proj.clips = S.proj.clips.filter((x) => x.id !== c.id);
    S.sel = null;
    touch(); save(true); refresh();
  });
}

export async function mount(view) {
  document.getElementById('ed-new').addEventListener('click', async () => {
    const title = prompt('工程名称', '短片剪辑 ' + new Date().toLocaleDateString('zh-CN'));
    if (title === null) return;
    try {
      const row = await api('/api/editor', { method: 'POST', body: { title: title || '未命名工程' } });
      S.proj = row; S.sel = null; S.list.unshift({ id: row.id, title: row.title, clips: 0 });
      const pick = document.getElementById('ed-pick');
      pick.innerHTML = '<option value="">— 选择工程 —</option>' + S.list.map((e) => '<option value="' + esc(e.id) + '"' + (e.id === row.id ? ' selected' : '') + '>' + esc(e.title) + ' · ' + (e.clips || 0) + ' 片段</option>').join('');
      pick.value = row.id;
      refresh();
      toast('工程已创建', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  document.getElementById('ed-pick').addEventListener('change', async (ev) => {
    const id = ev.target.value;
    if (!id) { S.proj = null; S.sel = null; refresh(); return; }
    try {
      const d = await api('/api/editor/' + id);
      S.proj = d.project; S.tracks = d.tracks || S.tracks; S.sel = null; S.play = 0;
      refresh();
    } catch (e) { toast(e.message, 'err'); }
  });

  document.getElementById('ed-save').addEventListener('click', () => save());

  document.getElementById('ed-export').addEventListener('click', async () => {
    if (!S.proj) return toast('先选择工程', 'err');
    if (!(S.proj.clips || []).length) return toast('时间线上还没有片段', 'err');
    const bar = document.getElementById('ed-bar');
    const btn = document.getElementById('ed-export');
    btn.disabled = true; btn.textContent = '导出中…';
    try {
      await save(true);
      const tk = await api('/api/editor/' + S.proj.id + '/export', { method: 'POST' });
      const tid = tk && (tk.id || (tk.task && tk.task.id));
      if (!tid) throw new Error('任务创建失败');
      pollTask(tid, (t) => {
        const pr = t.progress || 0;
        bar.innerHTML = '<div class="progress" style="flex:1"><i style="width:' + pr + '%"></i></div><span>' + esc(t.step || statusLabel(t.status)) + ' · ' + pr + '%</span>';
        if (t.status === 'done') {
          btn.disabled = false; btn.textContent = '再次导出';
          const r = t.result || {};
          bar.innerHTML = '<span style="color:var(--ok)">导出完成</span><span>' + (r.width || '') + '×' + (r.height || '') + ' · ' + (r.fps || '') + 'fps · ' + fmtDur(r.duration) + '</span>' +
            (r.rel ? '<button class="ghost tiny" id="ex-open">播放</button><a class="ghost tiny" href="' + esc(r.rel) + '" download>下载</a>' : '');
          const st = document.getElementById('ed-stage');
          if (st && r.rel) st.innerHTML = '<video controls autoplay src="' + esc(r.rel) + '"></video>';
          const op = document.getElementById('ex-open');
          if (op && r.rel) op.addEventListener('click', () => window.open(r.rel, '_blank'));
          toast('成片已导出', 'ok');
        }
        if (t.status === 'failed') {
          btn.disabled = false; btn.textContent = '重试导出';
          bar.innerHTML = '<span style="color:var(--err)">导出失败</span><span>' + esc(t.error || '') + '</span>';
          toast('导出失败：' + (t.error || ''), 'err');
        }
      });
    } catch (e) {
      btn.disabled = false; btn.textContent = '导出成片';
      toast(e.message, 'err');
    }
  });

  /* 素材面板点选加入时间线；绑定在页面内元素上，避免 view 复用累积监听 */
  const shelf = document.getElementById('shelf');
  if (shelf) shelf.addEventListener('click', (ev) => {
    const mat = ev.target.closest('[data-mat]');
    if (!mat) return;
    addClip({
      id: mat.getAttribute('data-mat'), kind: mat.getAttribute('data-kind'),
      rel: mat.getAttribute('data-rel'), name: mat.getAttribute('data-name')
    });
  });

  bindTimeline();
  bindInspector();
  preview();
}
