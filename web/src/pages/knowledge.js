import { api, esc, toast, openModal, closeModal, fmtTime } from '../lib.js';

let filter = { q: '', tag: '' };

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>知识库</h1><p>团队共享的世界观、人物小传与创作资料 · <span id="kb-count">—</span> 条</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="new">新建条目</button>',
    '</div>',
    '<div class="row" style="margin-bottom:14px;align-items:center">',
    '  <input type="search" id="kq" placeholder="搜索标题或内容…" style="max-width:300px" />',
    '  <select id="ktag" style="max-width:200px"><option value="">全部标签</option></select>',
    '</div>',
    '<div id="kb" class="grid g3"><div class="loading">加载中…</div></div>',
  ].join('');
}

function card(k) {
  return '<div class="card hover" data-k="' + k.id + '" style="cursor:pointer">' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
      (k.tags || []).map((t) => '<span class="chip">' + esc(t) + '</span>').join('') +
    '</div>' +
    '<h3>' + esc(k.title) + '</h3>' +
    '<p style="max-height:66px;overflow:hidden">' + esc(String(k.content || '').slice(0, 140)) + '</p>' +
    '<div style="font-size:11px;color:var(--dim);margin-top:8px">' + esc(k.author || '') + ' · ' + fmtTime(k.createdAt) + '</div>' +
  '</div>';
}

function editor(k, reload) {
  const html = [
    '<h3 style="margin:0 0 12px">' + (k ? '编辑条目' : '新建条目') + '</h3>',
    '<label class="field">标题<input id="kt" type="text" value="' + esc(k ? k.title : '') + '" /></label>',
    '<label class="field" style="margin-top:10px">标签（逗号分隔）<input id="kg" type="text" value="' + esc(k && k.tags ? k.tags.join(',') : '') + '" placeholder="世界观, 人物, 术语" /></label>',
    '<label class="field" style="margin-top:10px">内容<textarea id="kc" rows="10">' + esc(k ? k.content : '') + '</textarea></label>',
    '<div style="display:flex;gap:8px;margin-top:14px;align-items:center">',
    k ? '<button class="ghost" id="del" style="color:#fda4b4">删除</button>' : '',
    '<div style="flex:1"></div>',
    '<button class="ghost" id="c">取消</button><button class="primary" id="ok">保存</button>',
    '</div>',
  ].join('');
  const m = openModal(html);
  m.querySelector('#c').addEventListener('click', closeModal);
  m.querySelector('#ok').addEventListener('click', async () => {
    const title = m.querySelector('#kt').value.trim();
    if (!title) return toast('请填写标题', 'err');
    const body = { title, content: m.querySelector('#kc').value, tags: m.querySelector('#kg').value };
    try {
      if (k) await api('/api/knowledge/' + k.id, { method: 'POST', body });
      else await api('/api/knowledge', { method: 'POST', body });
      closeModal(); toast('已保存', 'ok'); reload();
    } catch (e) { toast(e.message, 'err'); }
  });
  const del = m.querySelector('#del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('删除这条知识？')) return;
    await api('/api/knowledge/' + k.id + '/delete', { method: 'POST' });
    closeModal(); toast('已删除', 'ok'); reload();
  });
}

export async function mount(view) {
  const box = view.querySelector('#kb');
  const countEl = view.querySelector('#kb-count');
  const tagSel = view.querySelector('#ktag');
  let cache = [];

  async function load() {
    const qs = new URLSearchParams();
    if (filter.q) qs.set('q', filter.q);
    if (filter.tag) qs.set('tag', filter.tag);
    const d = await api('/api/knowledge?' + qs.toString());
    cache = d.list || [];
    countEl.textContent = d.total != null ? d.total : cache.length;
    if (tagSel.options.length <= 1 && (d.tags || []).length) {
      tagSel.innerHTML = '<option value="">全部标签</option>' +
        d.tags.map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
      tagSel.value = filter.tag;
    }
    box.innerHTML = cache.length ? cache.map(card).join('') : '<div class="empty" style="grid-column:1/-1">知识库还是空的，先建一条世界观设定</div>';
    box.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('click', () => {
      const k = cache.find((x) => x.id === el.getAttribute('data-k'));
      if (k) editor(k, load);
    }));
  }

  view.querySelector('#kq').addEventListener('input', (e) => { filter.q = e.target.value.trim(); load(); });
  tagSel.addEventListener('change', (e) => { filter.tag = e.target.value; load(); });
  view.querySelector('#new').addEventListener('click', () => editor(null, load));
  await load();
}
