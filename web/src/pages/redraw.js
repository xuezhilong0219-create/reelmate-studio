
import { api, esc, toast, pollTask, statusLabel } from '../lib.js';
import { STYLES } from '../tools-spec.js';

export async function render() {
  const [rw, as] = await Promise.all([api('/api/redraw'), api('/api/assets?limit=80')]);
  const list = (as.list || []).filter((a) => a.kind === 'video' || a.kind === 'image');
  return [
    '<div class="page-head">',
    '  <div><h1>视频重绘</h1><p>整段素材统一换风格，保留构图与节奏</p></div>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel">',
    '    <h3>新建重绘</h3>',
    '    <label class="field">源素材<select id="src"><option value="">— 选择视频或图片 —</option>' +
      list.map((a) => '<option value="' + a.id + '">' + esc(a.name) + ' · ' + esc(a.kind) + '</option>').join('') + '</select></label>',
    '    <label class="field">目标风格<select id="style">' + STYLES.map((s) => '<option value="' + s[0] + '">' + s[1] + '</option>').join('') + '</select></label>',
    '    <button class="primary" id="run">开始重绘</button>',
    '    <div style="font-size:11.5px;color:var(--dim);line-height:1.7">本地引擎按关键帧重绘并回拼，画面风格统一。</div>',
    '  </div>',
    '  <div>',
    '    <div class="stage" id="stage"><div class="placeholder">重绘结果会出现在这里</div></div>',
    '    <div class="stage-bar" id="bar"><span style="color:var(--dim)">就绪</span></div>',
    '    <div class="section-title">历史记录</div>',
    '    <div class="grid g3">' + (rw.list || []).map((x) => '<div class="card"><div style="display:flex;gap:6px;margin-bottom:6px"><span class="chip">' + esc(x.style || '') + '</span><span class="chip ' + (x.status === 'done' ? 'ok' : '') + '">' + esc(x.status || '') + '</span></div><h3>' + esc(x.title || '') + '</h3>' + (x.rel ? '<button class="ghost" data-play="' + esc(x.rel) + '" style="margin-top:8px">查看</button>' : '') + '</div>').join('') + '</div>',
    '  </div>',
    '</div>',
  ].join('');
}

export async function mount(view) {
  const stage = view.querySelector('#stage');
  const bar = view.querySelector('#bar');
  view.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
    const rel = b.getAttribute('data-play');
    stage.innerHTML = /\.(mp4|webm)$/i.test(rel) ? '<video src="' + esc(rel) + '" controls autoplay style="width:100%"></video>' : '<img src="' + esc(rel) + '" />';
  }));
  view.querySelector('#run').addEventListener('click', async () => {
    const assetId = view.querySelector('#src').value;
    if (!assetId) return toast('先选素材', 'err');
    const btn = view.querySelector('#run');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const row = await api('/api/redraw', { method: 'POST', body: { assetId, style: view.querySelector('#style').value } });
      btn.textContent = '重绘中…';
      pollTask(row.task.id, (tk) => {
        const p = tk.progress || 0;
        bar.innerHTML = '<div class="progress" style="flex:1"><i style="width:' + p + '%"></i></div><span style="color:var(--muted)">' + esc(tk.step || statusLabel(tk.status)) + ' · ' + p + '%</span>';
        if (tk.status === 'done') {
          btn.disabled = false; btn.textContent = '再次重绘';
          const r = tk.result || {};
          if (r.rel) stage.innerHTML = /\.(mp4|webm)$/i.test(r.rel) ? '<video src="' + esc(r.rel) + '" controls autoplay style="width:100%"></video>' : '<img src="' + esc(r.rel) + '" />';
          bar.innerHTML = '<span style="color:var(--ok)">完成</span><button class="ghost tiny" id="dl">下载</button>';
          const dl = bar.querySelector('#dl');
          if (dl) dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = r.rel; a.download = ''; a.click(); });
        }
        if (tk.status === 'failed') { btn.disabled = false; btn.textContent = '重试'; toast('重绘失败：' + (tk.error || ''), 'err'); }
      });
    } catch (e) { btn.disabled = false; btn.textContent = '开始重绘'; toast(e.message, 'err'); }
  });
}
