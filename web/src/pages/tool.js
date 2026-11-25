
import { api, esc, toast, openModal, closeModal, pollTask, pickFile, uploadFile, fmtTime } from '../lib.js';
import { TOOL_BY_ID, STYLES, PALETTES, sizeOf } from '../tools-spec.js';
import { showTaskDetail, statusLabel } from '../app.js';

export async function render(params) {
  const t = TOOL_BY_ID[params.toolId];
  if (!t) return '<div class="empty">工具不存在</div>';
  const [assetsRes, voicesRes] = await Promise.all([
    api('/api/assets?limit=60'),
    api('/api/voices').catch(() => ({ list: [] })),
  ]);
  const assets = assetsRes.list || [];
  const voices = (voicesRes && voicesRes.list) || [];
  return [
    '<div class="page-head">',
    '  <div><h1>' + t.icon + ' ' + esc(t.title) + '</h1><p>' + esc(t.desc) + '</p></div>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel" id="form-panel">',
    '    <h3>参数</h3>',
    formHtml(t, assets, voices),
    '    <button class="primary" id="run-btn" style="margin-top:4px">开始生成</button>',
    '    <div style="font-size:11.5px;color:var(--dim);line-height:1.7">本地引擎执行，不消耗额度。生成结果自动进入资产库。</div>',
    '  </div>',
    '  <div>',
    '    <div class="stage" id="stage"><div class="placeholder">生成结果会出现在这里</div></div>',
    '    <div class="stage-bar" id="stage-bar"><span style="color:var(--dim)">就绪</span></div>',
    '    <div id="result-info" style="margin-top:12px"></div>',
    '    <div class="section-title">最近素材</div>',
    '    <div class="grid g4" id="recent">' + assets.slice(0, 8).map((a) => mini(a)).join('') + '</div>',
    '  </div>',
    '</div>',
  ].join('');
}

function mini(a) {
  const inner = a.kind === 'video'
    ? '<video src="' + esc(a.rel) + '" muted preload="metadata"></video>'
    : a.kind === 'audio' ? '<div style="font-size:20px">♪</div>' : '<img src="' + esc(a.thumb || a.rel) + '" loading="lazy" />';
  return '<div class="asset-card" data-pick="' + a.id + '" style="cursor:pointer"><div class="asset-thumb">' + inner + '</div>' +
    '<div class="asset-meta"><div class="t">' + esc(a.name) + '</div><div class="s">' + (a.kind || '') + '</div></div></div>';
}

function formHtml(t, assets, voices) {
  return t.fields.map((f) => {
    const nm = ' name="' + f.name + '"';
    if (f.type === 'textarea') {
      return '<label class="field">' + esc(f.label) + (f.required ? ' *' : '') +
        '<textarea' + nm + ' placeholder="' + esc(f.ph || '') + '" rows="3"></textarea></label>';
    }
    if (f.type === 'select') {
      return '<label class="field">' + esc(f.label) + '<select' + nm + '>' +
        f.options.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === f.value ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
        '</select></label>';
    }
    if (f.type === 'number') {
      return '<label class="field">' + esc(f.label) + '<input type="number"' + nm + ' value="' + (f.value == null ? '' : f.value) + '"' +
        (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.step ? ' step="' + f.step + '"' : '') + '></label>';
    }
    if (f.type === 'switch') {
      return '<label class="switch"><input type="checkbox"' + nm + (f.value ? ' checked' : '') + ' /> ' + esc(f.label) + '</label>';
    }
    if (f.type === 'voice') {
      const vs = (voices && voices.length) ? voices : [{ id: 'zh-CN', name: '中文女声 · 慧慧' }, { id: 'en-US', name: 'English · Zira' }];
      return '<label class="field">' + esc(f.label) + '<select' + nm + '>' +
        vs.map((v) => '<option value="' + esc(v.id) + '"' + (v.id === 'zh-CN' ? ' selected' : '') + '>' + esc(v.name) + (v.engine ? ' · ' + esc(v.engine) : '') + '</option>').join('') +
        '</select></label>';
    }
    if (f.type === 'detect') {
      return '<div class="field"><span>' + esc(f.label) + '</span>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
        '<button type="button" class="ghost tiny" id="detect-btn">自动检测字幕区域</button>' +
        '<span id="detect-hint" style="font-size:11.5px;color:var(--dim)">先选视频再检测</span></div></div>';
    }
    if (f.type === 'style') {
      return '<label class="field">风格<select name="style">' + STYLES.map((s) => '<option value="' + s[0] + '">' + esc(s[1]) + '</option>').join('') + '</select></label>';
    }
    if (f.type === 'palette') {
      return '<label class="field">色调<select name="palette"><option value="">智能配色</option>' + PALETTES.map((p) => '<option value="' + p + '">' + p + '</option>').join('') + '</select></label>';
    }
    if (f.type === 'asset' || f.type === 'assets') {
      const multi = f.type === 'assets';
      const list = assets.filter((a) => !f.accept || a.kind === f.accept);
      return '<div class="field"><span>' + esc(f.label) + (f.required ? ' *' : '') + '</span>' +
        '<select name="' + f.name + '" data-asset-select="' + (f.accept || '') + '"' + (multi ? ' multiple size="4"' : '') + '>' +
        '<option value="">' + (multi ? '（可多选，按住 Ctrl）' : '— 选择素材 —') + '</option>' +
        list.map((a) => '<option value="' + a.id + '">' + esc(a.name) + ' · ' + (a.kind || '') + '</option>').join('') +
        '</select>' +
        '<button type="button" class="ghost tiny" data-upload="' + (f.accept || '') + '" style="align-self:flex-start">上传新素材</button>' +
        '</div>';
    }
    return '<label class="field">' + esc(f.label) + (f.required ? ' *' : '') +
      '<input type="' + (f.type === 'text' ? 'text' : 'text') + '"' + nm + ' placeholder="' + esc(f.ph || '') + '" value="' + esc(f.value || '') + '" /></label>';
  }).join('');
}

const FIELD_MAP = {
  'text-to-video': { count: 'count', duration: 'duration', prompt: 'prompt' },
  'text-to-image': { count: 'count', prompt: 'prompt', title: 'title', subtitle: 'subtitle' },
};

function bodyFor(toolId, form) {
  const b = { ...form };
  if (b.sourceAssetId) b.assetId = b.sourceAssetId;
  if (b.sourceAssetIds) {
    b.assetIds = Array.from(document.querySelectorAll('[name="sourceAssetIds"] option:checked')).map((o) => o.value).filter(Boolean);
  }
  if (b.audioAssetId) b.audioId = b.audioAssetId;
  if (b.extend) b.seconds = Number(b.extend);
  if (b.ratio) {
    const [w, h] = sizeOf(b.ratio);
    b.width = w; b.height = h;
  }
  if (b.extend === undefined && b.seconds === undefined && form.extend !== undefined) b.seconds = Number(form.extend);
  if (toolId === 'video-extend' && !b.seconds) b.seconds = Number(form.extend || 4);
  Object.keys(b).forEach((k) => { if (b[k] === '') delete b[k]; });
  return b;
}

export async function mount(view, params) {
  const t = TOOL_BY_ID[params.toolId];
  const stage = view.querySelector('#stage');
  const bar = view.querySelector('#stage-bar');
  const info = view.querySelector('#result-info');
  const panel = view.querySelector('#form-panel');

  view.querySelectorAll('[data-upload]').forEach((btn) => btn.addEventListener('click', async () => {
    const accept = btn.getAttribute('data-upload');
    const file = await pickFile(accept === 'image' ? 'image/*' : accept === 'video' ? 'video/*' : accept === 'audio' ? 'audio/*' : '');
    if (!file) return;
    try {
      const a = await uploadFile(file);
      toast('已上传：' + a.name, 'ok');
      const sel = btn.previousElementSibling;
      const o = document.createElement('option');
      o.value = a.id; o.textContent = a.name + ' · ' + a.kind;
      o.selected = true;
      sel.appendChild(o);
    } catch (e) { toast('上传失败：' + e.message, 'err'); }
  }));

  const detectBtn = view.querySelector('#detect-btn');
  if (detectBtn) detectBtn.addEventListener('click', async () => {
    const sel = panel.querySelector('select[data-asset-select]');
    const id = sel && sel.value;
    const hint = view.querySelector('#detect-hint');
    if (!id) return toast('请先选择源视频', 'err');
    detectBtn.disabled = true; detectBtn.textContent = '检测中…';
    try {
      const r = await api('/api/erase/detect', { method: 'POST', body: { assetId: id } });
      const bd = r.band;
      const set = (n, v) => { const el = panel.querySelector('[name="' + n + '"]'); if (el) el.value = Math.round(v * 10) / 10; };
      set('x', bd.x); set('y', bd.y); set('w', bd.w); set('h', bd.h);
      const modeSel = panel.querySelector('[name="mode"]');
      if (modeSel) modeSel.value = 'fixed';
      if (hint) hint.textContent = '检测到 ' + bd.frames + ' 帧，字幕带 y=' + bd.y.toFixed(1) + '% h=' + bd.h.toFixed(1) + '%（信度 ' + bd.confidence + '）';
      toast('已填入检测区域', 'ok');
    } catch (e) { if (hint) hint.textContent = '未检测到，请手动填区域'; toast(e.message, 'err'); }
    detectBtn.disabled = false; detectBtn.textContent = '自动检测字幕区域';
  });
  view.querySelectorAll('#recent [data-pick]').forEach((c) => c.addEventListener('click', () => {
    const id = c.getAttribute('data-pick');
    const sel = panel.querySelector('select[data-asset-select]');
    if (!sel) return toast('这个工具不需要选素材');
    let opt = Array.from(sel.options).find((o) => o.value === id);
    if (!opt) {
      const src = c.querySelector('img,video');
      opt = document.createElement('option');
      opt.value = id; opt.textContent = '已选素材'; sel.appendChild(opt);
    }
    [].forEach.call(sel.options, (o) => { o.selected = false; });
    opt.selected = true;
    toast('已选中素材');
  }));

  view.querySelector('#run-btn').addEventListener('click', async () => {
    const form = {};
    panel.querySelectorAll('[name]').forEach((n) => {
      if (n.tagName === 'SELECT' && n.multiple) return;
      form[n.name] = n.type === 'checkbox' ? n.checked : n.value;
    });
    if (t.fields.some((f) => f.name === 'sourceAssetIds')) {
      form.sourceAssetIds = Array.from(panel.querySelectorAll('[name="sourceAssetIds"] option:checked')).map((o) => o.value).filter(Boolean);
    }
    const missing = t.fields.filter((f) => f.required && !form[f.name]);
    if (missing.length) return toast('请填写：' + missing.map((m) => m.label).join('、'), 'err');
    const body = bodyFor(t.id, form);
    const btn = view.querySelector('#run-btn');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const task = await api('/api/tools/' + t.id, { method: 'POST', body });
      btn.textContent = '生成中…';
      bar.innerHTML = '<div class="progress" style="flex:1"><i style="width:6%"></i></div><span style="color:var(--muted)">已提交</span>';
      const stop = pollTask(task.id, (tk) => {
        const p = tk.progress || 0;
        bar.innerHTML = '<div class="progress" style="flex:1"><i style="width:' + p + '%"></i></div>' +
          '<span style="color:var(--muted)">' + esc(tk.step || statusLabel(tk.status)) + ' · ' + p + '%</span>' +
          (tk.status === 'running' || tk.status === 'queued' ? '<button class="subtle tiny" id="cancel-btn">取消</button>' : '');
        const cb = bar.querySelector('#cancel-btn');
        if (cb) cb.addEventListener('click', async () => { await api('/api/tasks/' + tk.id + '/cancel', { method: 'POST' }); });
        if (tk.status === 'done') { stop(); done(tk); }
        if (tk.status === 'failed') { stop(); btn.disabled = false; btn.textContent = '重新生成'; toast('生成失败：' + (tk.error || ''), 'err'); }
      });
    } catch (e) {
      btn.disabled = false; btn.textContent = '开始生成';
      toast(e.message, 'err');
    }
  });

  function done(tk) {
    const btn = view.querySelector('#run-btn');
    btn.disabled = false; btn.textContent = '再次生成';
    const r = tk.result || {};
    const items = r.images && r.images.length ? r.images : (r.rel ? [r] : []);
    if (!items.length) { bar.innerHTML = '<span>完成，但没有返回媒体</span>'; return; }
    const first = items[0];
    if (/\.(mp4|webm)$/i.test(first.rel)) {
      stage.innerHTML = '<video src="' + esc(first.rel) + '" controls autoplay loop style="width:100%"></video>';
    } else if (/\.(mp3|wav|m4a)$/i.test(first.rel)) {
      stage.innerHTML = '<div style="padding:40px;width:100%"><audio src="' + esc(first.rel) + '" controls autoplay style="width:100%"></audio></div>';
    } else {
      stage.innerHTML = '<img src="' + esc(first.rel) + '" />';
    }
    bar.innerHTML = '<span style="color:var(--ok)">完成</span>' +
      '<span style="color:var(--dim)">' + (r.duration ? r.duration.toFixed(1) + 's · ' : '') + items.length + ' 个结果</span>' +
      '<button class="ghost tiny" data-dl>下载</button>' +
      '<button class="ghost tiny" data-assets>资产库</button>';
    bar.querySelector('[data-dl]').addEventListener('click', () => {
      items.forEach((x, i) => setTimeout(() => {
        const a = document.createElement('a'); a.href = x.rel; a.download = ''; a.click();
      }, i * 300));
    });
    bar.querySelector('[data-assets]').addEventListener('click', () => { location.hash = '#/assets'; });
    info.innerHTML = items.length > 1
      ? '<div class="grid g4">' + items.map((x, i) => /\.(png|jpg|jpeg|webp)$/i.test(x.rel)
          ? '<div class="asset-card"><div class="asset-thumb"><img src="' + esc(x.rel) + '" /></div><div class="asset-meta"><div class="t">结果 ' + (i + 1) + '</div></div></div>'
          : '').join('') + '</div>'
      : (r.script ? '<div class="card"><h3>' + esc(r.script.title || '') + '</h3><p>' + esc(r.script.logline || '') + '</p></div>' : '');
    loadRecent(view);
    toast('生成完成', 'ok');
  }

  async function loadRecent(v) {
    try {
      const d = await api('/api/assets?limit=12');
      const box = v.querySelector('#recent');
      if (box) box.innerHTML = (d.list || []).slice(0, 8).map((a) => mini(a)).join('');
    } catch {}
  }
}