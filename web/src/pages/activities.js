import { api, esc, toast } from '../lib.js';

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>活动中心</h1><p>长期开放的共创、改编与比赛</p></div>',
    '</div>',
    '<div id="acts" class="grid g2"><div class="loading">加载中…</div></div>',
  ].join('');
}

function card(a) {
  return '<div class="card" data-a="' + a.id + '">' +
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">' +
      '<span class="chip ' + (a.joinedByMe ? 'ok' : '') + '">' + esc(a.tag || '活动') + '</span>' +
      '<span style="font-size:11px;color:var(--dim)">' + esc(a.until || '') + '</span>' +
    '</div>' +
    '<h3>' + esc(a.title) + '</h3>' +
    '<p>' + esc(a.sub || '') + '</p>' +
    '<div class="kv" style="margin-top:10px"><span>奖励</span><div>' + esc(a.reward || '—') + '</div>' +
    '<span>参与</span><div>' + (a.joined || 0) + ' 人</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="' + (a.joinedByMe ? 'ghost' : 'primary') + '" data-join="' + a.id + '">' + (a.joinedByMe ? '已参加 · 取消' : '立即参加') + '</button>' +
    '</div>' +
  '</div>';
}

export async function mount(view) {
  const box = view.querySelector('#acts');
  let cache = [];
  async function load() {
    const d = await api('/api/activities');
    cache = d.list || [];
    box.innerHTML = cache.length ? cache.map(card).join('') : '<div class="empty" style="grid-column:1/-1">暂无活动</div>';
    box.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api('/api/activities/' + b.getAttribute('data-join') + '/join', { method: 'POST' });
        await load();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }
  await load();
}
