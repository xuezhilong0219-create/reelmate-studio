
import { api, esc, toast, openModal, closeModal, pickFile, uploadFile, fmtTime, fmtDur, kindLabel } from '../lib.js';

const CATS = [
  { k: '', n: '全部' },
  { k: 'character', n: '角色' },
  { k: 'scene', n: '场景' },
  { k: 'prop', n: '道具' },
  { k: 'ip', n: 'IP 模板' },
];

let filter = { kind: '', folderId: '', q: '', favorite: false, cat: '', teamLib: false };
let picked = new Set();
let folders = [];
let curAssets = [];

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>资产库</h1><p>角色 / 场景 / 道具 / IP 模板，多层文件夹与团队资产库</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="ghost" id="new-folder">新建文件夹</button>',
    '  <button class="primary" id="upload-btn">上传素材</button>',
    '</div>',
    '<div class="tabs-line" id="cat-tabs">' + CATS.map((c) =>
      '<button data-cat="' + c.k + '" class="' + (filter.cat === c.k ? 'on' : '') + '">' + c.n + '</button>').join('') + '</div>',
    '<div class="studio" style="grid-template-columns:230px 1fr">',
    '  <div class="panel" id="folder-tree" style="max-height:70vh;overflow:auto"></div>',
    '  <div>',
    '    <div class="row" style="margin-bottom:12px;align-items:center">',
    '      <input type="search" id="q" placeholder="搜索名称…" style="max-width:240px" />',
    '      <select id="kind-sel" style="max-width:140px"><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select>',
    '      <label class="switch"><input type="checkbox" id="fav-only" /> 只看收藏</label>',
    '      <label class="switch"><input type="checkbox" id="team-only" /> 团队资产库</label>',
    '    </div>',
    '    <div class="row" id="bulk-bar" style="margin-bottom:10px;display:none;align-items:center;gap:8px">',
    '      <span class="chip" id="bulk-count">已选 0</span>',
    '      <button class="ghost tiny" id="bulk-cat">设为分类</button>',
    '      <button class="ghost tiny" id="bulk-import">导入到项目</button>',
    '      <button class="ghost tiny" id="bulk-team">存为团队资产</button>',
    '      <button class="ghost tiny" id="bulk-move">移动到文件夹</button>',
    '      <button class="ghost tiny" id="bulk-untag">存回个人</button>',
    '      <div style="flex:1"></div>',
    '      <button class="ghost tiny" id="bulk-del" style="color:#fda4b4">批量删除</button>',
    '    </div>',
    '    <div id="asset-grid" class="grid g4"><div class="loading">加载中…</div></div>',
    '  </div>',
    '</div>',
  ].join('');
}

function card(a) {
  const inner = a.kind === 'video'
    ? '<video src="' + esc(a.rel) + '" muted preload="metadata" playsinline onmouseover="this.play()" onmouseout="this.pause()"></video>'
    : a.kind === 'audio' ? '<div style="font-size:24px">♪</div>' : '<img src="' + esc(a.thumb || a.rel) + '" loading="lazy" />';
  const catName = (CATS.find((c) => c.k === a.cat) || {}).n || '';
  return '<div class="asset-card' + (picked.has(a.id) ? ' on' : '') + '" data-id="' + a.id + '">' +
    '<div class="asset-thumb">' + inner + '</div>' +
    '<button class="pick" data-pick="' + a.id + '">' + (picked.has(a.id) ? '✓' : '') + '</button>' +
    '<div class="kind-badge">' + esc(catName || kindLabel(a.kind)) + '</div>' +
    '<button class="fav" data-fav="' + a.id + '">' + (a.favorite ? '★' : '☆') + '</button>' +
    '<div class="asset-meta"><div class="t">' + esc(a.name) + '</div>' +
    '<div class="s">' + fmtTime(a.createdAt) + (a.duration ? ' · ' + fmtDur(a.duration) : '') + (a.width ? ' · ' + a.width + '×' + a.height : '') +
    (a.teamLib ? ' · 团队' : '') + '</div></div>' +
    '</div>';
}

function treeHtml(list, parentId, depth) {
  const kids = list.filter((f) => (f.parentId || null) === parentId);
  if (!kids.length) return '';
  return kids.map((f) => {
    const n = curAssets.filter((a) => a.folderId === f.id).length;
    return '<div class="ft-row" data-folder="' + f.id + '" style="padding-left:' + (depth * 14 + 4) + 'px' +
      (filter.folderId === f.id ? ';background:#16202e' : '') + '">' +
      '<span class="ft-name">' + (depth ? '└ ' : '▸ ') + esc(f.name) + '</span><span class="ft-n">' + n + '</span>' +
      '<button class="ft-add" data-addsub="' + f.id + '" title="建子文件夹">+</button>' +
      '</div>' + treeHtml(list, f.id, depth + 1);
  }).join('');
}

export async function mount(view) {
  const grid = view.querySelector('#asset-grid');
  const tree = view.querySelector('#folder-tree');
  const bulk = view.querySelector('#bulk-bar');

  async function reloadTree() {
    const d = await api('/api/folders');
    folders = d.list || d || [];
  }

  function syncBulk() {
    bulk.style.display = picked.size ? 'flex' : 'none';
    view.querySelector('#bulk-count').textContent = '已选 ' + picked.size;
  }

  async function load() {
    const q = new URLSearchParams();
    if (filter.kind) q.set('kind', filter.kind);
    if (filter.folderId) q.set('folderId', filter.folderId);
    if (filter.q) q.set('q', filter.q);
    if (filter.favorite) q.set('favorite', '1');
    if (filter.cat) q.set('cat', filter.cat);
    if (filter.teamLib) q.set('teamLib', '1');
    const d = await api('/api/assets?' + q.toString());
    curAssets = d.list || [];
    const all = await api('/api/assets?limit=1');
    const allList = [];
    for (const f of folders) allList.push(f);
    tree.innerHTML = '<div class="ft-head">文件夹</div>' +
      '<div class="ft-row" data-folder="" style="' + (filter.folderId === '' ? 'background:#16202e' : '') + '"><span class="ft-name">▸ 全部素材</span><span class="ft-n">' + (all.total || 0) + '</span></div>' +
      (treeHtml(folders, null, 0) || '<div style="font-size:11.5px;color:var(--dim);padding:8px 4px">还没有文件夹</div>');
    tree.querySelectorAll('[data-folder]').forEach((r) => r.addEventListener('click', (e) => {
      if (e.target.closest('[data-addsub]')) return;
      filter.folderId = r.getAttribute('data-folder');
      load();
    }));
    tree.querySelectorAll('[data-addsub]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      newFolder(b.getAttribute('data-addsub'));
    }));

    grid.innerHTML = curAssets.length
      ? curAssets.map(card).join('')
      : '<div class="empty" style="grid-column:1/-1">没有素材</div>';
    grid.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-fav]') || e.target.closest('[data-pick]')) return;
        const a = curAssets.find((x) => x.id === el.getAttribute('data-id'));
        if (a) detail(a, load);
      });
    });
    grid.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('/api/assets/' + b.getAttribute('data-fav') + '/favorite', { method: 'POST' });
      load();
    }));
    grid.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-pick');
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      b.textContent = picked.has(id) ? '✓' : '';
      b.parentElement.classList.toggle('on', picked.has(id));
      syncBulk();
    }));
    syncBulk();
  }

  function newFolder(parentId) {
    const m = openModal('<h3 style="margin:0 0 12px">新建文件夹' + (parentId ? '（子级）' : '') + '</h3>' +
      '<label class="field">名称<input id="fn" type="text" placeholder="例如：第一集素材" /></label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ghost" id="c">取消</button><button class="primary" id="k">创建</button></div>');
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      const name = m.querySelector('#fn').value.trim();
      if (!name) return toast('请输入名称', 'err');
      try {
        await api('/api/folders', { method: 'POST', body: { name, parentId: parentId || null } });
        closeModal(); toast('已创建', 'ok');
        await reloadTree(); load();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  view.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    filter.cat = b.getAttribute('data-cat');
    view.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-cat') === filter.cat));
    load();
  }));
  view.querySelector('#q').addEventListener('input', (e) => { filter.q = e.target.value.trim(); load(); });
  view.querySelector('#kind-sel').addEventListener('change', (e) => { filter.kind = e.target.value; load(); });
  view.querySelector('#fav-only').addEventListener('change', (e) => { filter.favorite = e.target.checked; load(); });
  view.querySelector('#team-only').addEventListener('change', (e) => { filter.teamLib = e.target.checked; load(); });

  view.querySelector('#new-folder').addEventListener('click', () => newFolder(null));
  view.querySelector('#upload-btn').addEventListener('click', async () => {
    const file = await pickFile('');
    if (!file) return;
    try { await uploadFile(file); toast('上传成功', 'ok'); load(); }
    catch (e) { toast('上传失败：' + e.message, 'err'); }
  });

  view.querySelector('#bulk-cat').addEventListener('click', () => {
    const opts = CATS.filter((c) => c.k).map((c) => '<option value="' + c.k + '">' + c.n + '</option>').join('') + '<option value="">清除分类</option>';
    const m = openModal('<h3 style="margin:0 0 12px">设为分类（' + picked.size + ' 项）</h3><select id="cc">' + opts + '</select>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      const cat = m.querySelector('#cc').value;
      for (const id of picked) await api('/api/assets/' + id + '/meta', { method: 'POST', body: { cat } });
      closeModal(); toast('已更新 ' + picked.size + ' 项', 'ok'); picked.clear(); load();
    });
  });

  view.querySelector('#bulk-import').addEventListener('click', async () => {
    const d = await api('/api/projects');
    const list = d.list || d.projects || d || [];
    if (!list.length) return toast('还没有项目', 'err');
    const m = openModal('<h3 style="margin:0 0 12px">导入到项目（' + picked.size + ' 项）</h3>' +
      '<select id="pp">' + list.map((p) => '<option value="' + p.id + '">' + esc(p.title) + '</option>').join('') + '</select>' +
      '<div style="font-size:11.5px;color:var(--dim);margin-top:8px">单次最多导入 60 个素材</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">导入</button></div>');
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      const ids = Array.from(picked).slice(0, 60);
      try {
        const r = await api('/api/assets/batch-import', { method: 'POST', body: { ids, projectId: m.querySelector('#pp').value } });
        closeModal(); toast('已导入 ' + r.imported + ' 项到《' + r.project + '》', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  });

  view.querySelector('#bulk-team').addEventListener('click', async () => {
    await api('/api/assets/batch-team', { method: 'POST', body: { ids: Array.from(picked), teamLib: true } });
    toast('已存为团队资产', 'ok'); picked.clear(); load();
  });
  view.querySelector('#bulk-untag').addEventListener('click', async () => {
    await api('/api/assets/batch-team', { method: 'POST', body: { ids: Array.from(picked), teamLib: false } });
    toast('已存回个人资产', 'ok'); picked.clear(); load();
  });

  view.querySelector('#bulk-move').addEventListener('click', () => {
    if (!folders.length) return toast('先新建文件夹', 'err');
    const opts = ['<option value="">（移出文件夹）</option>'].concat(
      folders.map((f) => '<option value="' + f.id + '">' + esc(f.name) + '</option>')).join('');
    const m = openModal('<h3 style="margin:0 0 12px">移动到文件夹</h3><select id="fsel">' + opts + '</select>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      const folderId = m.querySelector('#fsel').value || null;
      for (const id of picked) await api('/api/assets/' + id + '/move', { method: 'POST', body: { folderId } });
      closeModal(); picked.clear(); toast('已移动', 'ok'); load();
    });
  });

  view.querySelector('#bulk-del').addEventListener('click', async () => {
    if (!confirm('删除选中的 ' + picked.size + ' 个素材？')) return;
    await api('/api/assets/batch-delete', { method: 'POST', body: { ids: Array.from(picked) } });
    picked.clear(); toast('已删除', 'ok'); load();
  });

  await reloadTree();
  await load();
}

function detail(a, reload) {
  const src = a.kind === 'video'
    ? '<video src="' + esc(a.rel) + '" controls style="width:100%;border-radius:10px"></video>'
    : a.kind === 'audio'
      ? '<audio src="' + esc(a.rel) + '" controls style="width:100%"></audio>'
      : '<img src="' + esc(a.rel) + '" style="width:100%;border-radius:10px" />';
  const subs = (a.sub || []).map((s) => '<div class="sub-i" data-sub="' + esc(s.rel) + '"><img src="' + esc(s.thumb || s.rel) + '" /></div>').join('');
  const hist = (a.history || []).map((s) => '<div class="sub-i" data-sub="' + esc(s.rel) + '"><img src="' + esc(s.thumb || s.rel) + '" /></div>').join('');
  const html = [
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">',
    '<h3 style="margin:0">' + esc(a.name) + '</h3><button class="icon-btn" id="x">✕</button></div>',
    src,
    subs ? '<div class="sub-row"><span>子图</span>' + subs + '</div>' : '',
    hist ? '<div class="sub-row"><span>历史</span>' + hist + '</div>' : '',
    '<div class="kv" style="margin-top:14px">',
    '<span>类型</span><div>' + esc((CATS.find((c) => c.k === a.cat) || {}).n || kindLabel(a.kind)) + '</div>',
    a.width ? '<span>尺寸</span><div>' + a.width + ' × ' + a.height + '</div>' : '',
    a.duration ? '<span>时长</span><div>' + fmtDur(a.duration) + '</div>' : '',
    a.file ? '<span>文件</span><div style="font-size:11px;color:var(--dim);word-break:break-all">' + esc(a.file) + '</div>' : '',
    a.meta && a.meta.prompt ? '<span>提示词</span><div>' + esc(a.meta.prompt) + '</div>' : '',
    '<span>创建</span><div>' + fmtTime(a.createdAt) + '</div>',
    '</div>',
    '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">',
    '<button class="ghost" id="dl">下载</button>',
    '<button class="ghost" id="rn">重命名</button>',
    '<button class="ghost" id="mv">移动</button>',
    '<button class="ghost" id="cs">设为分类</button>',
    '<button class="ghost" id="tm">' + (a.teamLib ? '存回个人' : '存为团队资产') + '</button>',
    a.kind === 'image' ? '<button class="ghost" id="sub-add">挂为子图</button>' : '',
    a.kind === 'image' ? '<button class="ghost" id="hist-add">存为历史版本</button>' : '',
    '<div style="flex:1"></div>',
    '<button class="ghost" id="del" style="color:#fda4b4">删除</button>',
    '</div>',
  ].join('');
  const m = openModal(html);
  m.querySelector('#x').addEventListener('click', closeModal);
  m.querySelectorAll('[data-sub]').forEach((el) => el.addEventListener('click', () => window.open(el.getAttribute('data-sub'), '_blank')));
  m.querySelector('#dl').addEventListener('click', () => { const x = document.createElement('a'); x.href = a.rel; x.download = ''; x.click(); });
  m.querySelector('#rn').addEventListener('click', async () => {
    const name = prompt('新名称', a.name);
    if (!name) return;
    await api('/api/assets/' + a.id + '/rename', { method: 'POST', body: { name } });
    closeModal(); reload();
  });
  m.querySelector('#mv').addEventListener('click', async () => {
    const d = await api('/api/folders');
    const list = d.list || d || [];
    const opts = ['<option value="">（移出文件夹）</option>'].concat(list.map((f) => '<option value="' + f.id + '">' + esc(f.name) + '</option>')).join('');
    const mm = openModal('<h3 style="margin:0 0 12px">移动到文件夹</h3><select id="fsel">' + opts + '</select><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
    mm.querySelector('#c').addEventListener('click', closeModal);
    mm.querySelector('#k').addEventListener('click', async () => {
      await api('/api/assets/' + a.id + '/move', { method: 'POST', body: { folderId: mm.querySelector('#fsel').value || null } });
      closeModal(); reload();
    });
  });
  m.querySelector('#cs').addEventListener('click', async () => {
    const opts = CATS.filter((c) => c.k).map((c) => '<option value="' + c.k + '"' + (a.cat === c.k ? ' selected' : '') + '>' + c.n + '</option>').join('') + '<option value="">清除分类</option>';
    const mm = openModal('<h3 style="margin:0 0 12px">设为分类</h3><select id="cc">' + opts + '</select><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
    mm.querySelector('#c').addEventListener('click', closeModal);
    mm.querySelector('#k').addEventListener('click', async () => {
      await api('/api/assets/' + a.id + '/meta', { method: 'POST', body: { cat: mm.querySelector('#cc').value } });
      closeModal(); reload();
    });
  });
  m.querySelector('#tm').addEventListener('click', async () => {
    await api('/api/assets/' + a.id + '/meta', { method: 'POST', body: { teamLib: !a.teamLib } });
    closeModal(); reload();
  });
  const linkSub = async (mode) => {
    const d = await api('/api/assets?kind=image&limit=60');
    const list = (d.list || []).filter((x) => x.id !== a.id);
    if (!list.length) return toast('没有其他图片资产', 'err');
    const mm = openModal('<h3 style="margin:0 0 12px">' + (mode === 'history' ? '存为历史版本' : '挂为子图') + '</h3>' +
      '<select id="ss">' + list.map((x) => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') + '</select>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">确定</button></div>');
    mm.querySelector('#c').addEventListener('click', closeModal);
    mm.querySelector('#k').addEventListener('click', async () => {
      await api('/api/assets/' + a.id + '/sub', { method: 'POST', body: { assetId: mm.querySelector('#ss').value, mode } });
      closeModal(); toast('已挂载', 'ok'); reload();
    });
  };
  if (m.querySelector('#sub-add')) m.querySelector('#sub-add').addEventListener('click', () => linkSub('sub'));
  if (m.querySelector('#hist-add')) m.querySelector('#hist-add').addEventListener('click', () => linkSub('history'));
  m.querySelector('#del').addEventListener('click', async () => {
    if (!confirm('确定删除这个素材？')) return;
    await api('/api/assets/' + a.id + '/delete', { method: 'POST' });
    closeModal(); reload(); toast('已删除', 'ok');
  });
}
