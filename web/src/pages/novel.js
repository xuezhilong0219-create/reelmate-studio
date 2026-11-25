
import { api, esc, toast, pollTask, openModal, closeModal, fmtTime } from '../lib.js';

export async function render() {
  const [d, m] = await Promise.all([api('/api/novels'), api('/api/novel-market')]);
  const list = d.list || [];
  return [
    '<div class="page-head">',
    '  <div><h1>小说改编</h1><p>粘贴小说正文 → 世界观 / 人物卡 / 章节拆解 → 分集大纲 → 可拍剧本</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="import">导入小说</button>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel">',
    '    <h3>小说库</h3>',
    '    <div id="novel-list">' + (list.length ? list.map(item).join('') : '<div class="empty">还没有小说</div>') + '</div>',
    '  </div>',
    '  <div id="novel-detail"><div class="empty">选择左侧小说查看分析结果</div></div>',
    '</div>',
  ].join('');
}

function item(n) {
  return '<div class="asset-card" data-nv="' + n.id + '" style="cursor:pointer;margin-bottom:10px;display:flex;gap:10px;padding:10px">' +
    '<div style="width:38px;height:38px;border-radius:9px;background:#16202e;display:grid;place-items:center;font-size:16px">❖</div>' +
    '<div style="min-width:0"><div style="font-size:13px">' + esc(n.title) + '</div>' +
    '<div style="font-size:11px;color:var(--dim)">' + esc(n.genre || '') + ' · ' + (n.chapters || 0) + ' 章 · ' + esc(n.status || '') + '</div></div></div>';
}

export async function mount(view) {
  const detail = view.querySelector('#novel-detail');
  const listBox = view.querySelector('#novel-list');

  async function open(id) {
    const n = await api('/api/novels/' + id);
    const a = n.analysis;
    detail.innerHTML = [
      '<div class="card" style="margin-bottom:14px">',
      '<div style="display:flex;gap:10px;align-items:flex-start">',
      '<div style="flex:1"><h2 style="margin:0 0 4px">' + esc(n.title) + '</h2>',
      '<div style="color:var(--muted);font-size:12.5px">' + esc(n.genre || '') + ' · ' + esc(n.status) + ' · ' + (n.text || '').length + ' 字</div></div>',
      '<button class="ghost" id="ana">' + (a ? '重新分析' : '开始分析') + '</button>',
      '<button class="primary" id="tos">改编为剧本</button>',
      '</div>',
      '<div id="ana-progress" style="margin-top:10px"></div>',
      '</div>',
      a ? analyzeHtml(a) : '<div class="empty">尚未分析</div>',
      '<div class="section-title">原文预览</div>',
      '<div class="card" style="max-height:280px;overflow:auto;white-space:pre-wrap;font-size:12.5px;line-height:1.9;color:#c3d2e4">' + esc((n.text || '').slice(0, 3000)) + '</div>',
    ].join('');
    const prog = detail.querySelector('#ana-progress');
    detail.querySelector('#ana').addEventListener('click', async () => {
      const t = await api('/api/novels/' + n.id + '/analyze', { method: 'POST' });
      pollTask(t.id, (tk) => {
        prog.innerHTML = '<div class="progress"><i style="width:' + (tk.progress || 0) + '%"></i></div>';
        if (tk.status === 'done') open(n.id);
        if (tk.status === 'failed') prog.innerHTML = '<div style="color:#fda4b4">' + esc(tk.error || '') + '</div>';
      });
    });
    detail.querySelector('#tos').addEventListener('click', async () => {
      const t = await api('/api/novels/' + n.id + '/to-script', { method: 'POST' });
      pollTask(t.id, (tk) => {
        prog.innerHTML = '<div class="progress"><i style="width:' + (tk.progress || 0) + '%"></i></div>';
        if (tk.status === 'done') { toast('剧本已生成', 'ok'); location.hash = '#/script'; }
      });
    });
  }

  view.querySelectorAll('[data-nv]').forEach((c) => c.addEventListener('click', () => open(c.getAttribute('data-nv'))));

  view.querySelector('#import').addEventListener('click', () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">导入小说</h3>',
      '<label class="field">书名<input id="nt" type="text" placeholder="例如：长夜宫阙" /></label>',
      '<label class="field" style="margin-top:10px">正文<textarea id="nx" rows="10" placeholder="粘贴小说正文（建议 5000 字以上）"></textarea></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">导入</button></div>',
    ].join(''));
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      const title = m.querySelector('#nt').value.trim();
      const text = m.querySelector('#nx').value.trim();
      if (!title || !text) return toast('书名和正文都要填', 'err');
      const n = await api('/api/novels', { method: 'POST', body: { title, text } });
      closeModal();
      const d = await api('/api/novels');
      listBox.innerHTML = d.list.map(item).join('');
      listBox.querySelectorAll('[data-nv]').forEach((c) => c.addEventListener('click', () => open(c.getAttribute('data-nv'))));
      open(n.id);
    });
  });
}

function analyzeHtml(a) {
  return [
    '<div class="section-title">世界观</div>',
    '<div class="card"><div class="kv">',
    '<span>时代</span><div>' + esc(a.worldview && a.worldview.era || '—') + '</div>',
    '<span>规则</span><div>' + esc(a.worldview && a.worldview.rules || '—') + '</div>',
    '<span>核心冲突</span><div>' + esc(a.worldview && a.worldview.conflict || '—') + '</div>',
    '<span>基调</span><div>' + esc(a.worldview && a.worldview.tone || '—') + '</div>',
    '</div></div>',
    '<div class="section-title">人物卡</div>',
    '<div class="grid g4">' + (a.characters || []).map((c) =>
      '<div class="card"><h3>' + esc(c.name) + '</h3><p>' + esc([c.identity, c.gender].filter(Boolean).join(' · ')) + '</p><p style="margin-top:4px;color:#9fb0c6">' + esc(c.trait || '') + '</p></div>').join('') + '</div>',
    '<div class="section-title">章节拆解</div>',
    '<div class="card"><table><thead><tr><th>#</th><th>标题</th><th>概要</th></tr></thead><tbody>' +
      (a.chapters || []).map((c) => '<tr><td>' + c.no + '</td><td>' + esc(c.title) + '</td><td style="color:var(--muted)">' + esc(c.summary || '') + '</td></tr>').join('') +
      '</tbody></table></div>',
    '<div class="section-title">分集大纲</div>',
    '<div class="grid g3">' + (a.episodes || []).map((e) =>
      '<div class="card"><h3>第 ' + e.no + ' 集 · ' + esc(e.title) + '</h3><p>' + esc(e.summary || '') + '</p></div>').join('') + '</div>',
  ].join('');
}
