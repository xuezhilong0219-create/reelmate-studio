import { api, esc, toast, pollTask, statusLabel } from '../lib.js';

/* 视频后期 —— 官方 canvas.videoPost 六项能力的本地实现入口 */

const FORMS = {
  'freeze-extend': { title: '冻帧延长', desc: '把视频末尾定格若干秒，音轨自动补静音，用来给台词或字幕留时间', fields: [
    { k: 'seconds', t: 'number', label: '延长秒数（0.5–15）', v: 2, min: 0.5, max: 15, step: 0.5 },
    { k: 'at', t: 'select', label: '作用位置', opts: [['end', '结尾定格'], ['0', '从片头开始']], v: 'end' }] },
  'frame-capture': { title: '截帧', desc: '导出单帧，或按时间均匀抽多帧拼成联系表', fields: [
    { k: 'count', t: 'number', label: '帧数（1–12，1=单帧）', v: 4, min: 1, max: 12 },
    { k: 'at', t: 'number', label: '单帧时间点（秒，仅 count=1 生效）', v: 0, min: 0, step: 0.1 }] },
  'audio-separate': { title: '音频提取', desc: '导出原音轨、提取人声、提取背景声，或输出无声视频', fields: [
    { k: 'mode', t: 'select', label: '处理方式', opts: [['track', '只保留音轨'], ['vocal', '提取人声'], ['bgm', '提取背景声'], ['none', '去掉音轨']], v: 'track' }] },
  'depth-capture': { title: '深度动捕', desc: '生成灰度景深图或伪彩深度图，用作 3D 世界的深度参考', fields: [
    { k: 'at', t: 'number', label: '取帧时间（秒）', v: 0, min: 0, step: 0.1 },
    { k: 'color', t: 'select', label: '输出', opts: [['0', '灰度深度'], ['1', '伪彩深度']], v: '1' }] },
  'video-parse': { title: '视频拉片', desc: '自动检测镜头切换，出帧联系表与镜号／时长／景别拉片表', fields: [] },
  'local-repaint': { title: '片段重拍', desc: '把指定时间段替换成按提示词重新生成的一段，前后保持原片', fields: [
    { k: 'start', t: 'number', label: '起点（秒）', v: 0, min: 0, step: 0.1 },
    { k: 'end', t: 'number', label: '终点（秒）', v: 2, min: 0.5, step: 0.1 },
    { k: 'prompt', t: 'textarea', label: '重拍画面描述', v: '', ph: '例如：雨夜街头，主角撑伞回头，霓虹反射在湿地面' },
    { k: 'motion', t: 'select', label: '运镜', opts: [['zoom-in', '推近'], ['zoom-out', '拉远'], ['pan-left', '左移'], ['pan-right', '右移'], ['tilt-up', '上摇'], ['shake', '手持晃动']], v: 'zoom-in' }] },
};

let cache = { assets: [] };

function fieldHtml(f) {
  const fid = 'f_' + f.k;
  if (f.t === 'select') {
    return '<label class="field">' + esc(f.label) + '<select id="' + fid + '">' +
      f.opts.map((o) => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(f.v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>';
  }
  if (f.t === 'textarea') {
    return '<label class="field">' + esc(f.label) + '<textarea id="' + fid + '" rows="4" placeholder="' + esc(f.ph || '') + '">' + esc(f.v || '') + '</textarea></label>';
  }
  const attrs = (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') +
    (f.step !== undefined ? ' step="' + f.step + '"' : '');
  const type = f.t === 'number' ? 'number' : 'text';
  return '<label class="field">' + esc(f.label) + '<input id="' + fid + '" type="' + type + '" value="' + esc(f.v === undefined ? '' : f.v) + '"' + attrs + ' /></label>';
}

function videoOptions() {
  const list = (cache.assets || []).filter((a) => a.kind === 'video');
  return '<option value="">— 选择视频素材 —</option>' + list.map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
}

function formHtml(cap) {
  const F = FORMS[cap];
  if (!F) return '';
  return '<label class="field">源视频<select id="src">' + videoOptions() + '</select></label>' +
    F.fields.map(fieldHtml).join('');
}

export async function render() {
  const [caps, as] = await Promise.all([api('/api/vpost/caps'), api('/api/assets?kind=video&limit=200')]);
  cache.assets = as.list || [];
  const list = caps.list || [];
  const first = list.length ? list[0].key : 'freeze-extend';
  return [
    '<div class="page-head">',
    '  <div><h1>视频后期</h1><p>冻帧延长 · 截帧 · 音频提取 · 深度动捕 · 视频拉片 · 片段重拍</p></div>',
    '  <div class="spacer"></div><span class="chip ok">全部能力免费</span>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel">',
    '    <h3>选择能力</h3>',
    '    <div class="row" id="caps" style="gap:6px;flex-wrap:wrap">' + list.map((c, i) =>
      '<button class="ghost tiny" data-cap="' + esc(c.key) + '" style="' + (i === 0 ? 'border-color:var(--brand);color:var(--brand)' : '') + '">' + esc(c.label) + '</button>').join('') + '</div>',
    '    <div id="cap-desc" style="font-size:11.5px;color:var(--dim);line-height:1.7">' + esc((list[0] || {}).desc || '') + '</div>',
    '    <div id="form">' + formHtml(first) + '</div>',
    '    <button class="primary" id="run">生成</button>',
    '    <div style="font-size:11.5px;color:var(--dim);line-height:1.7">结果自动进资产库，可直接拿去分镜或剪辑台继续用。</div>',
    '  </div>',
    '  <div>',
    '    <div class="stage" id="stage"><div class="placeholder">选一项能力，结果会出现在这里</div></div>',
    '    <div class="stage-bar" id="bar"><span style="color:var(--dim)">就绪</span></div>',
    '    <div class="section-title">输出结果</div>',
    '    <div class="grid g4" id="outs"><div style="color:var(--dim);font-size:12.5px">暂无</div></div>',
    '    <div id="extra"></div>',
    '  </div>',
    '</div>',
  ].join('');
}

export async function mount(view) {
  const stage = view.querySelector('#stage');
  const bar = view.querySelector('#bar');
  const outs = view.querySelector('#outs');
  const extra = view.querySelector('#extra');
  const capBox = view.querySelector('#caps');
  const formBox = view.querySelector('#form');
  const descBox = view.querySelector('#cap-desc');
  const runBtn = view.querySelector('#run');
  let cap = (capBox.querySelector('[data-cap]') || { getAttribute: () => 'freeze-extend' }).getAttribute('data-cap');

  capBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cap]');
    if (!b) return;
    cap = b.getAttribute('data-cap');
    capBox.querySelectorAll('[data-cap]').forEach((x) => {
      const on = x === b;
      x.style.borderColor = on ? 'var(--brand)' : '';
      x.style.color = on ? 'var(--brand)' : '';
    });
    formBox.innerHTML = formHtml(cap);
    descBox.textContent = (FORMS[cap] || {}).desc || '';
    extra.innerHTML = '';
  });

  const showOut = (r) => {
    const imgs = (r && r.images) || [];
    const first = imgs[0];
    if (first) {
      stage.innerHTML = /\.(mp4|webm)$/i.test(first.rel)
        ? '<video src="' + esc(first.rel) + '" controls autoplay style="width:100%"></video>'
        : '<img src="' + esc(first.rel) + '" />';
    }
    outs.innerHTML = imgs.length
      ? imgs.map((im, i) => '<div class="card" data-shot="' + i + '" style="padding:8px;cursor:pointer">' +
          (/\.(mp4|webm)$/i.test(im.rel) ? '<video src="' + esc(im.rel) + '" muted style="width:100%;border-radius:8px"></video>' : '<img src="' + esc(im.rel) + '" style="width:100%;border-radius:8px" />') +
          '<div style="font-size:11px;color:var(--muted);margin-top:6px">' + esc(im.label || ('#' + (i + 1))) + '</div></div>').join('')
      : '<div style="color:var(--dim);font-size:12.5px">暂无</div>';
    outs.querySelectorAll('[data-shot]').forEach((el) => el.addEventListener('click', () => {
      const im = imgs[Number(el.getAttribute('data-shot'))];
      if (!im) return;
      stage.innerHTML = /\.(mp4|webm)$/i.test(im.rel)
        ? '<video src="' + esc(im.rel) + '" controls autoplay style="width:100%"></video>'
        : '<img src="' + esc(im.rel) + '" />';
    }));
  };

  runBtn.addEventListener('click', async () => {
    const body = { assetId: (view.querySelector('#src') || {}).value || '' };
    const F = FORMS[cap] || { fields: [] };
    for (const f of F.fields) {
      const el = view.querySelector('#f_' + f.k);
      if (!el) continue;
      body[f.k] = f.t === 'number' ? Number(el.value) : el.value;
    }
    if (!body.assetId) return toast('先选视频素材', 'err');
    if (cap === 'local-repaint' && !String(body.prompt || '').trim()) return toast('写一段重拍描述', 'err');

    runBtn.disabled = true; runBtn.textContent = '提交中…';
    extra.innerHTML = '';
    try {
      const row = await api('/api/vpost/' + cap, { method: 'POST', body });
      runBtn.textContent = '处理中…';
      const tid = row && (row.id || (row.task && row.task.id));
      if (!tid) throw new Error('任务创建失败');
      pollTask(tid, (tk) => {
        const p = tk.progress || 0;
        bar.innerHTML = '<div class="progress" style="flex:1"><i style="width:' + p + '%"></i></div><span style="color:var(--muted)">' + esc(tk.step || statusLabel(tk.status)) + ' · ' + p + '%</span>';
        if (tk.status === 'done') {
          runBtn.disabled = false; runBtn.textContent = '再次生成';
          const r = tk.result || {};
          showOut(r);
          const n = (r.images || []).length;
          bar.innerHTML = '<span style="color:var(--ok)">完成</span><span>' + n + ' 个结果</span>' +
            '<button class="ghost tiny" id="dl">下载</button><button class="ghost tiny" id="all">全部打开</button>';
          const dl = bar.querySelector('#dl');
          const f0 = (r.images || [])[0];
          if (dl && f0) dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = f0.rel; a.download = ''; a.click(); });
          const all = bar.querySelector('#all');
          if (all) all.addEventListener('click', () => (r.images || []).forEach((im) => window.open(im.rel, '_blank')));
          if (r.shots && r.shots.length) {
            extra.innerHTML = '<div class="section-title">拉片结果 · ' + r.shots.length + ' 段 / ' + (r.cuts || 0) + ' 个切点 / ' + (r.duration || 0) + 's</div>' +
              '<table class="tbl"><thead><tr><th>镜号</th><th>时间</th><th>时长</th><th>景别</th></tr></thead><tbody>' +
              r.shots.map((s) => '<tr><td>' + esc(s.no) + '</td><td>' + s.from.toFixed(1) + 's – ' + s.to.toFixed(1) + 's</td><td>' + s.dur.toFixed(1) + 's</td><td>' + esc(s.size) + '</td></tr>').join('') +
              '</tbody></table>';
          }
          if (cap === 'local-repaint' && r.segments !== undefined) {
            extra.innerHTML = '<div class="chip ok">共拼接 ' + r.segments + ' 段</div>';
          }
        }
        if (tk.status === 'failed') {
          runBtn.disabled = false; runBtn.textContent = '重试';
          bar.innerHTML = '<span style="color:var(--err)">失败</span><span>' + esc(tk.error || '') + '</span>';
          toast('处理失败：' + (tk.error || ''), 'err');
        }
      });
    } catch (e) {
      runBtn.disabled = false; runBtn.textContent = '生成';
      toast(e.message, 'err');
    }
  });
}
