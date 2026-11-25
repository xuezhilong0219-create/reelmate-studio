
import { api, esc, toast, openModal, closeModal, fmtTime, fmtDur, pollTask, statusLabel } from '../lib.js';

let cur = null;

export async function render(params) {
  const d = await api('/api/projects/' + params.projectId);
  cur = d;
  const p = d.project;
  const eps = d.episodes || [];
  return [
    '<div class="page-head">',
    '  <div><h1>' + esc(p.title) + '</h1><p>' + esc(p.logline || p.idea || '') + '</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="ghost" id="extract-assets">AI 智能提取资产</button>',
    '  <button class="ghost" id="edit-pj">编辑信息</button>',
    '  <button class="primary" id="add-ep">新增剧集</button>',
    '</div>',
    '<div class="row" style="margin-bottom:14px">',
    '<div class="card" style="flex:1"><div style="font-size:11.5px;color:var(--dim)">题材</div><div>' + esc(p.genre || '—') + '</div></div>',
    '<div class="card" style="flex:1"><div style="font-size:11.5px;color:var(--dim)">形态</div><div>' + esc(p.kind) + '</div></div>',
    '<div class="card" style="flex:1"><div style="font-size:11.5px;color:var(--dim)">剧集</div><div>' + eps.length + '</div></div>',
    '<div class="card" style="flex:1"><div style="font-size:11.5px;color:var(--dim)">调色板</div><div>' + esc(p.palette || '—') + '</div></div>',
    '</div>',
    '<div class="section-title">剧集</div>',
    eps.length ? '<div class="grid g2">' + eps.map(epCard).join('') + '</div>'
      : '<div class="empty">还没有剧集，点「新增剧集」开始</div>',
    '<div id="ep-detail" style="margin-top:20px"></div>',
  ].join('');
}

function epCard(e) {
  return '<div class="card hover" data-ep="' + e.id + '" style="cursor:pointer">' +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
    '<span class="chip">第 ' + e.no + ' 集</span><span class="chip">' + esc(e.status || 'draft') + '</span>' +
    (e.videoRel ? '<span class="chip ok">已合成</span>' : '') + '</div>' +
    '<h3>' + esc(e.title) + '</h3>' +
    '<p>' + esc(e.logline || e.hook || '—') + '</p></div>';
}

export async function mount(view, params) {
  const p = cur.project;

  view.querySelector('#edit-pj').addEventListener('click', () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">编辑项目</h3>',
      '<label class="field">项目名<input id="t" type="text" value="' + esc(p.title) + '" /></label>',
      '<label class="field" style="margin-top:10px">一句话故事<textarea id="l" rows="2">' + esc(p.logline || '') + '</textarea></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ghost" id="c">取消</button><button class="primary" id="k">保存</button></div>',
    ].join(''));
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      await api('/api/projects/' + p.id, { method: 'POST', body: { title: m.querySelector('#t').value, logline: m.querySelector('#l').value } });
      closeModal(); location.reload();
    });
  });

  view.querySelector('#extract-assets').addEventListener('click', () => openExtract(p.id));

  view.querySelector('#add-ep').addEventListener('click', async () => {
    const e = await api('/api/projects/' + p.id + '/episodes', { method: 'POST', body: { title: '第 ' + ((cur.episodes || []).length + 1) + ' 集' } });
    curl(e);
  });

  const sel = view.querySelector('#ep-detail');
  view.querySelectorAll('[data-ep]').forEach((c) => c.addEventListener('click', async () => {
    view.querySelectorAll('[data-ep]').forEach((x) => x.style.borderColor = '');
    c.style.borderColor = '#2f6a92';
    const id = c.getAttribute('data-ep');
    const d = await api('/api/episodes/' + id);
    renderEp(sel, d);
  }));
}

function curl(e) { location.reload(); }

/* ---------- AI 智能提取资产（官方 series_manage.overview.auto_extract） ---------- */
async function openExtract(projectId) {
  let d;
  try { d = await api('/api/projects/' + projectId + '/extract/preview'); }
  catch (e) { return toast(String(e.message || e), 'err'); }

  const block = (title, key, list, empty) => {
    if (!list.length) return '<div style="margin-bottom:14px"><div class="section-title">' + title + ' · 0</div><div style="font-size:12px;color:var(--dim)">' + empty + '</div></div>';
    return [
      '<div style="margin-bottom:14px">',
      '<div class="section-title">' + title + ' · ' + list.length + '</div>',
      '<div style="max-height:170px;overflow:auto;border:1px solid var(--line);border-radius:8px">',
      list.map((x, i) =>
        '<label style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-bottom:1px solid #161e29;font-size:12.5px;cursor:pointer">' +
        '<input type="checkbox" checked data-cat="' + key + '" data-i="' + i + '" style="margin-top:3px" />' +
        '<span style="flex:1"><b>' + esc(x.name) + '</b>' +
        (x.desc ? '<span style="color:var(--dim)"> · ' + esc(x.desc) + '</span>' : '') +
        '<div style="color:var(--dim);font-size:11.5px;margin-top:2px">' + esc((x.prompt || '').slice(0, 90)) + '</div></span></label>').join(''),
      '</div></div>'
    ].join('');
  };

  const m = openModal([
    '<h3 style="margin:0 0 4px">AI 智能提取资产</h3>',
    '<p style="color:var(--muted);font-size:12.5px;margin:0 0 14px">从剧本与分镜里拆出角色 / 场景 / 道具，逐张生成参考图并写入资产库（去勾选不需要的）</p>',
    block('角色', 'character', d.characters, '剧本里没有写角色，或还没关联剧本'),
    block('场景', 'scene', d.scenes, '还没有场景描述'),
    block('道具', 'prop', d.props, '还没有识别到道具'),
    '<div id="ex-progress" style="margin-top:6px"></div>',
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">',
    '  <button class="ghost" id="ex-cancel">取消</button>',
    '  <button class="primary" id="ex-run">开始提取</button>',
    '</div>'
  ].join(''), { wide: true });

  m.querySelector('#ex-cancel').addEventListener('click', closeModal);
  m.querySelector('#ex-run').addEventListener('click', async () => {
    const picks = [...m.querySelectorAll('input[data-cat]')].filter((x) => x.checked);
    if (!picks.length) return toast('至少勾选一项', 'err');
    const want = { character: false, scene: false, prop: false };
    picks.forEach((x) => { want[x.getAttribute('data-cat')] = true; });
    want.limit = picks.length;
    const box = m.querySelector('#ex-progress');
    box.innerHTML = '<div class="progress"><i style="width:4%"></i></div><div style="font-size:11.5px;color:var(--muted);margin-top:6px">提交中…</div>';
    try {
      const task = await api('/api/projects/' + projectId + '/extract', { method: 'POST', body: want });
      if (task.created === 0) { box.innerHTML = '<div style="font-size:12px;color:var(--muted)">' + esc(task.message || '无需提取') + '</div>'; return; }
      pollTask(task.id, (t) => {
        box.innerHTML = '<div class="progress"><i style="width:' + (t.progress || 0) + '%"></i></div>' +
          '<div style="font-size:11.5px;color:var(--muted);margin-top:6px">' + esc(t.step || '') + ' · ' + (t.progress || 0) + '%</div>';
        if (t.status === 'done') {
          const made = (t.result && t.result.created) || 0;
          box.innerHTML = '<div style="font-size:12px;color:var(--ok,#30a46c)">已生成 ' + made + ' 个资产，正在刷新…</div>';
          setTimeout(() => { closeModal(); location.reload(); }, 700);
        }
        if (t.status === 'failed') box.innerHTML = '<div style="color:#fda4b4;font-size:12px">失败：' + esc(t.error || '') + '</div>';
      });
    } catch (e) {
      box.innerHTML = '<div style="color:#fda4b4;font-size:12px">' + esc(String(e.message || e)) + '</div>';
    }
  });
}

export let layout = 'landscape';
export function setLayout(v) { layout = v === 'portrait' ? 'portrait' : 'landscape'; }

/* 剧本拆分镜 → 匹配本集资产 → 拆解分镜脚本（官方 home.tutorial step4–6） */
function openSplit(ep, done) {
  const m = openModal('<div id="sp-body"><div class="empty" style="padding:20px">加载中…</div></div>', { wide: true });
  const box = m.querySelector('#sp-body');
  let step = 1;
  let plan = null;
  let cast = null;
  const stepper = (n) => '<div class="wk-steps" style="margin-bottom:14px">' +
    [['1', '剧本拆分镜'], ['2', '匹配本集资产'], ['3', '拆解分镜脚本']].map(([k, t], i) =>
      '<div class="wk-step' + (step >= i + 1 ? ' on' : '') + '">' + (step > i + 1 ? '✓' : k) + ' ' + t + '</div>').join('') + '</div>';

  async function paintStep1() {
    const d = await api('/api/episodes/' + ep.id + '/split/preview');
    plan = d.shots;
    box.innerHTML = stepper() + [
      '<div class="wk-sub" style="margin-bottom:10px">AI 已把本集剧本拆成 ' + d.count + ' 条分镜（原文字数 ' + d.chars + '）</div>',
      '<table class="tbl"><thead><tr><th>镜号</th><th>景别</th><th>运镜</th><th>场景</th><th>画面</th></tr></thead><tbody>',
      plan.map((s) => '<tr><td>' + s.no + '</td><td>' + esc(s.size) + '</td><td>' + esc(s.motion) + '</td><td>' + esc(s.place || '—') + '</td><td class="wk-sub">' + esc(s.caption) + '</td></tr>').join(''),
      '</tbody></table>',
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="ghost" id="sp-cancel">取消</button><button class="primary" id="sp-next1">下一步，匹配本集资产</button></div>'
    ].join('');
    box.querySelector('#sp-cancel').addEventListener('click', closeModal);
    box.querySelector('#sp-next1').addEventListener('click', async () => {
      await api('/api/episodes/' + ep.id + '/split', { method: 'POST', body: { shots: plan, replace: true } });
      step = 2;
      await paintStep2();
    });
  }

  async function paintStep2() {
    const d = await api('/api/episodes/' + ep.id + '/cast');
    cast = d;
    const sect = (title, list, cat) => {
      if (!list.length) return '<div class="wk-sub" style="margin:6px 0">' + title + '：暂无</div>';
      return '<div class="section-title" style="margin-top:12px">' + title + ' · ' + list.length + '</div><div class="grid g4" style="gap:8px">' +
        list.map((x, i) => {
          const on = d.selected.includes(cat + '|' + x.name) || (d.selected.length === 0 && x.matched);
          return '<label class="card" style="padding:8px;display:flex;gap:8px;align-items:center;cursor:pointer">' +
            '<input type="checkbox" data-cast="' + cat + '|' + i + '" style="width:auto"' + (on ? ' checked' : '') + ' />' +
            (x.rel ? '<img src="' + esc(x.rel) + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px" />' : '<span style="width:40px;height:40px;display:grid;place-items:center;background:#182432;border-radius:6px;font-size:11px;color:var(--dim)">无图</span>') +
            '<span><b style="font-size:12.5px">' + esc(x.name) + '</b><br><span class="wk-sub">' + (x.matched ? '本集出现' : '未提及') + '</span></span></label>';
        }).join('') + '</div>';
    };
    box.innerHTML = stepper() + '<div class="wk-sub" style="margin-bottom:6px">确认本集应出镜的角色 / 场景 / 道具，AI 会据此生成提示词</div>' +
      sect('角色', d.characters, 'character') + sect('场景', d.scenes, 'scene') + sect('道具', d.props, 'prop') +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="ghost" id="sp-prev">上一步</button><button class="primary" id="sp-next2">下一步，拆解分镜脚本</button></div>';
    box.querySelector('#sp-prev').addEventListener('click', () => { step = 1; paintStep1(); });
    box.querySelector('#sp-next2').addEventListener('click', async () => {
      const items = [];
      box.querySelectorAll('[data-cast]').forEach((i) => {
        if (!i.checked) return;
        const [cat, idx] = i.getAttribute('data-cast').split('|');
        const src = cat === 'character' ? cast.characters : cat === 'scene' ? cast.scenes : cast.props;
        const x = src[Number(idx)];
        if (x) items.push({ cat, name: x.name, assetId: x.assetId, rel: x.rel });
      });
      await api('/api/episodes/' + ep.id + '/cast', { method: 'POST', body: { items } });
      step = 3;
      await paintStep3(items.length);
    });
  }

  async function paintStep3(n) {
    box.innerHTML = stepper() + '<div class="wk-sub">已确认 ' + n + ' 个出镜主体。AI 将为每条分镜生成提示词。</div>' +
      '<div class="card" style="margin-top:12px"><div id="sp-log" style="font-size:12.5px;color:var(--muted)">准备中…</div></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="ghost" id="sp-prev">上一步</button><button class="primary" id="sp-run">拆解分镜脚本</button></div>';
    box.querySelector('#sp-prev').addEventListener('click', () => { step = 2; paintStep2(); });
    box.querySelector('#sp-run').addEventListener('click', async () => {
      const log = box.querySelector('#sp-log');
      log.textContent = '正在生成分镜规划与提示词…';
      try {
        const r = await api('/api/episodes/' + ep.id + '/breakdown', { method: 'POST', body: {} });
        log.innerHTML = '已生成 ' + r.count + ' 条分镜提示词。<br><span class="wk-sub">示例：' + esc(r.sample || '') + '</span>';
        toast('分镜脚本已拆解', 'ok');
        setTimeout(() => { closeModal(); if (done) done(); }, 700);
      } catch (e) { log.textContent = e.message; }
    });
  }

  paintStep1().catch((e) => { box.innerHTML = '<div class="empty" style="padding:20px">' + esc(e.message) + '</div>'; });
}

async function renderEp(sel, d) {
  const ep = d.episode;
  const boards = d.storyboards || [];
  sel.innerHTML = [
    '<div class="card">',
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">',
    '<h3 style="margin:0">第 ' + ep.no + ' 集 · ' + esc(ep.title) + '</h3>',
    '<span style="margin-left:auto"></span>',
    '<button class="ghost tiny" data-layout="landscape">' + (layout === 'landscape' ? '▤ ' : '') + '横向</button>',
    '<button class="ghost tiny" data-layout="portrait">' + (layout === 'portrait' ? '▥ ' : '') + '竖向</button>',
    '<button class="ghost tiny" id="split-shot">AI 拆分镜</button>',
    '<button class="ghost tiny" id="add-sb">+ 分镜</button>',
    '<button class="ghost tiny" id="gen-all">生成全部分镜</button>',
    '<button class="primary tiny" id="gen-video">合成整集</button>',
    '</div>',
    '<div class="' + (layout === 'portrait' ? 'sb-grid' : 'timeline') + '" id="tl">' + boards.map((b, i) => tlItem(b, i)).join('') + '</div>',
    '<div id="sb-editor"></div>',
    '<div id="ep-progress" style="margin-top:10px"></div>',
    '</div>',
  ].join('');

  const tl = sel.querySelector('#tl');
  const editor = sel.querySelector('#sb-editor');
  const prog = sel.querySelector('#ep-progress');

  sel.querySelectorAll('[data-layout]').forEach((btn) => btn.addEventListener('click', () => {
    layout = btn.getAttribute('data-layout');
    renderEp(sel, d);
  }));

  tl.querySelectorAll('[data-sb]').forEach((n) => n.addEventListener('click', () => {
    const b = boards.find((x) => x.id === n.getAttribute('data-sb'));
    if (b) editBoard(editor, b, () => api('/api/episodes/' + ep.id).then((x) => renderEp(sel, x)));
  }));


  const splitBtn = sel.querySelector('#split-shot');
  if (splitBtn) splitBtn.addEventListener('click', () => openSplit(ep, () => api('/api/episodes/' + ep.id).then((x) => renderEp(sel, x))));

  sel.querySelector('#add-sb').addEventListener('click', async () => {
    await api('/api/episodes/' + ep.id + '/storyboards', { method: 'POST', body: { prompt: '新分镜', duration: 3 } });
    const x = await api('/api/episodes/' + ep.id);
    renderEp(sel, x);
  });

  sel.querySelector('#gen-all').addEventListener('click', async () => {
    if (!boards.length) return toast('先添加分镜', 'err');
    const ids = boards.map((b) => b.id);
    const task = await api('/api/storyboards/batch-image', { method: 'POST', body: { ids } });
    watch(task.id, prog, async () => { const x = await api('/api/episodes/' + ep.id); renderEp(sel, x); });
  });

  sel.querySelector('#gen-video').addEventListener('click', async () => {
    if (!boards.length) return toast('先添加分镜', 'err');
    const ids = boards.map((b) => b.id);
    const task = await api('/api/storyboards/batch-video', { method: 'POST', body: { ids } });
    watch(task.id, prog, async () => {
      const x = await api('/api/episodes/' + ep.id);
      renderEp(sel, x);
      toast('整集合成完成', 'ok');
    });
  });
}

function watch(id, box, onDone) {
  box.innerHTML = '<div class="progress"><i style="width:5%"></i></div><div style="font-size:11.5px;color:var(--muted);margin-top:6px">提交中…</div>';
  pollTask(id, (t) => {
    box.innerHTML = '<div class="progress"><i style="width:' + (t.progress || 0) + '%"></i></div>' +
      '<div style="font-size:11.5px;color:var(--muted);margin-top:6px">' + esc(t.step || statusLabel(t.status)) + ' · ' + (t.progress || 0) + '%</div>';
    if (t.status === 'done') onDone();
    if (t.status === 'failed') box.innerHTML = '<div style="color:#fda4b4;font-size:12px">失败：' + esc(t.error || '') + '</div>';
  });
}

function tlItem(b, i) {
  const th = b.imageRel ? '<img src="' + esc(b.imageRel) + '" />' : '<span>' + (i + 1) + '</span>';
  return '<div class="tl-item" data-sb="' + b.id + '" style="cursor:pointer">' +
    '<div class="th">' + th + '</div>' +
    '<div class="bd"><b>#' + b.no + '</b> ' + esc(b.size || '') + '<br>' + esc((b.caption || b.prompt || '').slice(0, 34)) + '</div></div>';
}

function editBoard(editor, b, reload) {
  editor.innerHTML = [
    '<div class="panel" style="margin-top:12px">',
    '<h3>分镜 #' + b.no + '</h3>',
    '<label class="field">画面提示词<textarea id="bp" rows="2">' + esc(b.prompt || '') + '</textarea></label>',
    '<label class="field">字幕 / 旁白<input id="bc" type="text" value="' + esc(b.caption || '') + '" /></label>',
    '<label class="field">对白<textarea id="bd" rows="2">' + esc(b.dialog || '') + '</textarea></label>',
    '<div class="row">',
    '<label class="field">景别<select id="bs">' + ['远景', '全景', '中景', '近景', '特写'].map((s) => '<option' + (s === b.size ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>',
    '<label class="field">运镜<select id="bm">' + [['zoom-in', '推近'], ['zoom-out', '拉远'], ['pan-left', '左摇'], ['pan-right', '右摇'], ['tilt-up', '上摇'], ['tilt-down', '下摇'], ['handheld', '手持'], ['static', '静止']].map((s) => '<option value="' + s[0] + '"' + (s[0] === b.motion ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label>',
    '<label class="field">时长<input id="bdur" type="number" value="' + (b.duration || 3) + '" min="1" max="15" /></label>',
    '</div>',
    '<div style="display:flex;gap:8px"><button class="primary tiny" id="save">保存</button><button class="ghost tiny" id="del" style="color:#fda4b4">删除</button></div>',
    '</div>',
  ].join('');
  editor.querySelector('#save').addEventListener('click', async () => {
    await api('/api/storyboards/' + b.id, {
      method: 'POST',
      body: { prompt: editor.querySelector('#bp').value, caption: editor.querySelector('#bc').value, dialog: editor.querySelector('#bd').value, size: editor.querySelector('#bs').value, motion: editor.querySelector('#bm').value, duration: Number(editor.querySelector('#bdur').value) }
    });
    toast('已保存', 'ok'); reload();
  });
  editor.querySelector('#del').addEventListener('click', async () => {
    await api('/api/storyboards/' + b.id + '/delete', { method: 'POST' });
    reload();
  });
}
