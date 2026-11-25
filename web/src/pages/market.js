
import { api, esc, toast, openModal, closeModal } from '../lib.js';

const S = { cat: '', tag: '', q: '' };

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>小说市场</h1><p>精选书单 · 一键导入书架 → 分析世界观 → 拆集 → 改编剧本</p></div>',
    '</div>',
    '<div class="row" style="gap:10px;margin-bottom:12px;align-items:center">',
    '  <input id="mk-q" type="text" placeholder="搜书名或简介…" style="max-width:280px" />',
    '  <span style="flex:1"></span>',
    '  <span id="mk-count" style="font-size:12px;color:var(--dim)"></span>',
    '</div>',
    '<div class="pill-tabs" id="mk-tabs"><button class="on" data-cat="">全部</button></div>',
    '<div class="row" id="mk-tags" style="gap:6px;margin:10px 0 16px;flex-wrap:wrap"></div>',
    '<div class="grid g3" id="mk-list"><div class="loading">加载中…</div></div>',
  ].join('');
}

function card(b) {
  const cover = b.coverRel
    ? '<div class="asset-thumb" style="margin-bottom:10px"><img src="' + esc(b.coverRel) + '" alt="" loading="lazy" /></div>'
    : '<div class="mk-cover">' + esc(b.genre || '小说') + '</div>';
  return '<div class="card hover" data-book="' + b.id + '">' +
    cover +
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
      '<span class="chip">' + esc(b.genre || '') + '</span>' +
      (b.imported ? '<span class="chip ok">已导入</span>' : '') +
    '</div>' +
    '<h3>' + esc(b.title) + '</h3>' +
    '<p style="min-height:56px">' + esc(b.intro || '') + '</p>' +
    '<div class="kv" style="margin-top:6px">' +
      '<span>分类</span><div>' + esc(b.cat || '—') + '</div>' +
      '<span>体量</span><div>' + (b.chapters || 0) + ' 章 · ' + Math.round((b.words || 0) / 1000) + 'k 字</div>' +
      '<span>热度</span><div>' + (b.heat || 0) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="primary" data-imp="' + b.id + '"' + (b.imported ? ' disabled' : '') + '>' + (b.imported ? '已在书架' : '导入书架') + '</button>' +
      '<button class="ghost" data-peek="' + b.id + '">看简介</button>' +
    '</div></div>';
}

export async function mount(view) {
  const listBox = view.querySelector('#mk-list');
  const tabs = view.querySelector('#mk-tabs');
  const tagBox = view.querySelector('#mk-tags');
  const count = view.querySelector('#mk-count');
  let cache = [];
  let meta = { tags: [], categories: [] };

  async function load() {
    const qs = [];
    if (S.cat) qs.push('cat=' + encodeURIComponent(S.cat));
    if (S.tag) qs.push('tag=' + encodeURIComponent(S.tag));
    if (S.q) qs.push('q=' + encodeURIComponent(S.q));
    const d = await api('/api/novel-market' + (qs.length ? '?' + qs.join('&') : ''));
    cache = d.list || [];
    meta = d;
    count.textContent = cache.length + ' 本';
    listBox.innerHTML = cache.length ? cache.map(card).join('') : '<div class="empty" style="grid-column:1/-1">没有匹配的书目</div>';
    bindList();
  }

  function paintTabs() {
    const cats = ['', ...(meta.categories || [])];
    tabs.innerHTML = cats.map((c) => '<button class="' + (S.cat === c ? 'on' : '') + '" data-cat="' + esc(c) + '">' + esc(c || '全部') + '</button>').join('');
    tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.cat = b.getAttribute('data-cat'); paintTabs(); load(); }));
    tagBox.innerHTML = (meta.tags || []).map((t) => '<span class="chip' + (S.tag === t ? ' ok' : '') + '" data-tag="' + esc(t) + '" style="cursor:pointer">' + esc(t) + '</span>').join('');
    tagBox.querySelectorAll('[data-tag]').forEach((n) => n.addEventListener('click', () => {
      S.tag = S.tag === n.getAttribute('data-tag') ? '' : n.getAttribute('data-tag');
      paintTabs(); load();
    }));
  }

  function bindList() {
    listBox.querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-imp');
      b.disabled = true; b.textContent = '导入中…';
      try {
        const n = await api('/api/novel-market/' + id + '/import', { method: 'POST' });
        toast('已加入书架：' + n.title, 'ok');
        await load();
        openPeek({ ...b0(id), imported: true, dbId: n.id });
      } catch (err) { b.disabled = false; b.textContent = '导入书架'; toast(err.message, 'err'); }
    }));
    listBox.querySelectorAll('[data-peek]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const bk = cache.find((x) => x.id === b.getAttribute('data-peek'));
      if (bk) openPeek(bk);
    }));
  }

  function b0(id) { return cache.find((x) => x.id === id) || {}; }

  function openPeek(b) {
    const m = openModal([
      '<h3 style="margin:0 0 6px">' + esc(b.title) + '</h3>',
      '<div style="color:var(--muted);font-size:12.5px;margin-bottom:10px">' + [b.genre, b.cat, (b.chapters || 0) + ' 章'].filter(Boolean).join(' · ') + '</div>',
      '<div class="card" style="white-space:pre-wrap;line-height:1.9;font-size:13px;max-height:260px;overflow:auto">' + esc(b.intro || '（暂无简介）') + '</div>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">',
      '<button class="ghost" id="pk-c">关闭</button>',
      b.imported ? '<button class="primary" id="pk-go">去分析改编</button>' : '<button class="primary" id="pk-imp">导入并改编</button>',
      '</div>',
    ].join(''));
    m.querySelector('#pk-c').addEventListener('click', closeModal);
    const imp = m.querySelector('#pk-imp');
    if (imp) imp.addEventListener('click', async () => {
      imp.disabled = true;
      const n = await api('/api/novel-market/' + b.id + '/import', { method: 'POST' });
      closeModal(); toast('已加入书架', 'ok'); location.hash = '#/novel';
      await load().catch(() => {});
    });
    const go = m.querySelector('#pk-go');
    if (go) go.addEventListener('click', () => { closeModal(); location.hash = '#/novel'; });
  }

  const q = view.querySelector('#mk-q');
  let tid = null;
  q.addEventListener('input', () => {
    clearTimeout(tid);
    tid = setTimeout(() => { S.q = q.value.trim(); load(); }, 260);
  });

  await load();
  paintTabs();
}
