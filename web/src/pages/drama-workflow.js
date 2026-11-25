import { api, esc, toast } from '../lib.js';

/* 短剧工作流 —— 把官方 drama-workflow 的整条链路做成可推进的看板 */

const STEPS = [
  { k: 'script', label: '剧本与分集', ico: '✎', path: '/script', desc: '一句话/大纲 → 分集正文、钩子、看点' },
  { k: 'storyboard', label: '分镜拆解', ico: '☰', path: '/projects', desc: '逐集拆镜号、景别、运镜、台词' },
  { k: 'image', label: '分镜出图', ico: '▣', path: '/projects', desc: '批量生成分镜板，可横/竖两种排布' },
  { k: 'video', label: '分镜成片', ico: '▶', path: '/projects', desc: '逐镜渲染镜头 + 运镜 + 转场' },
  { k: 'edit', label: '多轨剪辑', ico: '▬', path: '/editor', desc: '配乐、字幕、变速、轨间混音' },
  { k: 'post', label: '后期处理', ico: '▧', path: '/post', desc: '调色、打光、超清、去字幕' },
];

export async function render() {
  const [projects, dash] = await Promise.all([
    api('/api/projects'),
    api('/api/dashboard').catch(() => ({})),
  ]);
  const list = projects.list || [];
  const KPIS = [
    ['项目', (dash.projects != null ? dash.projects : list.length), '▤', '/projects'],
    ['剧集', dash.episodes || 0, '❐', '/projects'],
    ['分镜', dash.storyboards || 0, '☰', '/projects'],
    ['素材', dash.assets || 0, '▩', '/assets'],
    ['进行中任务', (dash.tasks && dash.tasks.running) || 0, '⏱', '/tasks'],
    ['已完成任务', (dash.tasks && dash.tasks.done) || 0, '✓', '/tasks'],
  ];
  return [
    '<div class="page-head">',
    '  <div><h1>短剧工作流</h1><p>从一句设定到成片，六步走完整条链路</p></div>',
    '  <div class="spacer"></div><a class="chip ok" href="#/projects">共 ' + list.length + ' 个项目</a>',
    '</div>',
    '<div class="grid g3" style="margin-bottom:16px">',
    KPIS.map((c) => '<a class="card hover" href="#' + c[3] + '" style="text-decoration:none">' +
      '<div style="font-size:11.5px;color:var(--dim)">' + esc(c[0]) + '</div>' +
      '<div style="font-size:26px;font-weight:700;margin-top:4px">' + esc(String(c[1])) + '<span style="font-size:14px;color:var(--dim);margin-left:6px">' + c[2] + '</span></div></a>').join(''),
    '</div>',
    '<div class="section-title">六步链路</div>',
    '<div class="grid g3" style="margin-bottom:18px">' + STEPS.map((s, i) =>
      '<a class="card hover" href="#' + s.path + '" style="text-decoration:none">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span style="width:22px;height:22px;border-radius:6px;background:var(--line);display:grid;place-items:center;font-size:11px;color:var(--brand)">' + (i + 1) + '</span>' +
          '<b style="font-size:13px">' + s.ico + ' ' + esc(s.label) + '</b></div>' +
        '<div style="font-size:11.5px;color:var(--dim);line-height:1.7">' + esc(s.desc) + '</div>' +
      '</a>').join('') + '</div>',
    '<div class="section-title">按项目推进</div>',
    '<div id="wf"><div class="loading">加载中…</div></div>',
  ].join('');
}

export async function mount(view) {
  const box = view.querySelector('#wf');
  const d = await api('/api/projects');
  const list = d.list || [];
  if (!list.length) {
    box.innerHTML = '<div class="empty">还没有项目，先去「剧集项目」新建一个</div>';
    return;
  }
  const rows = await Promise.all(list.map(async (p) => {
    let eps = [];
    try { eps = (await api('/api/projects/' + p.id + '/episodes')).list || []; } catch (e) { eps = []; }
    let sb = 0, img = 0, vid = 0;
    for (const e of eps) {
      try {
        const bl = (await api('/api/episodes/' + e.id + '/storyboards')).list || [];
        sb += bl.length;
        img += bl.filter((b) => b.imageRel).length;
        vid += bl.filter((b) => b.videoRel).length;
      } catch (err) { /* 跳过 */ }
    }
    return { p, episodes: eps.length, sb, img, vid };
  }));
  box.innerHTML = '<table class="tbl"><thead><tr><th>项目</th><th>类型</th><th>集数</th><th>分镜</th><th>已出图</th><th>已成片</th><th>进度</th><th></th></tr></thead><tbody>' +
    rows.map((r) => {
      const p = r.p;
      const pct = r.sb ? Math.round((r.vid / r.sb) * 100) : 0;
      return '<tr><td>' + esc(p.title) + '</td><td style="color:var(--dim)">' + esc(p.genre || p.kind || '—') + '</td>' +
        '<td>' + r.episodes + '</td><td>' + r.sb + '</td><td>' + r.img + '</td><td>' + r.vid + '</td>' +
        '<td><div class="progress" style="width:110px"><i style="width:' + pct + '%"></i></div><span style="font-size:11px;color:var(--dim);margin-left:6px">' + pct + '%</span></td>' +
        '<td><a class="chip" href="#/projects/' + p.id + '">进入</a></td></tr>';
    }).join('') + '</tbody></table>';
}
