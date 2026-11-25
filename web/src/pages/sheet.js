import { api, esc, toast, fmtBytes, mediaUrl, openModal, closeModal } from '../lib.js';

/* 素材表 —— 官方 material_table：角色/场景/道具 + 责任人 + 审阅状态 + 批量指定负责人/改状态/保存主体/删除/下载 ZIP */

const REVIEW = [['not_reviewed', '未审阅'], ['pass', '通过'], ['fail', '不通过']];
const CATS = [['', '全部'], ['character', '角色'], ['scene', '场景'], ['prop', '道具'], ['ip', 'IP 模板']];
const CAT_NAME = { '': '—', character: '角色', scene: '场景', prop: '道具', ip: 'IP 模板' };

let filter = { cat: '', review: '', assignee: '', q: '' };
let picked = new Set();
let rows = [];
let meta = { members: [] };

function reviewChip(v) {
  if (v === 'pass') return '<span class="chip ok">通过</span>';
  if (v === 'fail') return '<span class="chip warn">不通过</span>';
  return '<span class="chip">未审阅</span>';
}

function subjectOf(r) {
  if (r.cat === 'character') return r.role || '—';
  if (r.cat === 'scene') return r.setting || '—';
  if (r.cat === 'prop') return r.implement || '—';
  return [r.role, r.setting, r.implement].filter(Boolean).join(' / ') || '—';
}

function thumbOf(r) {
  if (r.kind === 'image') return '<img src="' + esc(mediaUrl(r.rel)) + '" alt="" />';
  if (r.kind === 'video') return '<img src="' + esc(mediaUrl(r.thumb || r.rel)) + '" alt="" />';
  return '<div class="sheet-ico">' + (r.kind === 'audio' ? '♪' : '▤') + '</div>';
}

function rowHtml(r) {
  const on = picked.has(r.id);
  return '<tr class="sheet-row' + (on ? ' on' : '') + '" data-row="' + r.id + '">' +
    '<td><input type="checkbox" data-pick="' + r.id + '"' + (on ? ' checked' : '') + ' /></td>' +
    '<td><div class="sheet-th">' + thumbOf(r) + '</div></td>' +
    '<td><div class="sheet-name" title="' + esc(r.name) + '">' + esc(r.name) + '</div>' +
      '<div class="sheet-kv">' + esc(CAT_NAME[r.cat] || '—') + ' · ' + esc(r.kind) + '</div></td>' +
    '<td>' + esc(subjectOf(r)) + '</td>' +
    '<td><select data-assignee="' + r.id + '"><option value="">— 未指定 —</option>' +
      (meta.members || []).map((m) => '<option value="' + esc(m.name) + '"' + (m.name === r.assignee ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') +
      (r.assignee && !(meta.members || []).some((m) => m.name === r.assignee) ? '<option value="' + esc(r.assignee) + '" selected>' + esc(r.assignee) + '</option>' : '') +
    '</select></td>' +
    '<td><select data-review="' + r.id + '">' +
      REVIEW.map((v) => '<option value="' + v[0] + '"' + (v[0] === r.review ? ' selected' : '') + '>' + v[1] + '</option>').join('') +
    '</select></td>' +
    '<td><input class="sheet-remark" data-remark="' + r.id + '" type="text" value="' + esc(r.remark || '') + '" placeholder="备注" /></td>' +
    '<td>' + reviewChip(r.review) + '</td>' +
    '</tr>';
}

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>素材表</h1><p>按角色 / 场景 / 道具整理素材，指派责任人、批量审阅、打包下载</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="ghost" id="sheet-refresh">刷新</button>',
    '  <button class="primary" id="sheet-download">批量下载</button>',
    '</div>',
    '<div class="row" id="sheet-kpi" style="margin-bottom:12px"></div>',
    '<div class="sheet-filter">',
    '  <div class="pill-tabs" id="sheet-cats">' + CATS.map((c) => '<button data-cat="' + c[0] + '">' + c[1] + '</button>').join('') + '</div>',
    '  <select id="sheet-review"><option value="">全部审阅状态</option>' + REVIEW.map((v) => '<option value="' + v[0] + '">' + v[1] + '</option>').join('') + '</select>',
    '  <select id="sheet-assignee"><option value="">全部责任人</option></select>',
    '  <input id="sheet-q" type="search" placeholder="搜索素材名" />',
    '</div>',
    '<div class="bulk-bar" id="sheet-bulk" style="display:none">',
    '  <span id="sheet-count">已选 0 项</span>',
    '  <button class="ghost tiny" data-act="assignee">批量指定负责人</button>',
    '  <button class="ghost tiny" data-act="review">批量设置审阅状态</button>',
    '  <button class="ghost tiny" data-act="subject">批量保存主体</button>',
    '  <button class="ghost tiny" data-act="download">打包下载</button>',
    '  <button class="ghost tiny" data-act="delete">批量删除</button>',
    '  <button class="subtle tiny" data-act="clear">取消选择</button>',
    '</div>',
    '<div class="card" id="sheet-box" style="padding:0;overflow:auto"><div class="empty">载入中…</div></div>',
    '<div id="sheet-log" style="margin-top:12px"></div>',
  ].join('');
}

async function load() {
  const qs = new URLSearchParams();
  if (filter.cat) qs.set('cat', filter.cat);
  if (filter.review) qs.set('review', filter.review);
  if (filter.assignee) qs.set('assignee', filter.assignee);
  if (filter.q) qs.set('q', filter.q);
  qs.set('limit', '300');
  const [d, s] = await Promise.all([api('/api/sheet?' + qs.toString()), api('/api/sheet/stats')]);
  rows = d.list || [];
  meta = { members: d.members || [] };
  paintKpi(s);
  const asSel = document.getElementById('sheet-assignee');
  asSel.innerHTML = '<option value="">全部责任人</option>' +
    (meta.members || []).map((m) => '<option value="' + esc(m.name) + '"' + (m.name === filter.assignee ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('');
  paint();
}

function paint() {
  const box = document.getElementById('sheet-box');
  if (!rows.length) { box.innerHTML = '<div class="empty">没有符合条件的素材</div>'; return; }
  box.innerHTML = '<table class="tbl sheet-tbl"><thead><tr>' +
    '<th style="width:36px"><input type="checkbox" id="sheet-all" /></th>' +
    '<th style="width:76px">图片</th><th>名称</th><th>角色 / 场景 / 道具</th>' +
    '<th style="width:130px">责任人</th><th style="width:118px">审阅状态</th><th style="width:170px">备注</th><th style="width:88px">状态</th>' +
    '</tr></thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>';
  const all = document.getElementById('sheet-all');
  if (all) all.checked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  syncBulk();
}

function syncBulk() {
  const bar = document.getElementById('sheet-bulk');
  if (!bar) return;
  bar.style.display = picked.size ? 'flex' : 'none';
  const c = document.getElementById('sheet-count');
  if (c) c.textContent = '已选 ' + picked.size + ' 项';
}

function paintKpi(s) {
  const box = document.getElementById('sheet-kpi');
  if (!box) return;
  const cards = [['全部素材', s.total, '▩'], ['当前筛选', rows.length, '◈'], ['未审阅', s.not_reviewed, '◌'],
    ['通过', s.pass, '✓'], ['不通过', s.fail, '✕'], ['已指派', s.assigned, '☺']];
  box.innerHTML = cards.map((k) => '<div class="card" style="flex:1"><div style="font-size:11.5px;color:var(--dim)">' +
    k[0] + '</div><div style="font-size:20px;font-weight:700">' + k[2] + ' ' + (k[1] || 0) + '</div></div>').join('');
}

async function patchOne(id, body) {
  const r = await api('/api/sheet/' + id, { method: 'POST', body });
  const i = rows.findIndex((x) => x.id === id);
  if (i >= 0) rows[i] = r;
  paint();
  paintKpi(await api('/api/sheet/stats'));
}

async function batch(action, extra) {
  const ids = Array.from(picked);
  if (!ids.length) return toast('请先选择素材', 'warn');
  const r = await api('/api/sheet/batch', { method: 'POST', body: { ids, action, ...(extra || {}) } });
  toast((r.message || ('已处理 ' + r.updated + ' 项')), 'ok');
  await load();
}

export async function mount() {
  document.querySelectorAll('#sheet-cats button').forEach((b) => {
    b.classList.toggle('on', b.dataset.cat === filter.cat);
    b.addEventListener('click', async () => {
      filter.cat = b.dataset.cat;
      document.querySelectorAll('#sheet-cats button').forEach((x) => x.classList.toggle('on', x === b));
      await load();
    });
  });
  document.getElementById('sheet-review').addEventListener('change', async (e) => { filter.review = e.target.value; await load(); });
  document.getElementById('sheet-assignee').addEventListener('change', async (e) => { filter.assignee = e.target.value; await load(); });
  let t = 0;
  document.getElementById('sheet-q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => { filter.q = e.target.value.trim(); await load(); }, 260);
  });
  document.getElementById('sheet-refresh').addEventListener('click', load);

  const box = document.getElementById('sheet-box');

  box.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'sheet-all') {
      if (el.checked) rows.forEach((r) => picked.add(r.id));
      else picked.clear();
      paint();
      return;
    }
    if (el.dataset.pick) {
      if (el.checked) picked.add(el.dataset.pick); else picked.delete(el.dataset.pick);
      const tr = el.closest('tr');
      if (tr) tr.classList.toggle('on', el.checked);
      syncBulk();
      const all = document.getElementById('sheet-all');
      if (all) all.checked = rows.every((r) => picked.has(r.id));
      return;
    }
    if (el.dataset.assignee) { await patchOne(el.dataset.assignee, { assignee: el.value }); return; }
    if (el.dataset.review) { await patchOne(el.dataset.review, { review: el.value }); return; }
  });

  box.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.remark) await patchOne(el.dataset.remark, { remark: el.value });
  });

  document.getElementById('sheet-bulk').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'clear') { picked.clear(); paint(); return; }
    if (act === 'download') { await download(); return; }
    if (act === 'delete') {
      const m = openModal('<h3 style="margin:0 0 10px">批量删除</h3><p style="color:var(--dim)">将删除 ' + picked.size +
        ' 项素材及其文件，不可撤销。</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
        '<button class="ghost" id="c">取消</button><button class="primary" id="k">确认删除</button></div>');
      m.querySelector('#c').addEventListener('click', closeModal);
      m.querySelector('#k').addEventListener('click', async () => {
        closeModal();
        await batch('delete');
        picked.clear();
        paint();
      });
      return;
    }
    if (act === 'assignee') {
      const m = openModal('<h3 style="margin:0 0 10px">批量指定负责人</h3>' +
        '<label class="field">成员<select id="who"><option value="">— 清空 —</option>' +
        (meta.members || []).map((x) => '<option value="' + esc(x.name) + '">' + esc(x.name) + '</option>').join('') +
        '</select></label>' + ((meta.members || []).length ? '' : '<p style="color:var(--dim);font-size:12.5px">团队里还没有成员，请到「团队管理」添加</p>') +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
      m.querySelector('#c').addEventListener('click', closeModal);
      m.querySelector('#k').addEventListener('click', async () => {
        const who = m.querySelector('#who').value;
        closeModal();
        await batch('assignee', { assignee: who });
      });
      return;
    }
    if (act === 'review') {
      const m = openModal('<h3 style="margin:0 0 10px">批量设置审阅状态</h3>' +
        '<label class="field">状态<select id="rv">' + REVIEW.map((v) => '<option value="' + v[0] + '">' + v[1] + '</option>').join('') + '</select></label>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
      m.querySelector('#c').addEventListener('click', closeModal);
      m.querySelector('#k').addEventListener('click', async () => {
        const rv = m.querySelector('#rv').value;
        closeModal();
        await batch('review', { review: rv });
      });
      return;
    }
    if (act === 'subject') await batch('subject');
  });

  document.getElementById('sheet-download').addEventListener('click', download);

  async function download() {
    const ids = Array.from(picked);
    const list = ids.length ? ids : rows.map((r) => r.id);
    if (!list.length) return toast('没有可下载的素材', 'warn');
    const log = document.getElementById('sheet-log');
    log.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><span id="zip-step">正在打包 ' + list.length + ' 个素材…</span><span class="chip warn">进行中</span></div></div>';
    try {
      const r = await api('/api/sheet/download', { method: 'POST', body: { ids: list } });
      log.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><span>下载已开始 · ' + esc(r.name) + '</span>' +
        '<span class="chip ok">' + r.count + ' 个素材 · ' + fmtBytes(r.bytes) + '</span></div></div>' +
        '<p style="margin-top:8px"><a class="chip ok" href="' + esc(r.url) + '" download>点此保存 ZIP</a></p>';
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(r.count + ' 个素材已打包为 ZIP', 'ok');
    } catch (e) {
      log.innerHTML = '<div class="card"><span class="chip warn">打包失败</span> ' + esc(String(e.message || e)) + '</div>';
      toast('打包失败：' + String(e.message || e), 'warn');
    }
  }

  await load();
}
