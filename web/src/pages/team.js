
import { api, esc, toast, openModal, closeModal, fmtTime, kindLabel } from '../lib.js';

let tab = 'members';
const TABS = [
  ['members', '成员'], ['groups', '分组与权限'], ['statistics', '统计'],
  ['character', '角色'], ['scene', '场景'], ['props', '道具'],
  ['flow', '积分流水'], ['ranking', '排行'], ['invites', '邀请'],
];

export async function render() {
  const d = await api('/api/team');
  return [
    '<div class="page-head">',
    '  <div><h1>' + esc(d.team.name) + '</h1><p>席位 ' + d.team.seats + ' · 成员 ' + (d.members || []).length + ' 人 · 本地版不限制团队额度与并发</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="invite">邀请成员</button>',
    '</div>',
    '<div class="tabs-line">' + TABS.map((t) =>
      '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>',
    '<div id="team-body">' + body(d) + '</div>',
  ].join('');
}

function body(d) {
  if (tab === 'members') {
    return '<div class="card"><table><thead><tr><th>成员</th><th>邮箱</th><th>分组</th><th>角色</th><th>状态</th><th>加入时间</th><th></th></tr></thead><tbody>' +
      (d.members || []).map((m) => '<tr><td><b>' + esc(m.name) + '</b></td><td style="color:var(--muted)">' + esc(m.email || '') + '</td>' +
        '<td>' + esc((d.groups.find((g) => g.id === m.groupId) || {}).name || '—') + '</td><td>' + esc(m.role || 'member') + '</td>' +
        '<td><span class="chip ' + (m.status === 'active' ? 'ok' : '') + '">' + esc(m.status || 'active') + '</span></td>' +
        '<td style="color:var(--dim)">' + fmtTime(m.joinedAt) + '</td>' +
        '<td><span class="x" data-del="' + m.id + '" style="cursor:pointer;color:var(--dim)">移除</span></td></tr>').join('') +
      '</tbody></table></div>';
  }
  if (tab === 'groups') {
    const mods = d.modules || DEFAULT_MODS;
    const acts = d.actions || ['view', 'create', 'edit', 'delete', 'admin'];
    return '<div class="card" style="margin-bottom:14px"><h3>分组</h3><div class="grid g3">' +
      (d.groups || []).map((g) => '<div class="card" style="background:#0e141e"><h3>' + esc(g.name) + '</h3><p>' + ((g.permissions || []).length) + ' 项权限</p></div>').join('') +
      '</div></div>' +
      '<div class="card"><h3>权限矩阵</h3><div class="perm-grid">' +
      '<div class="hd">模块</div>' + acts.map((a) => '<div class="hd">' + esc(a) + '</div>').join('') +
      mods.map((m) => '<div class="mod">' + esc(m.label || m) + '</div>' +
        acts.map((a) => '<div><input type="checkbox" data-mod="' + esc(m.key || m) + '" data-act="' + a + '" checked /></div>').join('')).join('') +
      '</div><div style="font-size:11.5px;color:var(--dim);margin-top:8px">本地版默认全权限开放；勾选仅用于团队内展示与留档。</div></div>';
  }
  if (tab === 'statistics') {
    return '<div class="card"><div class="loading">统计加载中…</div></div>';
  }
  if (tab === 'character' || tab === 'scene' || tab === 'props') {
    return '<div class="card"><div class="loading">加载中…</div></div>';
  }
  if (tab === 'flow') {
    return '<div class="card"><table><thead><tr><th>时间</th><th>类型</th><th>数量</th><th>说明</th></tr></thead><tbody>' +
      ((d.flow || []).length ? d.flow.map((f) => '<tr><td style="color:var(--dim)">' + fmtTime(f.createdAt) + '</td><td>' + esc(f.type || '') + '</td>' +
        '<td>' + (f.delta > 0 ? '+' : '') + f.delta + '</td><td style="color:var(--muted)">' + esc(f.reason || '') + '</td></tr>').join('')
        : '<tr><td colspan="4" style="color:var(--dim);text-align:center;padding:24px">本地版不记录额度消耗</td></tr>') +
      '</tbody></table></div>';
  }
  if (tab === 'ranking') {
    return '<div class="card"><table><thead><tr><th>#</th><th>成员</th><th>产出</th></tr></thead><tbody>' +
      ((d.ranking || []).map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + (r.count || 0) + '</td></tr>').join('') ||
        '<tr><td colspan="3" style="color:var(--dim);text-align:center;padding:24px">暂无数据</td></tr>') +
      '</tbody></table></div>';
  }
  return '<div class="card"><div class="empty">邀请码：' + esc((d.invite && d.invite.code) || 'LOCAL-OPEN') + '（本地版无需邀请，直接加入）</div></div>';
}

const DEFAULT_MODS = [
  { key: 'project', label: '剧集项目' }, { key: 'script', label: '剧本' }, { key: 'asset', label: '资产库' },
  { key: 'canvas', label: '画布' }, { key: 'team', label: '团队' }, { key: 'billing', label: '额度' },
];

const CAT_TAB = { character: 'character', scene: 'scene', props: 'prop' };

function statsHtml(s) {
  const kpi = [
    ['项目', s.projects], ['剧集', s.episodes], ['分镜', s.storyboards], ['素材', s.assets],
    ['任务总数', s.tasks], ['已完成', s.done], ['近 7 日', s.week], ['进行中', s.running],
  ];
  const max = Math.max(1, ...s.daily.map((x) => x.count));
  const bars = s.daily.map((x) => '<div class="st-bar"><i style="height:' + Math.max(4, Math.round(x.count / max * 96)) + 'px"></i><span>' + x.date + '</span></div>').join('');
  const kindRows = Object.entries(s.byKind || {}).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => '<div class="st-kv"><span>' + esc(kindLabel(k) === k ? k : kindLabel(k)) + '</span><b>' + v + '</b></div>').join('');
  const catRows = Object.entries(s.cats || {}).map(([k, v]) =>
    '<div class="st-kv"><span>' + esc({ character: '角色', scene: '场景', prop: '道具', ip: 'IP 模板' }[k] || k) + '</span><b>' + v + '</b></div>').join('');
  return [
    '<div class="grid g4" style="margin-bottom:14px">' + kpi.map((k) =>
      '<div class="card" style="padding:14px"><div style="font-size:11.5px;color:var(--dim)">' + k[0] + '</div>' +
      '<div style="font-size:24px;font-weight:700;margin-top:4px">' + k[1] + '</div></div>').join('') + '</div>',
    '<div class="grid g2" style="margin-bottom:14px">',
    '<div class="card"><h3>近 7 日任务</h3><div class="st-bars">' + bars + '</div></div>',
    '<div class="card"><h3>任务类型分布</h3>' + (kindRows || '<div class="empty">暂无任务</div>') + '</div>',
    '</div>',
    '<div class="grid g2">',
    '<div class="card"><h3>素材分类</h3>' + catRows + '</div>',
    '<div class="card"><h3>成员参与统计</h3><table><thead><tr><th>成员</th><th>任务</th><th>消耗</th><th>状态</th></tr></thead><tbody>' +
      (s.members || []).map((m) => '<tr><td>' + esc(m.name) + '</td><td>' + m.tasks + '</td><td>' + m.creditsUsed + '</td>' +
        '<td><span class="chip ' + (m.status === 'active' ? 'ok' : '') + '">' + esc(m.status) + '</span></td></tr>').join('') +
      '</tbody></table></div>',
    '</div>',
    '<div class="grid g2" style="margin-top:14px">',
    '<div class="card"><h3>创作消耗统计</h3><table><thead><tr><th>类型</th><th>任务</th><th>完成</th><th>算力</th></tr></thead><tbody>' +
      (Object.entries(s.consumption || {}).sort((a, b) => b[1].count - a[1].count).map(([k, v]) =>
        '<tr><td>' + esc(k) + '</td><td>' + v.count + '</td><td>' + v.done + '</td><td>' + v.credits + '</td></tr>').join('') ||
        '<tr><td colspan="4" style="color:var(--dim);text-align:center;padding:20px">暂无任务</td></tr>') +
      '</tbody></table></div>',
    '<div class="card"><h3>资产成本统计</h3><table><thead><tr><th>类型</th><th>数量</th><th>体积</th></tr></thead><tbody>' +
      (Object.entries(s.assetCost || {}).map(([k, v]) =>
        '<tr><td>' + esc({ image: '图片', video: '视频', audio: '音频', file: '文件' }[k] || k) + '</td><td>' + v.count + '</td><td>' +
        (v.size ? (v.size / 1048576).toFixed(1) + ' MB' : '—') + '</td></tr>').join('') ||
        '<tr><td colspan="3" style="color:var(--dim);text-align:center;padding:20px">暂无资产</td></tr>') +
      '</tbody></table></div>',
    '</div>',
    '<div class="card" style="margin-top:14px"><h3>项目参与统计</h3><table><thead><tr><th>项目</th><th>剧集</th><th>分镜</th><th>素材</th></tr></thead><tbody>' +
      (s.projectRows || []).map((p) => '<tr><td>' + esc(p.title) + '</td><td>' + p.episodes + '</td><td>' + p.storyboards + '</td><td>' + p.assets + '</td></tr>').join('') +
      '</tbody></table></div>',
  ].join('');
}

function teamAssetsHtml(d) {
  const rows = d.list || [];
  if (!rows.length) return '<div class="empty">这个分类还没有资产，去「资产库」把素材设为该分类即可</div>';
  return '<div class="grid g4">' + rows.map((a) => {
    const inner = a.kind === 'video' ? '<video src="' + esc(a.rel) + '" muted preload="metadata"></video>'
      : '<img src="' + esc(a.thumb || a.rel) + '" loading="lazy" />';
    return '<div class="asset-card"><div class="asset-thumb">' + inner + '</div>' +
      '<div class="kind-badge">' + (a.teamLib ? '团队' : '个人') + '</div>' +
      '<div class="asset-meta"><div class="t">' + esc(a.name) + '</div></div></div>';
  }).join('') + '</div>';
}

export async function mount(view) {
  async function paint() {
    const box = view.querySelector('#team-body');
    if (tab === 'statistics') {
      const s = await api('/api/team/statistics');
      box.innerHTML = statsHtml(s);
      return;
    }
    if (CAT_TAB[tab]) {
      const d = await api('/api/team/assets?cat=' + CAT_TAB[tab]);
      box.innerHTML = '<div class="card"><div style="display:flex;align-items:center;margin-bottom:10px">' +
        '<h3 style="margin:0">' + ({ character: '角色', scene: '场景', props: '道具' }[tab]) + '</h3>' +
        '<span style="margin-left:auto;font-size:11.5px;color:var(--dim)">共 ' + d.total + ' 项 · 团队资产 ' + d.teamLib + ' 项</span></div>' +
        teamAssetsHtml(d) + '</div>';
      return;
    }
    const d = await api('/api/team');
    box.innerHTML = body(d);
    bindDelete(box);
  }

  function bindDelete(box) {
    box.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', async () => {
      if (!confirm('移除该成员？')) return;
      await api('/api/team/members/' + x.getAttribute('data-del') + '/delete', { method: 'POST' });
      paint();
    }));
  }

  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    tab = b.getAttribute('data-tab');
    view.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-tab') === tab));
    view.querySelector('#team-body').innerHTML = '<div class="loading">加载中…</div>';
    await paint();
  }));

  bindDelete(view.querySelector('#team-body'));

  const inv = view.querySelector('#invite');
  if (inv) inv.addEventListener('click', () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">邀请成员</h3>',
      '<label class="field">姓名<input id="mn" type="text" /></label>',
      '<label class="field" style="margin-top:10px">邮箱<input id="me" type="text" /></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="k">添加</button></div>',
    ].join(''));
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#k').addEventListener('click', async () => {
      await api('/api/team/members', { method: 'POST', body: { name: m.querySelector('#mn').value, email: m.querySelector('#me').value } });
      closeModal(); toast('已添加', 'ok'); paint();
    });
  });

  if (tab === 'statistics' || CAT_TAB[tab]) await paint();
}
