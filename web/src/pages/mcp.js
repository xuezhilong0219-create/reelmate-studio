import { api, esc, toast } from '../lib.js';

/* MCP & CLI —— 把本项目的 HTTP 接口暴露成可脚本调用的能力面 */

const TABS = [['mcp', 'MCP 服务'], ['cli', 'CLI 用法'], ['api', '接口清单']];

const MCP_TOOLS = [
  { name: 'studio_health', desc: '读取服务状态与本地能力（ffmpeg / llm / 素材数 / 任务数）', args: '无' },
  { name: 'studio_text_to_video', desc: '一句话生成带运镜与转场的成片', args: 'prompt, count, seconds, style' },
  { name: 'studio_text_to_image', desc: '按提示词出 1–8 张图，可带标题与副标题', args: 'prompt, count, style, title' },
  { name: 'studio_storyboard', desc: '把剧本拆成分镜并按集批量出图', args: 'projectId, episodeId' },
  { name: 'studio_post', desc: '图片后期 14 项（裁剪/扩图/宫格/多角度/全景/打光…）', args: 'cap, assetId, ...params' },
  { name: 'studio_vpost', desc: '视频后期 6 项（冻帧/截帧/音频分离/深度/拉片/重拍）', args: 'cap, assetId, ...params' },
  { name: 'studio_timeline_export', desc: '按多轨工程导出成片', args: 'editorId' },
  { name: 'studio_canvas_run', desc: '运行画布某个节点或整条工作流', args: 'canvasId, nodeId | workflowId' },
  { name: 'studio_task', desc: '查询任务进度与结果', args: 'taskId' },
];

const CLI_LINES = [
  ['服务状态', 'curl http://127.0.0.1:8848/api/health'],
  ['文生视频', 'curl -X POST http://127.0.0.1:8848/api/tools/text-to-video -H "content-type: application/json" -d "{\\"prompt\\":\\"雪夜宫廷\\",\\"count\\":1}"'],
  ['文生图', 'curl -X POST http://127.0.0.1:8848/api/tools/text-to-image -H "content-type: application/json" -d "{\\"prompt\\":\\"雨夜霓虹\\",\\"count\\":4}"'],
  ['图片后期', 'curl -X POST http://127.0.0.1:8848/api/post/multi-angle -H "content-type: application/json" -d "{\\"assetId\\":\\"as_xxx\\",\\"views\\":\\"all\\"}"'],
  ['视频拉片', 'curl -X POST http://127.0.0.1:8848/api/vpost/video-parse -H "content-type: application/json" -d "{\\"assetId\\":\\"as_xxx\\"}"'],
  ['剪辑导出', 'curl -X POST http://127.0.0.1:8848/api/editor/ed_xxx/export'],
  ['查任务', 'curl http://127.0.0.1:8848/api/tasks/task_xxx'],
  ['素材列表', 'curl "http://127.0.0.1:8848/api/assets?kind=video&limit=20"'],
];

const SCRIPT_LINES = [
  '# 一条命令跑完整链路：提交任务 → 轮询 → 打印结果',
  'node -e "',
  'const r = await fetch(\'http://127.0.0.1:8848/api/tools/text-to-video\',',
  '  { method: \'POST\', headers: { \'content-type\': \'application/json\' },',
  '    body: JSON.stringify({ prompt: \'雨夜街头\', count: 1 }) }).then(r => r.json());',
  'let t;',
  'do { t = await fetch(\'http://127.0.0.1:8848/api/tasks/\' + r.data.id).then(r => r.json()); }',
  'while (t.data.status === \'running\' || t.data.status === \'queued\');',
  'console.log(t.data.result);',
  '"',
];

function mcpHtml() {
  const cfg = JSON.stringify({
    mcpServers: {
      'reelmate-studio': {
        command: 'node',
        args: ['D:/DSHpj/Rea/reelmate/studio/server/index.mjs'],
        env: { PORT: '8848' },
      },
    },
  }, null, 2);
  return [
    '<div class="section-title">MCP 服务</div>',
    '<p style="color:var(--dim);font-size:12.5px;line-height:1.8;margin:0 0 12px">把本机服务注册成 MCP 服务器后，任何支持 MCP 的客户端都能直接调用下列能力。服务本身就是普通 HTTP，不引入额外依赖。</p>',
    '<div class="card" style="margin-bottom:14px">',
    '  <div style="font-size:12px;color:var(--dim);margin-bottom:8px">客户端配置（Claude Desktop / Cursor 等）</div>',
    '  <pre id="mcp-cfg" style="margin:0;padding:12px;background:#0b1018;border:1px solid var(--line);border-radius:8px;overflow:auto;font-size:12px;line-height:1.7">' + esc(cfg) + '</pre>',
    '  <div class="row" style="margin-top:10px"><button class="ghost tiny" id="copy-cfg">复制配置</button><span class="chip ok">无需联网</span></div>',
    '</div>',
    '<div class="section-title">可调用能力（' + MCP_TOOLS.length + ' 项）</div>',
    '<table class="tbl"><thead><tr><th>工具名</th><th>说明</th><th>参数</th></tr></thead><tbody>' +
      MCP_TOOLS.map((t) => '<tr><td><code>' + esc(t.name) + '</code></td><td>' + esc(t.desc) + '</td><td style="color:var(--dim)">' + esc(t.args) + '</td></tr>').join('') +
    '</tbody></table>',
  ].join('');
}

function cliHtml() {
  return [
    '<div class="section-title">CLI 用法</div>',
    '<p style="color:var(--dim);font-size:12.5px;line-height:1.8;margin:0 0 12px">全部接口都是普通 HTTP + JSON，任何语言或 <code>curl</code> 都能直接调。耗时操作统一返回 task，轮询 <code>/api/tasks/:id</code> 拿结果。</p>',
    '<table class="tbl"><thead><tr><th style="width:90px">动作</th><th>命令</th></tr></thead><tbody>' +
      CLI_LINES.map((l) => '<tr><td>' + esc(l[0]) + '</td><td><code style="font-size:11.5px;word-break:break-all">' + esc(l[1]) + '</code></td></tr>').join('') +
    '</tbody></table>',
    '<div class="section-title">本地脚本</div>',
    '<div class="card"><pre id="cli-script" style="margin:0;padding:12px;background:#0b1018;border:1px solid var(--line);border-radius:8px;overflow:auto;font-size:12px;line-height:1.8">' +
      esc(SCRIPT_LINES.join('\n')) + '</pre>',
    '<div class="row" style="margin-top:10px"><button class="ghost tiny" id="copy-cli">复制脚本</button></div></div>',
  ].join('');
}

function apiHtml(routes) {
  const groups = {};
  for (const r of routes) {
    const m = String(r).match(/^(\w+)\s+(\/api\/[^/]+)/);
    if (!m) continue;
    const g = m[2];
    (groups[g] = groups[g] || []).push(r);
  }
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  return [
    '<div class="section-title">接口清单 · ' + routes.length + ' 条</div>',
    '<div class="row" style="margin-bottom:12px"><input type="search" id="api-q" placeholder="筛选路径…" style="max-width:280px" /></div>',
    '<div id="api-list">' + keys.map((g) =>
      '<div class="card" style="margin-bottom:10px" data-g="' + esc(g) + '">' +
        '<div style="font-size:12px;color:var(--brand);margin-bottom:6px">' + esc(g) + ' <span class="chip">' + groups[g].length + '</span></div>' +
        groups[g].map((r) => '<div class="api-line" style="font-size:11.5px;color:var(--muted);line-height:1.9;font-family:ui-monospace,monospace">' + esc(r) + '</div>').join('') +
      '</div>').join('') + '</div>',
  ].join('');
}

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>MCP &amp; CLI</h1><p>把剧作工坊的全部能力接进你自己的工具链</p></div>',
    '  <div class="spacer"></div><span class="chip ok">本地 · 免授权</span>',
    '</div>',
    '<div class="tabs-line" id="mtabs">' + TABS.map((t, i) =>
      '<button data-mt="' + t[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + esc(t[1]) + '</button>').join('') + '</div>',
    '<div id="mpanel"><div class="loading">加载中…</div></div>',
  ].join('');
}

export async function mount(view) {
  const panel = view.querySelector('#mpanel');
  let routes = null;
  let tab = 'mcp';

  async function paint() {
    if (tab === 'api') {
      if (!routes) routes = await api('/api/_routes');
      panel.innerHTML = apiHtml(routes || []);
      const q = panel.querySelector('#api-q');
      q.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        panel.querySelectorAll('[data-g]').forEach((card) => {
          let hit = 0;
          card.querySelectorAll('.api-line').forEach((l) => {
            const ok = !v || l.textContent.toLowerCase().includes(v);
            l.style.display = ok ? '' : 'none';
            if (ok) hit++;
          });
          card.style.display = hit ? '' : 'none';
        });
      });
      return;
    }
    panel.innerHTML = tab === 'cli' ? cliHtml() : mcpHtml();
    const cp = panel.querySelector('#copy-cfg');
    if (cp) cp.addEventListener('click', async () => {
      const txt = panel.querySelector('#mcp-cfg').textContent;
      try { await navigator.clipboard.writeText(txt); toast('配置已复制', 'ok'); }
      catch (e) { toast('复制失败，请手动选择', 'err'); }
    });
    const cc = panel.querySelector('#copy-cli');
    if (cc) cc.addEventListener('click', async () => {
      const txt = panel.querySelector('#cli-script').textContent;
      try { await navigator.clipboard.writeText(txt); toast('脚本已复制', 'ok'); }
      catch (e) { toast('复制失败，请手动选择', 'err'); }
    });
  }

  view.querySelector('#mtabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mt]');
    if (!b) return;
    tab = b.getAttribute('data-mt');
    view.querySelectorAll('[data-mt]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  });

  await paint();
}
