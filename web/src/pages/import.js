
import { api, esc, toast, pollTask } from '../lib.js';

/* 剧本 / 分镜单导入：上传解析 → 预览 → 立即创作（对应官方 workflow_project.*） */

const TABS = [
  ['script', '上传剧本'],
  ['storyboard', '上传分镜单'],
  ['library', '从剧本库选择'],
  ['paste', '粘贴文本']
];
const GENRES = ['都市', '古装', '悬疑', '甜宠', '科幻', '玄幻', '职场', '校园', '家庭', '犯罪'];
const KINDS = ['短剧', '微电影', '广告片', 'MV', '分镜单'];

let tab = 'script';
let parsed = null;   /* {kind:'text'|'rows', text, rows, chars, lines, epsHint, looksScript, looksStoryboard, filename} */
let library = [];

function tabBtn() {
  return '<div class="tabs-line" id="imp-tabs">' + TABS.map((t) =>
    '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>';
}

function dropZone(accept, label, hint) {
  return [
    '<div class="card" id="dz" style="border-style:dashed;text-align:center;padding:34px 20px;cursor:pointer">',
    '  <div style="font-size:26px;margin-bottom:8px">⤒</div>',
    '  <div style="font-weight:600">' + esc(label) + '</div>',
    '  <div style="font-size:12px;color:var(--dim);margin-top:6px">' + esc(hint) + '</div>',
    '  <input id="imp-file" type="file" accept="' + accept + '" style="display:none" />',
    '</div>'
  ].join('');
}

function metaForm(defTitle) {
  return [
    '<div class="row" style="margin-top:12px">',
    '  <label class="field" style="flex:2">项目名<input id="imp-title" type="text" value="' + esc(defTitle || '') + '" /></label>',
    '  <label class="field">题材<select id="imp-genre">' + GENRES.map((g) => '<option>' + g + '</option>').join('') + '</select></label>',
    '  <label class="field">形态<select id="imp-kind">' + KINDS.map((g) => '<option>' + g + '</option>').join('') + '</select></label>',
    '</div>',
    '<label class="field" style="margin-top:8px">一句话故事<textarea id="imp-logline" rows="2" placeholder="可留空"></textarea></label>'
  ].join('');
}

export async function render() {
  if (tab === 'library' && !library.length) {
    try { const d = await api('/api/scripts'); library = d.list || []; } catch (e) { library = []; }
  }
  return [
    '<div class="page-head">',
    '  <div><h1>导入剧本 / 分镜单</h1><p>上传 xls/xlsx/csv/doc/docx/txt/md，或直接粘贴文本，一键建成可创作的剧集项目</p></div>',
    '</div>',
    tabBtn(),
    '<div id="imp-body" style="margin-top:14px"></div>'
  ].join('');
}

function bodyHtml() {
  if (tab === 'script') {
    return [
      dropZone('.txt,.md,.docx,.doc,.csv,.tsv', '点击选择剧本文件', '支持 .txt .md .docx .doc .csv .tsv，自动识别「第 N 集」「内景/外景」「名字：台词」'),
      parsed && parsed.kind === 'text' ? previewText() : '',
    ].join('');
  }
  if (tab === 'storyboard') {
    return [
      dropZone('.xlsx,.xls,.csv,.tsv,.txt,.md,.docx', '点击选择分镜单', '表头含「镜号 / 景别 / 画面描述 / 台词」即按列建分镜，最多 400 条'),
      parsed && parsed.kind === 'rows' ? previewRows() : '',
    ].join('');
  }
  if (tab === 'library') {
    if (!library.length) return '<div class="empty">剧本库里还没有剧本，先去「剧本创作」生成一部</div>';
    return '<div class="grid g3">' + library.map((s) =>
      '<div class="card hover" data-lib="' + s.id + '" style="cursor:pointer">' +
      '<div style="display:flex;gap:6px;margin-bottom:8px"><span class="chip">' + esc(s.genre || '未分类') + '</span>' +
      '<span class="chip">' + ((s.script && s.script.episodes) || []).length + ' 集</span></div>' +
      '<h3>' + esc(s.title) + '</h3><p>' + esc(s.logline || '') + '</p>' +
      '<div style="font-size:11px;color:var(--dim);margin-top:6px">' + ((s.text || '').length) + ' 字</div></div>').join('') + '</div>';
  }
  return [
    '<label class="field">剧本正文<textarea id="imp-text" rows="14" placeholder="第一集 夜班列车  \n\n内景 · 解剖室 · 夜\n林知推开门，手里握着一把伞。\n林知：我信你。">' + esc((parsed && parsed.text) || '') + '</textarea></label>',
    '<div style="font-size:12px;color:var(--dim);margin-top:6px">按「第 N 集」切集，集内按空行切场，一行一句台词（名字：内容）</div>',
    metaForm((parsed && parsed.titleGuess) || ''),
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">',
    '  <button class="ghost" id="imp-fill">预览</button>',
    '  <button class="primary" id="imp-create">立即创作</button>',
    '</div>',
  ].join('');
}

function previewText() {
  return [
    '<div class="card" style="margin-top:12px">',
    '<div class="row" style="gap:10px;margin-bottom:10px">',
    '  <span class="chip ok">' + esc(parsed.filename || '已解析') + '</span>',
    '  <span class="chip">' + parsed.chars + ' 字</span>',
    '  <span class="chip">' + parsed.lines + ' 行</span>',
    '  <span class="chip">约 ' + parsed.epsHint + ' 集</span>',
    parsed.looksScript ? '<span class="chip ok">像剧本</span>' : '<span class="chip warn">未识别到集场标记</span>',
    '</div>',
    '<pre style="max-height:220px;overflow:auto;background:#0c1319;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap">' + esc((parsed.text || '').slice(0, 1600)) + '</pre>',
    metaForm(parsed.titleGuess || ''),
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">',
    '  <button class="ghost" id="imp-reset">重新选择</button>',
    '  <button class="primary" id="imp-create">立即创作</button>',
    '</div></div>'
  ].join('');
}

function previewRows() {
  const rows = parsed.rows || [];
  const head = rows[0] || [];
  const body = rows.slice(1, 21);
  return [
    '<div class="card" style="margin-top:12px">',
    '<div class="row" style="gap:10px;margin-bottom:10px">',
    '  <span class="chip ok">' + esc(parsed.filename || '已解析') + '</span>',
    '  <span class="chip">' + rows.length + ' 行</span>',
    parsed.looksStoryboard ? '<span class="chip ok">像分镜单</span>' : '<span class="chip warn">表头未匹配到镜号/景别</span>',
    '</div>',
    '<div style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    body.map((r) => '<tr>' + head.map((_, i) => '<td>' + esc((r || [])[i] || '') + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>',
    metaForm(parsed.titleGuess || ''),
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">',
    '  <button class="ghost" id="imp-reset">重新选择</button>',
    '  <button class="primary" id="imp-create">立即创作</button>',
    '</div></div>'
  ].join('');
}

async function postDoc(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/ingest/upload', { method: 'POST', body: fd });
  const json = await res.json();
  if (!json || json.code !== 0) throw new Error((json && json.msg) || '解析失败');
  return json.data;
}

export async function mount(view) {
  const box = view.querySelector('#imp-body');
  const paint = () => { box.innerHTML = bodyHtml(); bindBody(); };
  paint();

  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    tab = b.getAttribute('data-tab');
    parsed = null;
    view.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    if (tab === 'library') {
      try { const d = await api('/api/scripts'); library = d.list || []; } catch (e) { library = []; }
    }
    paint();
  }));
}

function bindBody() {
  const box = document.getElementById('imp-body');
  const dz = box.querySelector('#dz');
  const inp = box.querySelector('#imp-file');
  if (dz && inp) {
    dz.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      dz.innerHTML = '<div style="color:var(--muted)">解析中…</div>';
      try {
        const d = await postDoc(f);
        parsed = d;
        parsed.titleGuess = (f.name || '').replace(/\.[^.]+$/, '').slice(0, 40);
        if (tab === 'script' && d.kind === 'rows') tab = 'storyboard';
        if (tab === 'storyboard' && d.kind === 'text') tab = 'script';
        document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-tab') === tab));
        box.innerHTML = bodyHtml();
        bindBody();
      } catch (e) {
        toast(String(e.message || e), 'err');
        box.innerHTML = bodyHtml();
        bindBody();
      }
    });
  }

  const reset = box.querySelector('#imp-reset');
  if (reset) reset.addEventListener('click', () => { parsed = null; box.innerHTML = bodyHtml(); bindBody(); });

  const create = box.querySelector('#imp-create');
  if (create) create.addEventListener('click', async () => {
    const ta0 = box.querySelector('#imp-text');
    const body = {
      title: box.querySelector('#imp-title').value.trim(),
      genre: box.querySelector('#imp-genre').value,
      kind: box.querySelector('#imp-kind').value,
      logline: box.querySelector('#imp-logline').value,
      text: ta0 ? ta0.value : ((parsed && parsed.text) || ''),
      rows: parsed && parsed.kind === 'rows' ? parsed.rows : [],
    };
    if (!body.title) return toast('请填项目名', 'err');
    if (!body.text && !(body.rows || []).length) return toast('没有可用的剧本内容', 'err');
    create.disabled = true;
    create.textContent = '创建中…';
    try {
      const d = await api('/api/ingest/create', { method: 'POST', body });
      toast('已创建：' + d.project.title + ' · ' + d.episodes + ' 集' + (d.storyboards ? ' · ' + d.storyboards + ' 条分镜' : ''), 'ok');
      location.hash = '#/projects/' + d.project.id;
    } catch (e) {
      toast(String(e.message || e), 'err');
      create.disabled = false;
      create.textContent = '立即创作';
    }
  });

  const fill = box.querySelector('#imp-fill');
  if (fill) fill.addEventListener('click', () => {
    const ta = box.querySelector('#imp-text');
    const text = ta ? ta.value : '';
    if (!text.trim()) return toast('先粘贴剧本正文', 'err');
    parsed = { kind: 'text', text, chars: text.length, lines: text.split('\n').filter(Boolean).length, titleGuess: (text.split('\n')[0] || '').slice(0, 40) };
    box.innerHTML = bodyHtml();
    bindBody();
  });

  box.querySelectorAll('[data-lib]').forEach((c) => c.addEventListener('click', async () => {
    const s = library.find((x) => x.id === c.getAttribute('data-lib'));
    if (!s) return;
    parsed = { kind: 'text', text: s.text || '', filename: s.title + ' · 剧本库', chars: (s.text || '').length, lines: (s.text || '').split('\n').filter(Boolean).length, titleGuess: s.title };
    tab = 'paste';
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-tab') === 'paste'));
    box.innerHTML = bodyHtml();
    bindBody();
    const g = box.querySelector('#imp-genre');
    if (g && s.genre) { const i = GENRES.indexOf(s.genre); if (i >= 0) g.selectedIndex = i; }
  }));
}
