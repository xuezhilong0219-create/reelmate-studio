
import { api, esc, toast, openModal, closeModal, fmtTime } from '../lib.js';

const TABS = [
  ['all', '全部项目'],
  ['shortFilm', '短剧'],
  ['dramaWorkflow', '短剧工作流'],
  ['canvas', '自由画布'],
  ['script', '剧本'],
  ['newVideoRedraw', '视频重绘'],
  ['newVideoTranslate', '视频翻译'],
  ['newAdDrama', '广告短剧'],
];

let tab = 'all';

export async function render() {
  const d = await api('/api/projects');
  const all = d.list || [];
  const list = all.filter(match);
  return [
    '<div class="page-head">',
    '  <div><h1>剧集项目</h1><p>剧本 → 分镜 → 成片，一条链路跑完</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="ghost" id="go-import">导入剧本 / 分镜单</button>',
    '  <button class="primary" id="new">新建项目</button>',
    '</div>',
    '<div class="tabs-line" id="pj-tabs">' + TABS.map((t) =>
      '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] +
      '<span style="color:var(--dim);margin-left:6px">' + countOf(all, t[0]) + '</span></button>').join('') + '</div>',
    list.length ? '<div class="grid g3">' + list.map(card).join('') + '</div>'
      : '<div class="empty">' + (tab === 'all' ? '还没有项目。可以直接去「剧本创作」生成一部，或点右上角新建' : '这个分类下还没有项目') + '</div>',
  ].join('');
}

function kindOf(p) {
  const k = String(p.kind || '');
  if (k === '短剧工作流' || k === 'dramaWorkflow') return 'dramaWorkflow';
  if (k === '自由画布' || k === 'canvas') return 'canvas';
  if (k === '剧本' || k === 'script') return 'script';
  if (k === '视频重绘' || k === 'redraw' || p.palette === 'redraw') return 'newVideoRedraw';
  if (k === '视频翻译' || k === 'translate') return 'newVideoTranslate';
  if (k === '广告短剧' || k === 'adDrama') return 'newAdDrama';
  if (k === '分镜单' || k === '微电影' || k === '广告片' || k === 'MV') return 'shortFilm';
  return 'shortFilm';
}

function match(p) {
  if (tab === 'all') return true;
  return kindOf(p) === tab;
}

function countOf(all, t) {
  if (t === 'all') return all.length;
  return all.filter((p) => kindOf(p) === t).length;
}

const KIND_NAME = {
  shortFilm: '短剧', dramaWorkflow: '短剧工作流', canvas: '自由画布', script: '剧本',
  newVideoRedraw: '视频重绘', newVideoTranslate: '视频翻译', newAdDrama: '广告短剧',
};

function card(p) {
  return '<div class="card hover" data-pj="' + p.id + '" style="cursor:pointer">' +
    '<div style="display:flex;gap:6px;margin-bottom:8px">' +
    '<span class="chip">' + esc(p.genre || '未分类') + '</span>' +
    '<span class="chip">' + esc(KIND_NAME[kindOf(p)] || p.kind || '短剧') + '</span>' +
    (p.palette ? '<span class="chip">' + esc(p.palette) + '</span>' : '') + '</div>' +
    '<h3>' + esc(p.title) + '</h3>' +
    '<p>' + esc(p.logline || p.idea || '—') + '</p>' +
    '<div style="font-size:11px;color:var(--dim);margin-top:8px">' + fmtTime(p.createdAt) + '</div></div>';
}

export async function mount(view) {
  view.querySelectorAll('[data-pj]').forEach((c) => c.addEventListener('click', () => {
    location.hash = '#/projects/' + c.getAttribute('data-pj');
  }));
  const tabs = view.querySelector('#pj-tabs');
  if (tabs) tabs.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.getAttribute('data-tab');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }));
  view.querySelector('#go-import').addEventListener('click', () => { location.hash = '#/import'; });
  view.querySelector('#new').addEventListener('click', () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">新建项目</h3>',
      '<label class="field">项目名<input id="pt" type="text" placeholder="例如：长夜宫阙" /></label>',
      '<div class="row" style="margin-top:10px">',
      '  <label class="field">题材<select id="pg">' + ['都市', '古装', '悬疑', '甜宠', '科幻', '玄幻', '职场', '校园', '家庭', '犯罪'].map((g) => '<option>' + g + '</option>').join('') + '</select></label>',
      '  <label class="field">形态<select id="pk"><option>短剧</option><option>短剧工作流</option><option>自由画布</option><option>微电影</option><option>广告片</option><option>MV</option><option>视频重绘</option><option>视频翻译</option><option>广告短剧</option></select></label>',
      '</div>',
      '<label class="field" style="margin-top:10px">一句话故事<textarea id="pl" rows="3"></textarea></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">创建</button></div>',
    ].join(''));
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      const title = m.querySelector('#pt').value.trim();
      if (!title) return toast('请填项目名', 'err');
      const p = await api('/api/projects', { method: 'POST', body: { title, genre: m.querySelector('#pg').value, kind: m.querySelector('#pk').value, logline: m.querySelector('#pl').value } });
      closeModal();
      location.hash = '#/projects/' + p.id;
    });
  });
}
