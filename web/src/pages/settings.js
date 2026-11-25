
import { api, esc, toast, ensureSettings, saveSettings, fmtTime } from '../lib.js';

export async function render() {
  const d = await api('/api/settings');
  const s = d.settings || {};
  const llm = s.llm || {};
  const eng = s.engine || {};
  const def = s.defaults || {};
  return [
    '<div class="page-head"><div><h1>设置</h1><p>全部数据保存在本机，无账号、无订阅、无额度上限</p></div></div>',
    '<div class="grid g2">',
    '<div class="card">',
    '  <h3>站点</h3>',
    '  <label class="field">站点名<input id="sn" type="text" value="' + esc(s.siteName || '') + '" /></label>',
    '  <label class="field" style="margin-top:10px">副标题<input id="ss" type="text" value="' + esc(s.siteSub || '') + '" /></label>',
    '</div>',
    '<div class="card">',
    '  <h3>渲染引擎</h3>',
    '  <div class="row">',
    '    <label class="field">默认宽<input id="ew" type="number" value="' + (eng.imageWidth || 1280) + '" /></label>',
    '    <label class="field">默认高<input id="eh" type="number" value="' + (eng.imageHeight || 720) + '" /></label>',
    '    <label class="field">帧率<input id="ef" type="number" value="' + (eng.fps || 24) + '" /></label>',
    '    <label class="field">并发<input id="ec" type="number" min="1" max="6" value="' + (eng.concurrency || 2) + '" /></label>',
    '  </div>',
    '  <label class="field" style="margin-top:10px;flex-direction:row;align-items:center;gap:8px"><input id="wm" type="checkbox" ' + (eng.watermark ? 'checked' : '') + ' style="width:auto" />输出水印</label>',
    '</div>',
    '</div>',
    '<div class="section-title">大模型（可选）</div>',
    '<div class="card">',
    '  <p style="color:var(--muted);font-size:12.5px;margin-top:0">留空则使用内置离线编剧引擎。填入任意 OpenAI 兼容接口即可获得更强的剧本与小说理解能力。</p>',
    '  <label class="field">Base URL<input id="lu" type="text" placeholder="https://api.openai.com/v1" value="' + esc(llm.baseUrl || '') + '" /></label>',
    '  <div class="row" style="margin-top:10px">',
    '    <label class="field" style="flex:1">API Key<input id="lk" type="password" value="' + esc(llm.apiKey || '') + '" /></label>',
    '    <label class="field" style="flex:1">模型<input id="lm" type="text" placeholder="gpt-4o-mini" value="' + esc(llm.model || '') + '" /></label>',
    '    <label class="field">温度<input id="lt" type="number" step="0.1" min="0" max="2" value="' + (llm.temperature == null ? 0.8 : llm.temperature) + '" /></label>',
    '  </div>',
    '  <div id="llm-state" style="margin-top:10px;font-size:12px;color:' + (d.llmEnabled ? 'var(--ok)' : 'var(--dim)') + '">' +
      (d.llmEnabled ? '已启用大模型' : '当前使用内置离线引擎') + '</div>',
    '</div>',
    '<div class="section-title">默认参数</div>',
    '<div class="card"><div class="row">',
    '  <label class="field">画幅<select id="dr"><option' + (def.ratio === '16:9' ? ' selected' : '') + '>16:9</option><option' + (def.ratio === '9:16' ? ' selected' : '') + '>9:16</option><option' + (def.ratio === '1:1' ? ' selected' : '') + '>1:1</option><option' + (def.ratio === '4:3' ? ' selected' : '') + '>4:3</option></select></label>',
    '  <label class="field">时长<input id="dd" type="number" value="' + (def.duration || 5) + '" /></label>',
    '</div></div>',
    '<div style="display:flex;gap:10px;margin-top:16px"><button class="primary" id="save">保存设置</button><button class="ghost" id="reset">恢复默认</button></div>',
  ].join('');
}

export async function mount(view) {
  view.querySelector('#save').addEventListener('click', async () => {
    const patch = {
      settings: {
        siteName: view.querySelector('#sn').value,
        siteSub: view.querySelector('#ss').value,
        llm: {
          baseUrl: view.querySelector('#lu').value.trim(),
          apiKey: view.querySelector('#lk').value.trim(),
          model: view.querySelector('#lm').value.trim(),
          temperature: Number(view.querySelector('#lt').value),
        },
        engine: {
          imageWidth: Number(view.querySelector('#ew').value) || 1280,
          imageHeight: Number(view.querySelector('#eh').value) || 720,
          fps: Number(view.querySelector('#ef').value) || 24,
          concurrency: Number(view.querySelector('#ec').value) || 2,
          watermark: view.querySelector('#wm').checked,
        },
        defaults: {
          ratio: view.querySelector('#dr').value,
          duration: Number(view.querySelector('#dd').value) || 5,
        },
      },
    };
    await api('/api/settings', { method: 'POST', body: patch });
    toast('已保存', 'ok');
  });
  view.querySelector('#reset').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: { settings: { llm: { baseUrl: '', apiKey: '', model: '' }, engine: { concurrency: 2, watermark: false } } } });
    toast('已恢复默认', 'ok');
    location.reload();
  });
}
