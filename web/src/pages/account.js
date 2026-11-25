import { api, esc, toast } from '../lib.js';

/* 账号中心 —— 官方 /user-center、/profile、/user-settings、/setting 的本地版 */

const TABS = [['profile', '资料'], ['storage', '存储与数据'], ['engine', '引擎参数'], ['about', '关于']];

export async function render() {
  const [team, settings, credits, health] = await Promise.all([
    api('/api/team'),
    api('/api/settings'),
    api('/api/credits'),
    api('/api/health'),
  ]);
  const me = (team.members || []).find((m) => m.role === 'owner') || (team.members || [])[0] || {};
  const st = settings.settings || {};
  const eng = st.engine || {};
  return [
    '<div class="page-head">',
    '  <div><h1>账号中心</h1><p>本地账号、存储占用与引擎参数</p></div>',
    '  <div class="spacer"></div><span class="chip ok">无限额度</span><span class="chip">' + esc(health.name || '剧作工坊') + ' v' + esc(String(health.version || 1)) + '</span>',
    '</div>',
    '<div class="grid g4" style="margin-bottom:16px">',
    [
      ['账号', me.name || '本地用户', '☺'],
      ['团队席位', (team.team && team.team.seats) || 10, '☰'],
      ['素材', health.assets || 0, '▩'],
      ['任务累计', health.tasks || 0, '⏱'],
    ].map((c) => '<div class="card"><div style="font-size:11.5px;color:var(--dim)">' + esc(c[0]) + '</div>' +
      '<div style="font-size:22px;font-weight:700;margin-top:4px">' + esc(String(c[1])) + ' <span style="font-size:13px;color:var(--dim)">' + c[2] + '</span></div></div>').join(''),
    '</div>',
    '<div class="tabs-line" id="atabs">' + TABS.map((t, i) =>
      '<button data-at="' + t[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + esc(t[1]) + '</button>').join('') + '</div>',
    '<div id="apanel"></div>',
  ].join('');
}

function profileHtml(me, team) {
  return [
    '<div class="studio" style="grid-template-columns:1fr 1fr">',
    '<div class="panel"><h3>基本资料</h3>',
    '<label class="field">昵称<input id="ac-name" type="text" value="' + esc(me.name || '本地用户') + '" /></label>',
    '<label class="field">邮箱<input id="ac-mail" type="text" value="' + esc(me.email || '') + '" /></label>',
    '<label class="field">角色<input type="text" value="' + esc(me.role || 'owner') + '" disabled /></label>',
    '<button class="primary" id="ac-save">保存资料</button></div>',
    '<div class="panel"><h3>团队</h3>',
    '<div class="st-kv"><span>团队名</span><b>' + esc((team.team && team.team.name) || '') + '</b></div>',
    '<div class="st-kv"><span>席位</span><b>' + esc(String((team.team && team.team.seats) || 0)) + '</b></div>',
    '<div class="st-kv"><span>成员数</span><b>' + esc(String((team.members || []).length)) + '</b></div>',
    '<div class="st-kv"><span>分组数</span><b>' + esc(String((team.groups || []).length)) + '</b></div>',
    '<div style="margin-top:12px"><a class="chip" href="#/team">去团队管理</a></div></div>',
    '</div>',
  ].join('');
}

function storageHtml(credits) {
  const led = (credits.ledger || []).slice(0, 12);
  return [
    '<div class="studio" style="grid-template-columns:1fr 1fr">',
    '<div class="panel"><h3>数据位置</h3>',
    '<div class="st-kv"><span>数据库</span><b>data/db.json</b></div>',
    '<div class="st-kv"><span>图片</span><b>data/media/image</b></div>',
    '<div class="st-kv"><span>视频</span><b>data/media/video</b></div>',
    '<div class="st-kv"><span>音频</span><b>data/media/audio</b></div>',
    '<p style="font-size:11.5px;color:var(--dim);line-height:1.8;margin-top:12px">全部数据留在本机，不上传任何服务器。停服后可直接备份或迁移整个 <code>data/</code> 目录。</p></div>',
    '<div class="panel"><h3>额度流水（最近 12 条）</h3>',
    '<div class="st-kv"><span>累计消耗（记账）</span><b>' + esc(String(credits.used || 0)) + '</b></div>',
    '<div class="st-kv"><span>剩余</span><b>不限</b></div>',
    '<div style="margin-top:10px;font-size:11.5px;color:var(--muted);line-height:2;max-height:220px;overflow:auto">' +
      (led.length ? led.map((l) => '<div>' + esc(String(l.delta)) + ' · ' + esc(l.reason || '') + '</div>').join('') : '<div style="color:var(--dim)">暂无流水</div>') +
    '</div><div style="margin-top:10px"><a class="chip" href="#/team">查看完整流水</a></div></div>',
    '</div>',
  ].join('');
}

function engineHtml(eng, st) {
  return [
    '<div class="studio" style="grid-template-columns:1fr 1fr">',
    '<div class="panel"><h3>渲染参数</h3>',
    '<label class="field">默认宽<input id="en-w" type="number" value="' + esc(String(eng.imageWidth || 1280)) + '" /></label>',
    '<label class="field">默认高<input id="en-h" type="number" value="' + esc(String(eng.imageHeight || 720)) + '" /></label>',
    '<label class="field">帧率<input id="en-fps" type="number" value="' + esc(String(eng.fps || 24)) + '" /></label>',
    '<label class="field">并发任务数<input id="en-cc" type="number" min="1" max="4" value="' + esc(String(eng.concurrency || 2)) + '" /></label>',
    '<button class="primary" id="en-save">保存</button></div>',
    '<div class="panel"><h3>文本生成</h3>',
    '<label class="field">Base URL<input id="en-url" type="text" value="' + esc((st.llm && st.llm.baseUrl) || '') + '" placeholder="留空则用本地引擎" /></label>',
    '<label class="field">模型<input id="en-model" type="text" value="' + esc((st.llm && st.llm.model) || '') + '" /></label>',
    '<label class="field">温度<input id="en-temp" type="number" step="0.1" min="0" max="2" value="' + esc(String((st.llm && st.llm.temperature) || 0.8)) + '" /></label>',
    '<p style="font-size:11.5px;color:var(--dim);line-height:1.8">不填接口时全部剧本与文案由本地引擎生成，离线可用。</p>',
    '<button class="primary" id="llm-save">保存</button></div>',
    '</div>',
  ].join('');
}

function aboutHtml(health) {
  return [
    '<div class="studio" style="grid-template-columns:1fr 1fr">',
    '<div class="panel"><h3>版本</h3>',
    '<div class="st-kv"><span>名称</span><b>' + esc(health.name || '') + '</b></div>',
    '<div class="st-kv"><span>版本</span><b>v' + esc(String(health.version || 1)) + '</b></div>',
    '<div class="st-kv"><span>ffmpeg</span><b>' + (health.ffmpeg ? '可用' : '缺失') + '</b></div>',
    '<div class="st-kv"><span>外部文本模型</span><b>' + (health.llm ? '已配置' : '本地引擎') + '</b></div>',
    '<div class="st-kv"><span>额度</span><b>无限</b></div></div>',
    '<div class="panel"><h3>关于</h3>',
    '<p style="font-size:12px;color:var(--muted);line-height:2">剧作工坊是纯本地运行的影视创作工作台：工具箱 19 项、图片后期 14 项、视频后期 6 项、时间线剪辑台、12 类画布节点，全部依赖本机 ffmpeg 与程序化渲染完成，没有任何云端调用，也没有付费与额度限制。</p>',
    '<div class="row" style="margin-top:12px"><a class="chip" href="#/tutorial">使用教程</a><a class="chip" href="#/mcp">MCP &amp; CLI</a></div></div>',
    '</div>',
  ].join('');
}

export async function mount(view) {
  const panel = view.querySelector('#apanel');
  const [team, settings, credits, health] = await Promise.all([
    api('/api/team'), api('/api/settings'), api('/api/credits'), api('/api/health'),
  ]);
  const st = settings.settings || {};
  const me = (team.members || []).find((m) => m.role === 'owner') || (team.members || [])[0] || {};
  let tab = 'profile';

  function paint() {
    if (tab === 'profile') panel.innerHTML = profileHtml(me, team);
    else if (tab === 'storage') panel.innerHTML = storageHtml(credits);
    else if (tab === 'engine') panel.innerHTML = engineHtml(st.engine || {}, st);
    else panel.innerHTML = aboutHtml(health);

    const sv = panel.querySelector('#ac-save');
    if (sv) sv.addEventListener('click', async () => {
      try {
        await api('/api/team/members/' + me.id, { method: 'POST', body: {
          name: panel.querySelector('#ac-name').value.trim(),
          email: panel.querySelector('#ac-mail').value.trim(),
        } });
        toast('资料已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    const es = panel.querySelector('#en-save');
    if (es) es.addEventListener('click', async () => {
      try {
        await api('/api/settings', { method: 'POST', body: { engine: {
          imageWidth: Number(panel.querySelector('#en-w').value) || 1280,
          imageHeight: Number(panel.querySelector('#en-h').value) || 720,
          fps: Number(panel.querySelector('#en-fps').value) || 24,
          concurrency: Number(panel.querySelector('#en-cc').value) || 2,
        } } });
        toast('引擎参数已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    const ls = panel.querySelector('#llm-save');
    if (ls) ls.addEventListener('click', async () => {
      try {
        await api('/api/settings', { method: 'POST', body: { llm: {
          baseUrl: panel.querySelector('#en-url').value.trim(),
          model: panel.querySelector('#en-model').value.trim(),
          temperature: Number(panel.querySelector('#en-temp').value) || 0.8,
        } } });
        toast('文本生成设置已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  view.querySelector('#atabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-at]');
    if (!b) return;
    tab = b.getAttribute('data-at');
    view.querySelectorAll('[data-at]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  });
  paint();
}
