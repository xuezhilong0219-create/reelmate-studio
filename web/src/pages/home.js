
import { api, esc, fmtTime, toast } from '../lib.js';
import { TOOLS, GROUPS } from '../tools-spec.js';

export async function render() {
  const d = await api('/api/dashboard');
  const quick = ['text-to-video', 'text-to-image', 'text-to-music', 'auto-bgm', 'agent-to-video', 'text-to-speech'];
  return [
    '<div class="page-head">',
    '  <div><h1>欢迎回来</h1><p>本地 AI 影视创作工作台 · 全部能力免费无限制</p></div>',
    '  <div class="spacer"></div>',
    '  <a class="ghost" href="#/tasks" style="padding:8px 15px;border-radius:10px;background:#141b27;border:1px solid var(--line);color:#c6d3e6;text-decoration:none;font-size:13px">查看任务</a>',
    '  <a class="primary" href="#/tools" style="padding:8px 15px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700">打开工具箱</a>',
    '</div>',
    '<div class="grid g4" style="margin-bottom:6px">',
    ...[
      ['项目', d.projects, '▤', '#/projects'],
      ['剧集', d.episodes, '▥', '#/projects'],
      ['分镜', d.storyboards, '▦', '#/projects'],
      ['素材', d.assets, '▩', '#/assets'],
    ].map((x) => '<a class="card hover" href="' + x[3] + '" style="text-decoration:none;display:flex;align-items:center;gap:12px">' +
      '<div style="font-size:20px;color:#3f5a78">' + x[2] + '</div>' +
      '<div><div style="font-size:22px;font-weight:700">' + x[1] + '</div>' +
      '<div style="font-size:11.5px;color:var(--dim)">' + x[0] + '</div></div></a>').join(''),
    '</div>',
    '<div class="section-title">快速开始</div>',
    '<div class="grid g3">',
    quick.map((id) => {
      const t = TOOLS.find((x) => x.id === id);
      return '<a class="card hover tool-card" href="#/tools/' + t.id + '" style="text-decoration:none">' +
        '<div class="tc-ico">' + t.icon + '</div>' +
        '<div class="tc-title">' + esc(t.title) + '</div>' +
        '<div class="tc-desc">' + esc(t.desc) + '</div>' +
        '<div class="tc-go">开始创作 →</div></a>';
    }).join(''),
    '</div>',
    '<div class="section-title">最近生成</div>',
    d.recentAssets && d.recentAssets.length
      ? '<div class="grid g4">' + d.recentAssets.map((a) => assetMini(a)).join('') + '</div>'
      : '<div class="empty">还没有作品，先去工具箱生成第一张图或第一段视频</div>',
    '<div class="section-title">最近任务</div>',
    d.recentTasks && d.recentTasks.length
      ? '<div class="card" style="padding:6px 14px">' + d.recentTasks.map((t) =>
          '<div class="task-row"><span class="nm">' + esc(t.title || t.kind) + '</span>' +
          '<span class="st ' + t.status + '">' + t.status + '</span>' +
          '<span style="color:var(--dim);font-size:11px">' + fmtTime(t.createdAt) + '</span></div>').join('') + '</div>'
      : '<div class="empty">暂无任务记录</div>',
    '<div class="section-title">能力总览 · ' + TOOLS.length + ' 个工具</div>',
    '<div class="grid g4">',
    GROUPS.map((g) => {
      const list = TOOLS.filter((t) => t.group === g);
      return '<div class="card"><h3>' + esc(g) + ' <span style="color:var(--dim);font-weight:400">' + list.length + '</span></h3>' +
        '<p>' + list.map((t) => esc(t.title)).join(' · ') + '</p></div>';
    }).join(''),
    '</div>',
  ].join('');
}

function assetMini(a) {
  const inner = a.kind === 'video'
    ? '<video src="' + esc(a.rel) + '" muted preload="metadata"></video>'
    : a.kind === 'audio' ? '<div style="font-size:22px">♪</div>' : '<img src="' + esc(a.thumb || a.rel) + '" loading="lazy" />';
  return '<a class="asset-card" href="#/assets" style="text-decoration:none">' +
    '<div class="asset-thumb">' + inner + '</div>' +
    '<div class="asset-meta"><div class="t">' + esc(a.name) + '</div><div class="s">' + fmtTime(a.createdAt) + '</div></div></a>';
}

export async function mount() {}
