
import { api, esc, toast, pollTask, statusLabel } from '../lib.js';

const LANGS = [['zh-CN','中文（普通话）'],['en-US','English'],['ja-JP','日本語'],['ko-KR','한국어']];

export async function render() {
  const [tr, as] = await Promise.all([api('/api/translate'), api('/api/assets?kind=video&limit=60')]);
  const vids = (as.list || []).filter((a) => a.kind === 'video');
  return [
    '<div class="page-head">',
    '  <div><h1>视频翻译</h1><p>换语言配音 + 字幕重排，原声对齐</p></div>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel">',
    '    <h3>新建翻译</h3>',
    '    <label class="field">源视频<select id="src"><option value="">— 选择视频 —</option>' +
      vids.map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('') + '</select></label>',
    '    <label class="field">目标语言<select id="lang">' + LANGS.map((l) => '<option value="' + l[0] + '">' + l[1] + '</option>').join('') + '</select></label>',
    '    <label class="field">台词提示<textarea id="hint" rows="4" placeholder="例如：两个人讨论周末去哪吃饭"></textarea></label>',
    '    <button class="primary" id="run">开始翻译</button>',
    '    <div style="font-size:11.5px;color:var(--dim);line-height:1.7">没有台词时用提示词生成示例台词；配音走本地 SAPI。</div>',
    '  </div>',
    '  <div>',
    '    <div class="stage" id="stage"><div class="placeholder">翻译结果会出现在这里</div></div>',
    '    <div class="stage-bar" id="bar"><span style="color:var(--dim)">就绪</span></div>',
    '    <div class="section-title">历史翻译</div>',
    '    <div id="hist" class="grid g3">' + (tr.list || []).map(histCard).join('') + '</div>',
    '  </div>',
    '</div>',
  ].join('');
}

function histCard(t) {
  return '<div class="card"><div style="display:flex;gap:6px;margin-bottom:6px"><span class="chip">' + esc(t.targetLang || '') + '</span>' +
    '<span class="chip ' + (t.status === 'done' ? 'ok' : '') + '">' + esc(t.status || '') + '</span></div>' +
    '<h3>' + esc(t.title || '未命名') + '</h3><p>' + ((t.lines || []).length) + ' 句台词</p>' +
    (t.videoRel ? '<button class="ghost" style="margin-top:8px" data-play="' + esc(t.videoRel) + '">播放</button>' : '') + '</div>';
}

export async function mount(view) {
  const stage = view.querySelector('#stage');
  const bar = view.querySelector('#bar');
  view.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
    stage.innerHTML = '<video src="' + esc(b.getAttribute('data-play')) + '" controls autoplay style="width:100%"></video>';
  }));
  view.querySelector('#run').addEventListener('click', async () => {
    const assetId = view.querySelector('#src').value;
    if (!assetId) return toast('先选一个视频', 'err');
    const btn = view.querySelector('#run');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const row = await api('/api/translate', { method: 'POST', body: { assetId, targetLang: view.querySelector('#lang').value, hint: view.querySelector('#hint').value } });
      btn.textContent = '翻译中…';
      pollTask(row.task.id, (tk) => {
        const p = tk.progress || 0;
        bar.innerHTML = '<div class="progress" style="flex:1"><i style="width:' + p + '%"></i></div><span style="color:var(--muted)">' + esc(tk.step || statusLabel(tk.status)) + ' · ' + p + '%</span>';
        if (tk.status === 'done') {
          btn.disabled = false; btn.textContent = '再次翻译';
          const r = tk.result || {};
          if (r.rel) stage.innerHTML = '<video src="' + esc(r.rel) + '" controls autoplay style="width:100%"></video>';
          bar.innerHTML = '<span style="color:var(--ok)">完成</span><button class="ghost tiny" id="dl">下载</button>';
          const dl = bar.querySelector('#dl');
          if (dl) dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = r.rel; a.download = ''; a.click(); });
        }
        if (tk.status === 'failed') { btn.disabled = false; btn.textContent = '重试'; toast('翻译失败：' + (tk.error || ''), 'err'); }
      });
    } catch (e) { btn.disabled = false; btn.textContent = '开始翻译'; toast(e.message, 'err'); }
  });
}
