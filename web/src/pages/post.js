import { api, esc, toast, pollTask, statusLabel } from '../lib.js';
import { STYLES } from '../tools-spec.js';

/* 图片后期 / 视频统一 —— 11 项能力共用一套表单引擎 */

const RATIOS = [['original', '原图比例'], ['16:9', '16:9 横屏'], ['9:16', '9:16 竖屏'], ['1:1', '1:1 方形'],
  ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['21:9', '21:9 宽银幕'], ['2.39:1', '2.39:1 电影']];
const FOCUS = [['center', '居中'], ['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']];
const LIGHT = [['cinematic', '电影级光影矫正'], ['golden', '黄金时刻侧光'], ['moon', '月夜冷光'],
  ['rim', '轮廓光'], ['soft', '柔光棚拍'], ['noir', '黑金低调']];
const EXPRS = [['neutral', '自然'], ['smile', '微笑'], ['laugh', '大笑'], ['surprise', '惊讶'], ['angry', '愤怒'], ['sad', '悲伤'], ['cold', '冷峻']];
const VIEWSETS = [['all', '全部 9 个视角'], ['front3', '正面 / 左前 / 右前'], ['side', '左 / 正 / 右'], ['back3', '后方三视角'], ['top', '俯视']];

const FORMS = {
  'crop': { title: '裁剪', need: 'image', desc: '按目标比例重新构图，可指定缩放与取景重心', fields: [
    { k: 'ratio', t: 'select', label: '目标比例', opts: RATIOS, v: '16:9' },
    { k: 'zoom', t: 'number', label: '缩放（1–4）', v: 1, min: 1, max: 4, step: 0.1 },
    { k: 'focus', t: 'select', label: '取景重心', opts: FOCUS, v: 'center' }] },
  'outpaint': { title: '扩图', need: 'image', desc: '向外延展画布，镜像采样 + 模糊 + 羽化接缝', fields: [
    { k: 'pad', t: 'number', label: '外扩比例 %（5–100）', v: 25, min: 5, max: 100 },
    { k: 'blend', t: 'number', label: '接缝融合（0–1）', v: 0.5, min: 0, max: 1, step: 0.05 }] },
  'grid-split': { title: '宫格切分', need: 'image', desc: '切成 4/9/16/25 宫格，或自定义行列，可只导出选中格', fields: [
    { k: 'count', t: 'select', label: '切分方式', opts: [['4', '4 宫格 2×2'], ['9', '9 宫格 3×3'], ['16', '16 宫格 4×4'], ['25', '25 宫格 5×5']], v: '9' },
    { k: 'indices', t: 'text', label: '只导出指定格（留空=全部）', v: '', ph: '例如 1,3,5' }] },
  'multi-angle': { title: '多角度', need: 'image', desc: '圆柱投影重建相机，一次生成最多 9 个机位', fields: [
    { k: 'views', t: 'select', label: '视角组合', opts: VIEWSETS, v: 'all' },
    { k: 'elevation', t: 'number', label: '俯仰角（度）', v: 0, min: -40, max: 40 },
    { k: 'distance', t: 'number', label: '机位距离（0.6–2）', v: 1, min: 0.6, max: 2, step: 0.05 }] },
  'panorama': { title: '全景', need: 'image', desc: '生成 360°/720° 等距柱状全景图', fields: [
    { k: 'turns', t: 'select', label: '覆盖范围', opts: [['1', '360° 全景'], ['2', '720° 全景']], v: '1' },
    { k: 'elevation', t: 'number', label: '俯仰补偿', v: 0, min: -30, max: 30 }] },
  'story-grid': { title: '剧情推演', need: 'prompt', desc: '按一段描述推演分镜网格，逐格生成本地画面', fields: [
    { k: 'prompt', t: 'textarea', label: '剧情或画面描述', v: '', ph: '例如：雨夜天台，主角回头看见追兵，紧接追逐与坠落' },
    { k: 'cols', t: 'number', label: '列数（2–5）', v: 3, min: 2, max: 5 },
    { k: 'rows', t: 'number', label: '行数（2–5）', v: 3, min: 2, max: 5 },
    { k: 'style', t: 'select', label: '风格', opts: STYLES, v: STYLES[0][0] }] },
  'line-art': { title: '抽帧转线稿', need: 'video', desc: '抽一帧做边缘检测，转成线稿参考图', fields: [
    { k: 'at', t: 'text', label: '取帧位置（last 或秒数）', v: 'last' },
    { k: 'mode', t: 'select', label: '输出', opts: [['line', '线稿'], ['raw', '原帧']], v: 'line' }] },
  'palette': { title: '调色板', need: 'any', desc: '提取 8 个主色并生成色卡条', fields: [] },
  'annotate': { title: '标注', need: 'image', desc: '画框、箭头与中文标签，用于分镜批注', fields: [
    { k: 'title', t: 'text', label: '标题（可选）', v: '' },
    { k: 'boxes', t: 'textarea', label: '框选（每行：x,y,w,h,标签；x/y 为百分比）', v: '12,14,34,46,主角', ph: '12,14,34,46,主角\n60,30,26,40,对手' },
    { k: 'color', t: 'text', label: '线条颜色', v: '#ffd166' }] },
  'relight': { title: '打光矫正', need: 'image', desc: '重新分配光影，6 种预设灯位', fields: [
    { k: 'mode', t: 'select', label: '光照预设', opts: LIGHT, v: 'cinematic' },
    { k: 'strength', t: 'number', label: '强度（0–1）', v: 0.7, min: 0, max: 1, step: 0.05 },
    { k: 'from', t: 'select', label: '光源方向', opts: [['topLeft', '左上'], ['topRight', '右上'], ['bottomLeft', '左下'], ['bottomRight', '右下']], v: 'topLeft' }] },
  'eraser': { title: '消除笔', need: 'image', desc: '框出多余元素，用邻域扩散自动填补', fields: [
    { k: 'regions', t: 'textarea', label: '涂抹区域（每行：x,y,w,h；中心点与宽高均为百分比）', v: '50,50,24,24', ph: '50,50,24,24' }] },
  'view-grid': { title: '4/12 视图', need: 'image', desc: '把多个视角拼成一张联系表', fields: [
    { k: 'count', t: 'select', label: '视图数', opts: [['4', '4 视图'], ['12', '12 视图']], v: '4' },
    { k: 'distance', t: 'number', label: '机位距离（0.6–2）', v: 1, min: 0.6, max: 2, step: 0.05 }] },
  'image-upscale': { title: '图片超清', need: 'image', desc: 'Lanczos 放大 + unsharp 锐化', fields: [
    { k: 'scale', t: 'number', label: '放倍数（1.2–4）', v: 2, min: 1.2, max: 4, step: 0.1 },
    { k: 'sharpen', t: 'number', label: '锐化强度（0–2）', v: 0.6, min: 0, max: 2, step: 0.1 }] },
  'expression': { title: '表情控制', need: 'image', desc: '框选人脸后按预设调整表情（嘴角上扬、张口、眉眼联动）', fields: [
    { k: 'expr', t: 'select', label: '表情', opts: EXPRS, v: 'smile' },
    { k: 'strength', t: 'number', label: '强度（0.2–2）', v: 1, min: 0.2, max: 2, step: 0.1 },
    { k: 'box', t: 'text', label: '人脸框 x,y,w,h（百分比，留空=自动）', v: '22,8,56,52' }] },
  'unify-video': { title: '帧率时长统一', need: 'video', desc: '统一分辨率、帧率与时长，便于拼接', fields: [
    { k: 'width', t: 'number', label: '宽', v: 1280, min: 160, max: 3840 },
    { k: 'height', t: 'number', label: '高', v: 720, min: 160, max: 2160 },
    { k: 'fps', t: 'number', label: '帧率（12–60）', v: 25, min: 12, max: 60 },
    { k: 'seconds', t: 'number', label: '时长秒（0=保持）', v: 0, min: 0, max: 120 }] },
};

let cache = { assets: [] };
const assetOf = (id) => cache.assets.find((a) => a.id === id);

function fieldHtml(f, id) {
  const fid = 'f_' + f.k;
  if (f.t === 'select') {
    return '<label class="field">' + esc(f.label) + '<select id="' + fid + '">' +
      f.opts.map((o) => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(f.v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>';
  }
  if (f.t === 'textarea') {
    return '<label class="field">' + esc(f.label) + '<textarea id="' + fid + '" placeholder="' + esc(f.ph || '') + '">' + esc(f.v || '') + '</textarea></label>';
  }
  const attrs = (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') +
    (f.step !== undefined ? ' step="' + f.step + '"' : '');
  const type = f.t === 'number' ? 'number' : 'text';
  return '<label class="field">' + esc(f.label) + '<input id="' + fid + '" type="' + type + '" value="' + esc(f.v === undefined ? '' : f.v) + '"' + attrs +
    (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + ' /></label>';
}

function assetOptions(need) {
  const list = cache.assets.filter((a) => need === 'any' ? (a.kind === 'image' || a.kind === 'video') : a.kind === need);
  return '<option value="">— 选择素材 —</option>' + list.map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
}

function formHtml(cap) {
  const F = FORMS[cap];
  if (!F) return '';
  return (F.need === 'prompt' ? '' :
    '<label class="field">源素材<select id="src">' + assetOptions(F.need) + '</select></label>') +
    F.fields.map((f) => fieldHtml(f)).join('');
}

export async function render() {
  const [caps, as] = await Promise.all([api('/api/post/caps'), api('/api/assets?limit=200')]);
  cache.assets = as.list || [];
  const list = caps.list || [];
  const first = list.length ? list[0].key : 'crop';
  return [
    '<div class="page-head">',
    '  <div><h1>图片后期</h1><p>裁剪 · 扩图 · 宫格 · 多角度 · 全景 · 剧情推演 · 线稿 · 调色板 · 标注 · 打光 · 表情 · 视频统一</p></div>',
    '  <div class="spacer"></div><span class="chip ok">全部能力免费</span>',
    '</div>',
    '<div class="studio">',
    '  <div class="panel">',
    '    <h3>选择能力</h3>',
    '    <div class="row" id="caps" style="gap:6px">' + list.map((c, i) =>
      '<button class="ghost tiny' + (i === 0 ? ' on' : '') + '" data-cap="' + esc(c.key) + '" style="' + (i === 0 ? 'border-color:var(--brand);color:var(--brand)' : '') + '">' + esc(c.label) + '</button>').join('') + '</div>',
    '    <div id="cap-desc" style="font-size:11.5px;color:var(--dim);line-height:1.7">' + esc((list[0] || {}).desc || '') + '</div>',
    '    <div id="form">' + formHtml(first) + '</div>',
    '    <button class="primary" id="run">生成</button>',
    '    <div style="font-size:11.5px;color:var(--dim);line-height:1.7">所有结果自动登记到资产库，可直接在分镜、画布、导演台里继续使用。</div>',
    '  </div>',
    '  <div>',
    '    <div class="stage" id="stage"><div class="placeholder">选一个能力，结果会出现在这里</div></div>',
    '    <div class="stage-bar" id="bar"><span style="color:var(--dim)">就绪</span></div>',
    '    <div class="section-title">输出结果</div>',
    '    <div class="grid g4" id="outs"><div style="color:var(--dim);font-size:12.5px">暂无</div></div>',
    '  </div>',
    '</div>',
  ].join('');
}

export async function mount(view) {
  const stage = view.querySelector('#stage');
  const bar = view.querySelector('#bar');
  const outs = view.querySelector('#outs');
  const capBox = view.querySelector('#caps');
  const formBox = view.querySelector('#form');
  const descBox = view.querySelector('#cap-desc');
  const runBtn = view.querySelector('#run');
  let cap = (capBox.querySelector('[data-cap]') || {}).getAttribute ? capBox.querySelector('[data-cap]').getAttribute('data-cap') : 'crop';

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
    const meta = (FORMS[cap] || {});
    descBox.textContent = meta.desc || '';
  });

  const showOut = (r) => {
    const imgs = (r && r.images) || [];
    const first = imgs[0];
    if (first) {
      const rel = first.rel;
      stage.innerHTML = /\.(mp4|webm)$/i.test(rel)
        ? '<video src="' + esc(rel) + '" controls autoplay style="width:100%"></video>'
        : '<img src="' + esc(rel) + '" />';
    }
    outs.innerHTML = imgs.length
      ? imgs.map((im, i) => '<div class="card" data-shot="' + i + '" style="padding:8px;cursor:pointer">' +
          (/\.(mp4|webm)$/i.test(im.rel) ? '<video src="' + esc(im.rel) + '" muted style="width:100%;border-radius:8px"></video>' : '<img src="' + esc(im.rel) + '" style="width:100%;border-radius:8px" />') +
          '<div style="font-size:11px;color:var(--muted);margin-top:6px">' + esc(im.label || ('#' + (im.index || i + 1))) + '</div></div>').join('')
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
    const body = { cap, assetId: (view.querySelector('#src') || {}).value || '' };
    const F = FORMS[cap] || { fields: [] };
    for (const f of F.fields) {
      const el = view.querySelector('#f_' + f.k);
      if (!el) continue;
      let v = el.value;
      if (f.t === 'number') v = Number(v);
      if (f.k === 'indices' && v) v = String(v).split(/[,\s]+/).map(Number).filter((n) => n > 0);
      if (f.k === 'regions' && v) {
        v = String(v).split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
          const p = ln.split(',');
          return { x: Number(p[0]) || 50, y: Number(p[1]) || 50, w: Number(p[2]) || 20, h: Number(p[3]) || 20 };
        });
      }
      if (f.k === 'box' && v) {
        const p = String(v).split(',');
        v = { x: Number(p[0]) || 22, y: Number(p[1]) || 8, w: Number(p[2]) || 56, h: Number(p[3]) || 52 };
      }
      if (f.k === 'boxes' && v) {
        v = String(v).split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
          const p = ln.split(',');
          return { x: Number(p[0]) || 0, y: Number(p[1]) || 0, w: Number(p[2]) || 10, h: Number(p[3]) || 10, label: (p[4] || '').trim() };
        });
      }
      body[f.k] = v;
    }
    if (F.need !== 'prompt' && !body.assetId) return toast('先选素材', 'err');
    if (F.need === 'prompt' && !String(body.prompt || '').trim()) return toast('先写剧情描述', 'err');

    runBtn.disabled = true; runBtn.textContent = '提交中…';
    try {
      const row = await api('/api/post/' + cap, { method: 'POST', body });
      runBtn.textContent = '生成中…';
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
          const first = (r.images || [])[0];
          if (dl && first) dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = first.rel; a.download = ''; a.click(); });
          const all = bar.querySelector('#all');
          if (all) all.addEventListener('click', () => (r.images || []).forEach((im) => window.open(im.rel, '_blank')));
        }
        if (tk.status === 'failed') {
          runBtn.disabled = false; runBtn.textContent = '重试';
          bar.innerHTML = '<span style="color:var(--err)">失败</span><span>' + esc(tk.error || '') + '</span>';
          toast('生成失败：' + (tk.error || ''), 'err');
        }
      });
    } catch (e) {
      runBtn.disabled = false; runBtn.textContent = '生成';
      toast(e.message, 'err');
    }
  });
}
