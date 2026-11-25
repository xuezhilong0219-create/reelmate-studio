
import { api, esc, toast } from '../lib.js';

export async function render() {
  const d = await api('/api/partner');
  return [
    '<div class="page-head">',
    '  <div><h1>合作中心</h1><p>' + esc(d.level || '') + ' · 分成 ' + Math.round((d.commission || 0) * 100) + '% · 本地版不结算真实金额</p></div>',
    '</div>',
    '<div class="grid g4" style="margin-bottom:18px">',
    '<div class="card"><div style="font-size:26px;font-weight:700">' + ((d.tickets || []).length) + '</div><div style="font-size:12px;color:var(--muted)">可接工单</div></div>',
    '<div class="card"><div style="font-size:26px;font-weight:700">' + ((d.stats && d.stats.works) || 0) + '</div><div style="font-size:12px;color:var(--muted)">已发布作品</div></div>',
    '<div class="card"><div style="font-size:26px;font-weight:700">' + ((d.stats && d.stats.projects) || 0) + '</div><div style="font-size:12px;color:var(--muted)">剧集项目</div></div>',
    '<div class="card"><div style="font-size:26px;font-weight:700">' + ((d.stats && d.stats.members) || 0) + '</div><div style="font-size:12px;color:var(--muted)">团队成员</div></div>',
    '</div>',
    '<div class="section-title">工单大厅</div>',
    '<div class="grid g3">' + (d.tickets || []).map((t) =>
      '<div class="card"><div style="display:flex;gap:6px;margin-bottom:8px"><span class="chip ok">' + esc(t.status || 'open') + '</span><span class="chip">' + esc(t.need || '') + '</span></div>' +
      '<h3>' + esc(t.title) + '</h3><p>预算：' + esc(t.budget || '—') + '</p>' +
      '<button class="ghost" style="margin-top:10px" data-take="' + t.id + '">领取工单</button></div>').join('') + '</div>',
    '<div class="section-title">邀请码</div>',
    '<div class="card"><p style="line-height:1.9">本地版无需邀请即可加入团队。合作方邀请码只做展示，不产生任何结算。</p>' +
    ((d.invites || []).length ? '<div class="kv" style="margin-top:10px">' + d.invites.map((i) => '<span>' + esc(i.code) + '</span><div>' + esc(i.note || '') + '</div>').join('') + '</div>' : '') + '</div>',
  ].join('');
}

export async function mount(view) {
  view.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', () => {
    toast('已领取（本地演示，不产生结算）', 'ok');
    b.textContent = '已领取'; b.disabled = true;
  }));
}
