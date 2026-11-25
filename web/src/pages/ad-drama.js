
import { api, esc, toast, openModal, closeModal, pollTask, statusLabel, fmtDur } from '../lib.js';

export async function render() {
  const d = await api('/api/ad-drama');
  const list = d.list || [];
  return [
    '<div class="page-head">',
    '  <div><h1>广告短剧</h1><p>卖点文案 → 分镜 → 带配乐成片，全自动</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="new">新建广告</button>',
    '</div>',
    list.length ? '<div class="grid g3">' + list.map(card).join('') + '</div>'
      : '<div class="empty">还没有广告短剧。写一句卖点，一键出片</div>',
    '<div id="log" style="margin-top:14px"></div>',
  ].join('');
}

function card(x) {
  const shot = (x.shots || [])[0];
  return '<div class="card" data-ad="' + x.id + '">' +
    '<div style="display:flex;gap:6px;margin-bottom:8px"><span class="chip">' + esc(x.status || 'draft') + '</span>' +
    '<span class="chip">' + (x.duration || 30) + 's</span></div>' +
    '<h3>' + esc(x.title) + '</h3><p>' + esc(x.product || '') + (x.audience ? ' · ' + esc(x.audience) : '') + '</p>' +
    (x.videoRel ? '<video src="' + esc(x.videoRel) + '" controls style="width:100%;border-radius:10px;margin-top:10px"></video>' :
      shot ? '<div class="asset-thumb" style="margin-top:10px"><img src="' + esc(shot.imageRel || '') + '" /></div>' : '') +
    '<div style="display:flex;gap:8px;margin-top:12px;align-items:center">' +
      '<button class="primary" data-gen="' + x.id + '">' + (x.videoRel ? '重新生成' : '一键成片') + '</button>' +
      '<div style="flex:1"></div>' +
      '<span data-del="' + x.id + '" style="cursor:pointer;color:var(--dim);font-size:12px">删除</span>' +
    '</div>' +
    '<div style="font-size:10.5px;color:var(--dim);margin-top:6px">' + ((x.shots || []).length) + ' 个镜头</div></div>';
}

export async function mount(view) {
  view.querySelector('#new').addEventListener('click', () => {
    const m = openModal([
      '<h3 style="margin:0 0 12px">新建广告短剧</h3>',
      '<label class="field">标题<input id="at" type="text" placeholder="例如：夏日气泡水 30 秒" /></label>',
      '<div class="row" style="margin-top:10px">',
      '  <label class="field">产品<input id="ap" type="text" placeholder="气泡水" /></label>',
      '  <label class="field">人群<input id="aa" type="text" placeholder="都市白领" /></label>',
      '</div>',
      '<label class="field" style="margin-top:10px">总时长（秒）<input id="ad" type="number" value="30" min="10" max="120" /></label>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="ghost" id="c">取消</button><button class="primary" id="ok">创建</button></div>',
    ].join(''));
    m.querySelector('#c').addEventListener('click', closeModal);
    m.querySelector('#ok').addEventListener('click', async () => {
      const title = m.querySelector('#at').value.trim();
      if (!title) return toast('请填标题', 'err');
      await api('/api/ad-drama', { method: 'POST', body: { title, product: m.querySelector('#ap').value, audience: m.querySelector('#aa').value, duration: Number(m.querySelector('#ad').value) || 30 } });
      closeModal(); toast('已创建', 'ok'); location.reload();
    });
  });

  const log = view.querySelector('#log');
  view.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-gen');
    b.disabled = true; b.textContent = '提交中…';
    try {
      const task = await api('/api/ad-drama/' + id + '/generate', { method: 'POST', body: {} });
      b.textContent = '生成中…';
      log.innerHTML = '<div class="card"><h3>成片进度</h3><div class="progress" style="margin:10px 0"><i style="width:4%"></i></div><div id="lgstep" style="font-size:12px;color:var(--muted)">排队中</div></div>';
      const bar = log.querySelector('.progress i');
      const step = log.querySelector('#lgstep');
      pollTask(task.id, (tk) => {
        bar.style.width = (tk.progress || 0) + '%';
        step.textContent = (tk.step || statusLabel(tk.status)) + ' · ' + (tk.progress || 0) + '%';
        if (tk.status === 'done') {
          b.disabled = false; b.textContent = '重新生成';
          const r = tk.result || {};
          log.innerHTML = '<div class="card"><h3>成片完成</h3>' +
            (r.rel ? '<video src="' + esc(r.rel) + '" controls autoplay style="width:100%;border-radius:10px;margin-top:10px"></video>' : '') +
            '<div style="display:flex;gap:8px;margin-top:12px"><button class="ghost" id="dl">下载</button><button class="ghost" id="as">资产库</button></div></div>';
          const dl = log.querySelector('#dl');
          if (dl) dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = r.rel; a.download = ''; a.click(); });
          log.querySelector('#as').addEventListener('click', () => { location.hash = '#/assets'; });
          toast('成片完成', 'ok');
        }
        if (tk.status === 'failed') { b.disabled = false; b.textContent = '重试'; step.textContent = '失败：' + (tk.error || ''); toast('生成失败', 'err'); }
      });
    } catch (e) { b.disabled = false; b.textContent = '一键成片'; toast(e.message, 'err'); }
  }));

  view.querySelectorAll('[data-del]').forEach((n) => n.addEventListener('click', async () => {
    if (!confirm('删除这个广告短剧？')) return;
    await api('/api/ad-drama/' + n.getAttribute('data-del') + '/delete', { method: 'POST' });
    toast('已删除', 'ok'); location.reload();
  }));
}
