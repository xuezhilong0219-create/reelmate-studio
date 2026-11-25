
import { api, esc, toast, pollTask, statusLabel, fmtTime, openModal, closeModal } from '../lib.js';

let lastScript = null;

export async function render() {
  const d = await api('/api/scripts');
  const list = d.list || [];
  return [
    '<div class="page-head">',
    '  <div><h1>剧本创作</h1><p>一句话创意 → 人物设定 → 分集大纲 → 场景对白 → 分镜表</p></div>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel">',
    '    <h3>创作参数</h3>',
    '    <label class="field">故事创意 *<textarea id="idea" rows="4" placeholder="例如：一个外卖员在暴雨夜送出最后一单，发现收件人是十年前的自己"></textarea></label>',
    '    <label class="field">片名（可留空自动生成）<input id="title" type="text" /></label>',
    '    <div class="row">',
    '      <label class="field">集数<input id="eps" type="number" value="3" min="1" max="24" /></label>',
    '      <label class="field">每集场数<input id="spp" type="number" value="3" min="1" max="8" /></label>',
    '    </div>',
    '    <label class="field">题材<select id="genre"><option value="">智能识别</option>' +
      ['都市', '古装', '悬疑', '甜宠', '科幻', '玄幻', '职场', '校园', '家庭', '犯罪'].map((g) => '<option>' + g + '</option>').join('') + '</select></label>',
    '    <button class="primary" id="gen">生成剧本</button>',
    '    <div id="gen-progress"></div>',
    '    <div style="font-size:11.5px;color:var(--dim);line-height:1.7">未配置大模型时使用内置编剧引擎（离线可用）；在设置里填入 OpenAI 兼容接口可获得更长的上下文与更自由的文风。</div>',
    '  </div>',
    '  <div>',
    '    <div id="script-out"><div class="empty">生成后在这里查看剧本</div></div>',
    '    <div class="section-title">历史剧本</div>',
    '    <div class="grid g3" id="hist">' + (list.length ? list.map(histCard).join('') : '<div class="empty" style="grid-column:1/-1">暂无</div>') + '</div>',
    '  </div>',
    '</div>',
  ].join('');
}

function histCard(s) {
  return '<div class="card hover" data-sc="' + s.id + '" style="cursor:pointer">' +
    '<div style="display:flex;gap:6px;margin-bottom:6px"><span class="chip">' + esc(s.genre) + '</span><span class="chip">' + ((s.script && s.script.episodes) || []).length + ' 集</span></div>' +
    '<h3>' + esc(s.title) + '</h3><p>' + esc(s.logline || '') + '</p></div>';
}

export async function mount(view) {
  const out = view.querySelector('#script-out');
  const prog = view.querySelector('#gen-progress');

  view.querySelector('#gen').addEventListener('click', async () => {
    const idea = view.querySelector('#idea').value.trim();
    if (!idea) return toast('请填写故事创意', 'err');
    const body = {
      idea,
      title: view.querySelector('#title').value.trim(),
      episodes: Number(view.querySelector('#eps').value) || 3,
      scenesPerEp: Number(view.querySelector('#spp').value) || 3,
      genre: view.querySelector('#genre').value || undefined,
    };
    prog.innerHTML = '<div class="progress"><i style="width:8%"></i></div>';
    try {
      const t = await api('/api/scripts/generate', { method: 'POST', body });
      pollTask(t.id, (tk) => {
        prog.innerHTML = '<div class="progress"><i style="width:' + (tk.progress || 0) + '%"></i></div>' +
          '<div style="font-size:11.5px;color:var(--muted);margin-top:6px">' + esc(tk.step || '') + '</div>';
        if (tk.status === 'done') {
          lastScript = tk.result.script;
          out.innerHTML = scriptHtml(tk.result.script, tk.result.id);
          bindScript(out, tk.result.id);
          prog.innerHTML = '<div style="color:var(--ok);font-size:12px">完成</div>';
        }
        if (tk.status === 'failed') prog.innerHTML = '<div style="color:#fda4b4;font-size:12px">' + esc(tk.error || '') + '</div>';
      });
    } catch (e) { toast(e.message, 'err'); }
  });

  view.querySelectorAll('[data-sc]').forEach((c) => c.addEventListener('click', async () => {
    const s = await api('/api/scripts/' + c.getAttribute('data-sc'));
    lastScript = s.script;
    out.innerHTML = scriptHtml(s.script, s.id);
    bindScript(out, s.id);
  }));
}

function scriptHtml(sc, id) {
  if (!sc) return '<div class="empty">剧本为空</div>';
  return [
    '<div class="card" style="margin-bottom:14px">',
    '<div style="display:flex;align-items:flex-start;gap:12px">',
    '<div style="flex:1"><h2 style="margin:0 0 4px">' + esc(sc.title) + '</h2>',
    '<div style="color:var(--muted);font-size:12.5px">' + esc(sc.genre) + ' · ' + esc(sc.style || '短剧') + '</div>',
    '<p style="margin:10px 0 0;color:#c7d5e6;font-size:13px;line-height:1.7">' + esc(sc.logline || '') + '</p></div>',
    '<button class="primary" id="to-project">生成剧集项目</button>',
    '</div></div>',
    '<div class="section-title">人物</div>',
    '<div class="grid g4">' + (sc.characters || []).map((c) =>
      '<div class="card"><h3>' + esc(c.name) + '</h3><p>' + esc([c.gender, c.age ? c.age + '岁' : '', c.identity].filter(Boolean).join(' · ')) + '</p>' +
      '<p style="margin-top:6px;color:#9fb0c6">' + esc(c.trait || '') + '</p>' +
      (c.secret ? '<p style="margin-top:4px;color:#f0a5b5;font-size:11.5px">秘密：' + esc(c.secret) + '</p>' : '') + '</div>').join('') + '</div>',
    '<div class="section-title">分集</div>',
    (sc.episodes || []).map((ep) => [
      '<div class="card" style="margin-bottom:12px">',
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="chip">第 ' + ep.no + ' 集</span>',
      '<h3 style="margin:0">' + esc(ep.title) + '</h3></div>',
      '<p style="color:var(--muted);font-size:12.5px;margin-bottom:10px">' + esc(ep.logline || '') + (ep.hook ? ' · 钩子：' + esc(ep.hook) : '') + '</p>',
      (ep.scenes || []).map((s) => [
        '<div style="border-left:2px solid #23303f;padding-left:12px;margin-bottom:12px">',
        '<div style="font-size:12px;color:var(--dim);margin-bottom:4px">场次 ' + s.no + ' · ' + esc(s.heading || '') + ' · ' + esc(s.mood || '') + '</div>',
        '<div style="font-size:13px;line-height:1.75;color:#dbe6f4">' + esc(s.action || '') + '</div>',
        (s.dialog || []).map((l) => '<div style="margin-top:6px;font-size:13px"><b style="color:#8fd3ff">' + esc(l.role) + '：</b>' + esc(l.text) + '</div>').join(''),
        '<div style="margin-top:8px;font-size:11.5px;color:var(--dim)">分镜 ' + (s.shots || []).length + ' 个：' + (s.shots || []).map((x) => esc(x.size)).join(' / ') + '</div>',
        '</div>',
      ].join('')).join(''),
      '</div>',
    ].join('')).join(''),
    '<div style="display:flex;gap:8px;margin-top:10px"><button class="ghost" id="dl-script">下载剧本文本</button></div>',
  ].join('');
}

function bindScript(out, id) {
  const tp = out.querySelector('#to-project');
  if (tp) tp.addEventListener('click', async () => {
    const r = await api('/api/scripts/' + id + '/to-project', { method: 'POST' });
    toast('已创建项目，共 ' + r.episodes + ' 集', 'ok');
    location.hash = '#/projects/' + r.project.id;
  });
  const dl = out.querySelector('#dl-script');
  if (dl) dl.addEventListener('click', async () => {
    const s = await api('/api/scripts/' + id);
    const blob = new Blob([s.text || ''], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.title || 'script') + '.txt';
    a.click();
  });
}
