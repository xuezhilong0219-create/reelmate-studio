import { api, esc, toast, openModal, closeModal, fmtTime } from '../lib.js';

const KINDS = [['', '全部'], ['image', '图片'], ['video', '视频'], ['audio', '音频'], ['script', '剧本']];

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>提示词库</h1><p>把好用的描述沉淀下来，一键带到工具里</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="new">新建提示词</button>',
    '</div>',
    '<div class="pill-tabs" id="kinds">' + KINDS.map((k) => '<button data-k="' + k[0] + '" class="' + (k[0] === '' ? 'on' : '') + '">' + k[1] + '</button>').join('') + '</div>',
    '<div class="row" style="margin-bottom:14px"><input type="search" id="pq" placeholder="搜索提示词…" style="max-width:320px" /></div>',
    '<div id="plist" class="grid g3"><div class="loading">加载中…</div></div>',
  ].join('');
}

function card(p) {
  return '<div class="card" data-p="' + p.id + '">' +
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">' +
      '<span class="chip">' + esc(({ image: '图片', video: '视频', audio: '音频', script: '剧本' })[p.kind] || p.kind || '通用') + '</span>' +
      '<span style="font-size:11px;color:var(--dim)">用过 ' + (p.uses || 0) + ' 次</span>' +
    '</div>' +
    '<h3>' + esc(p.title || '未命名') + '</h3>' +
    '<p style="max-height:96px;overflow:hidden;white-space:pre-wrap">' + esc(p.text) + '</p>' +
    '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">' +
      '<button class="ghost" data-copy="' + p.id + '">复制</button>' +
      '<button class="ghost" data-use="' + p.id + '">去生成</button>' +
      '<div style="flex:1"></div>' +
      '<span data-del="' + p.id + '" style="cursor:pointer;color:var(--dim);font-size:12px">删除</span>' +
    '</div>' +
    '<div style="font-size:10.5px;color:var(--dim);margin-top:6px">' + fmtTime(p.createdAt) + '</div>' +
  '</div>';
}

export async function mount(view) {
  const box = view.querySelector('#plist');
  let kind = '';
  let cache = [];

  async function load() {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    const q = view.querySelector('#pq').value.trim();
    if (q) qs.set('q', q);
    const d = await api('/api/prompts?' + qs.toString());
    cache = d.list || [];
    box.innerHTML = cache.length ? cache.map(card).join('') : '<div class="empty" style="grid-column:1/-1">还没有提示词，先存一条</div>';
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const p = cache.find((x) => x.id === b.getAttribute('data-copy'));
      if (!p) return;
      try { await navigator.clipboard.writeText(p.text); toast('已复制到剪贴板', 'ok'); }
      catch { toast('复制失败，请手动选择文本', 'err'); }
    }));
    box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', async () => {
      const p = cache.find((x) => x.id === b.getAttribute('data-use'));
      if (!p) return;
      await api('/api/prompts/' + p.id + '/use', { method: 'POST' });
      const target = ({ image: '/tools/text-to-image', video: '/tools/text-to-video', audio: '/tools/text-to-speech', script: '/script' })[p.kind] || '/tools/text-to-image';
      try { await navigator.clipboard.writeText(p.text); } catch {}
      toast('提示词已复制，粘贴到输入框即可', 'ok');
      location.hash = '#' + target;
    }));
    box.querySelectorAll('[data-del]').forEach((n) => n.addEventListener('click', async () => {
      if (!confirm('删除这条提示词？')) return;
      await api('/api/prompts/' + n.getAttribute('data-del') + '/delete', { method: 'POST' });
      toast('已删除', 'ok'); load();
    }));
  }

  view.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
    kind = b.getAttribute('data-k');
    view.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
    load();
  }));
  view.querySelector('#pq').addEventListener('input', () => load());
  view.querySelector('#new').addEventListener('click', () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">新建提示词</h3>',
      '<label class="field">标题<input id="pt" type="text" placeholder="例如：雨夜霓虹街头" /></label>',
      '<label class="field" style="margin-top:10px">用途<select id="pk">' + KINDS.filter((k) => k[0]).map((k) => '<option value="' + k[0] + '">' + k[1] + '</option>').join('') + '</select></label>',
      '<label class="field" style="margin-top:10px">提示词<textarea id="px" rows="6" placeholder="描述画面、光线、镜头、情绪…"></textarea></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="ok">保存</button></div>',
    ].join(''));
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#ok').addEventListener('click', async () => {
      const text = m.querySelector('#px').value.trim();
      if (!text) return toast('请填写提示词', 'err');
      await api('/api/prompts', { method: 'POST', body: { title: m.querySelector('#pt').value.trim() || text.slice(0, 30), text, kind: m.querySelector('#pk').value } });
      closeModal(); toast('已保存', 'ok'); load();
    });
  });
  await load();
}
