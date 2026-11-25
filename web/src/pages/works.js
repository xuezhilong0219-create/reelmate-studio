
import { api, esc, toast, openModal, closeModal, fmtTime, pollTask } from '../lib.js';

/* 创作者中心：作品库 / 发布新作品（三步）/ 收益管理 —— 对应官方 creatorCenter.json */

const TABS = [['works', '作品库'], ['publish', '发布新作品'], ['earnings', '收益管理']];
const STATUS = [['all', '全部作品'], ['listed', '已上架'], ['sold', '已售出'], ['draft', '草稿'], ['reviewing', '审核中'], ['offline', '已下架'], ['rejected', '驳回']];
const ST_COLOR = { listed: 'var(--ok, #34d399)', sold: '#f5c688', draft: 'var(--dim)', reviewing: '#7dd3fc', offline: '#f87171', rejected: '#f87171' };
const TYPES = [['ai', 'AI辅助创作'], ['manual', '人工创作'], ['other', '其他']];

let tab = 'works';
let filter = { status: 'all', q: '', cat: '' };
let cache = { list: [], stats: null, meta: null };
let pub = null;          // 发布流程状态
let step = 1;

const fmtMoney = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN');

function statCard(label, v, sub) {
  return '<div class="card"><div style="font-size:24px;font-weight:700">' + v + '</div>' +
    '<div style="font-size:12px;color:var(--dim);margin-top:2px">' + esc(label) + (sub ? ' · ' + esc(sub) : '') + '</div></div>';
}

/* ---------------- 作品库 ---------------- */
function worksBody() {
  const s = cache.stats || { byStatus: {}, revenue: 0 };
  const rows = cache.list || [];
  const pills = STATUS.map(([k, n]) => {
    const c = k === 'all' ? (cache.stats ? (cache.stats.byStatus.sold || 0) + (cache.stats.byStatus.listed || 0) + (cache.stats.byStatus.draft || 0) + (cache.stats.byStatus.reviewing || 0) + (cache.stats.byStatus.offline || 0) + (cache.stats.byStatus.rejected || 0) : 0) : (s.byStatus[k] || 0);
    return '<button class="tab' + (filter.status === k ? ' on' : '') + '" data-st="' + k + '">' + n + '<span class="tab-n">' + c + '</span></button>';
  }).join('');

  const table = rows.length ? [
    '<table class="tbl wk-tbl"><thead><tr>',
    '<th>作品</th><th>分类</th><th>创作类型</th><th>价格</th><th>状态</th><th>集数 / 字数</th><th>更新于</th><th>操作</th>',
    '</tr></thead><tbody>',
    rows.map((w) => {
      const thumb = w.thumbRel ? '<img src="' + esc(w.thumbRel) + '" />' : '<span class="wk-ico">▤</span>';
      const ops = [
        '<span data-view="' + w.id + '">查看</span>',
        '<span data-edit="' + w.id + '">编辑</span>',
        w.contractRel ? '<a href="' + esc(w.contractRel) + '" download>下载合同</a>' : '<span data-contract="' + w.id + '">生成合同</span>',
        w.status === 'listed' ? '<span data-off="' + w.id + '">下架</span>' : '<span data-on="' + w.id + '">上架</span>',
        '<span data-del="' + w.id + '" style="color:#f87171">删除</span>'
      ].join('');
      return '<tr>' +
        '<td><div class="wk-cell">' + thumb + '<div><div class="wk-name">' + esc(w.title) + '</div><div class="wk-sub">' + esc((w.intro || '').slice(0, 28)) + '</div></div></div></td>' +
        '<td>' + esc(w.cat || '—') + '</td>' +
        '<td>' + esc(w.typeName) + '</td>' +
        '<td>' + (w.discount > 0 ? '<b>' + fmtMoney(w.discount) + '</b> <s class="wk-old">' + fmtMoney(w.price) + '</s>' : fmtMoney(w.price)) + '</td>' +
        '<td><span class="wk-st" style="color:' + (ST_COLOR[w.status] || 'var(--dim)') + '">' + esc(w.statusName) + '</span></td>' +
        '<td>' + w.episodes + ' 集 / ' + w.words + ' 字</td>' +
        '<td>' + esc(fmtTime(w.updatedAt || w.createdAt)) + '</td>' +
        '<td><div class="wk-ops">' + ops + '</div></td>' +
        '</tr>';
    }).join(''),
    '</tbody></table>'
  ].join('') : '<div class="empty">暂无内容，快去发布新作品吧</div>';

  return [
    '<div class="grid g4" style="margin-bottom:16px">',
    statCard('全部作品', rows.length === (cache.stats ? cache.stats.total : rows.length) ? rows.length : rows.length + ' / ' + cache.stats.total),
    statCard('已上架', s.byStatus.listed || 0),
    statCard('已售出', s.byStatus.sold || 0),
    statCard('累计收益', fmtMoney(s.revenue || 0)),
    '</div>',
    '<div class="wk-tabs">' + pills + '</div>',
    '<div class="wk-filter">',
    '<input id="wk-q" type="text" placeholder="搜索作品名称或简介" value="' + esc(filter.q) + '" />',
    '<select id="wk-cat"><option value="">全部分类</option>' + ((s.cats || []).map((c) => '<option value="' + esc(c) + '"' + (filter.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('')) + '</select>',
    '<div style="flex:1"></div>',
    '<button class="ghost" id="wk-new">+ 发布新作品</button>',
    '</div>',
    '<div class="card" style="padding:0;overflow:auto">' + table + '</div>'
  ].join('');
}

/* ---------------- 发布：步骤条 ---------------- */
function stepper() {
  const names = ['导入剧本', '确认剧本信息', '信息配置'];
  return '<div class="wk-steps">' + names.map((n, i) => {
    const no = i + 1;
    const cls = no === step ? 'on' : no < step ? 'done' : '';
    return '<div class="wk-step ' + cls + '"><i>' + (no < step ? '✓' : no) + '</i><span>' + n + '</span></div>';
  }).join('<em></em>') + '</div>';
}

function step1() {
  return [
    '<div class="card wk-drop" id="wk-drop">',
    '  <div style="font-size:34px;opacity:.5">⤒</div>',
    '  <div class="wk-drop-t">点击或拖入剧本文件</div>',
    '  <div class="wk-drop-h">支持 DOCX、TXT 格式，单个文件不超过 10M</div>',
    '  <input id="wk-file" type="file" accept=".docx,.txt,.doc" style="display:none" />',
    '  <button class="primary" id="wk-pick" style="margin-top:12px">选择文件</button>',
    '  <a class="wk-tpl" href="/api/works/template" download>下载空白模版</a>',
    '</div>',
    '<div class="wk-or">或直接粘贴剧本正文</div>',
    '<textarea id="wk-paste" rows="10" placeholder="在此粘贴剧本正文，支持「第1集」「第2集」分集标记"></textarea>',
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">',
    '  <button class="ghost" id="wk-paste-go">解析粘贴内容</button>',
    '</div>',
    '<div id="wk-parse-log" class="wk-log"></div>'
  ].join('');
}

function step2() {
  const p = pub || {};
  const roles = (p.roles || []).map((r) => r.name).join('、');
  const chaps = (p.chapters || []).map((c, i) => [
    '<div class="wk-chap" data-ch="' + i + '">',
    '  <div class="wk-chap-h"><b>第 ' + c.no + ' 集</b>',
    '    <input data-ctitle="' + i + '" type="text" value="' + esc(c.title) + '" />',
    '    <span class="wk-sub">' + (c.chars || 0) + ' 字</span></div>',
    '  <textarea data-cbody="' + i + '" rows="3">' + esc((c.body || '').slice(0, 1200)) + '</textarea>',
    '</div>'
  ].join('')).join('');
  return [
    '<div class="grid g2" style="gap:14px">',
    '<label class="field">剧本名称<input id="wk-title" type="text" value="' + esc(p.title || '') + '" /></label>',
    '<label class="field">剧本分类<select id="wk-pcat">' + ((cache.meta && cache.meta.cats) || []).map((c) => '<option' + (p.cat === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>',
    '</div>',
    '<div class="grid g2" style="gap:14px">',
    '<label class="field">创作类型<select id="wk-type">' + TYPES.map(([k, n]) => '<option value="' + k + '"' + (p.type === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>',
    '<label class="field">识别信息<input type="text" readonly value="' + (p.words || 0) + ' 字 · ' + (p.episodes || 0) + ' 集 · 角色 ' + (p.chars || 0) + ' 个" /></label>',
    '</div>',
    '<label class="field">剧本简介<textarea id="wk-intro" rows="2">' + esc(p.intro || '') + '</textarea></label>',
    '<div class="section-title" style="margin-top:16px">故事大纲</div>',
    '<textarea id="wk-outline" rows="4">' + esc(p.outline || '') + '</textarea>',
    '<div class="section-title" style="margin-top:16px">世界观</div>',
    '<textarea id="wk-world" rows="3">' + esc(p.world || '') + '</textarea>',
    '<div class="section-title" style="margin-top:16px">人物小传 <span class="wk-sub">' + esc(roles || '未识别到角色') + '</span></div>',
    '<div class="wk-roles">' + ((p.roles || []).map((r, i) => [
      '<div class="wk-role"><input data-rname="' + i + '" type="text" value="' + esc(r.name) + '" />',
      '<textarea data-rbio="' + i + '" rows="2">' + esc(r.bio || '') + '</textarea></div>'
    ].join('')).join('') || '<div class="empty" style="padding:14px">未识别到角色，可手动补充</div>') + '</div>',
    '<div class="section-title" style="margin-top:16px">剧本正文 <span class="wk-sub">共 ' + (p.chapters || []).length + ' 集，可逐集修改标题与正文</span></div>',
    chaps || '<div class="empty" style="padding:14px">未拆出分集</div>',
    '<div id="wk-log2" class="wk-log"></div>'
  ].join('');
}

function step3() {
  const p = pub || {};
  const price = Number(p.price || 1000);
  const disc = Number(p.discount || 0);
  const final = disc > 0 ? disc : price;
  const fee = Math.round(final * 0.1);
  return [
    '<div class="section-title">剧本基础信息</div>',
    '<div class="grid g2" style="gap:14px">',
    '<div><div class="wk-drop sm" id="wk-cover"><div class="wk-drop-t">上传封面</div><div class="wk-drop-h">建议 3:4 竖版</div>' +
    (p.cover ? '<img src="' + esc(p.cover) + '" style="width:88px;border-radius:8px;margin-top:8px" />' : '') +
    '<input id="wk-coverf" type="file" accept="image/*" style="display:none" /></div></div>',
    '<div><label class="field">剧本亮点关键词<input id="wk-kw" type="text" placeholder="用逗号分隔，如：反转, 情感, 悬疑" value="' + esc(((p.highlight || {}).keywords || []).join(', ')) + '" /></label>' +
    '<label class="field" style="margin-top:10px">亮点解析<textarea id="wk-hr" rows="3">' + esc(((p.highlight || {}).review) || '') + '</textarea></label></div>',
    '</div>',
    '<div class="section-title" style="margin-top:18px">试读与定价</div>',
    '<div class="grid g3" style="gap:14px">',
    '<label class="field">允许试读集数<input id="wk-preview" type="number" min="0" value="' + (p.previewCount || 0) + '" /><span class="wk-sub">前 N 集可试读</span></label>',
    '<label class="field">剧本定价（1000-50000）<input id="wk-price" type="number" step="100" min="1000" max="50000" value="' + price + '" /><span class="wk-sub">需为 100 元的整数倍</span></label>',
    '<label class="field">开启折扣<input id="wk-dswitch" type="checkbox"' + (disc > 0 ? ' checked' : '') + ' /><input id="wk-disc" type="number" step="100" value="' + disc + '" style="margin-top:8px" placeholder="折扣价" /></label>',
    '</div>',
    '<label class="field" style="margin-top:10px">折扣截止<input id="wk-dl" type="date" value="' + esc(p.discountDeadline || '') + '" /><span class="wk-sub">留空表示不限期</span></label>',
    '<div class="wk-fee" id="wk-fee">成交金额 <b>' + fmtMoney(final) + '</b> × 平台服务费 10% = <b>' + fmtMoney(fee) + '</b>　预估最终到手价 <b style="color:var(--ok,#34d399)">' + fmtMoney(final - fee) + '</b></div>',
    '<div class="section-title" style="margin-top:18px">版权认证</div>',
    '<div class="grid g2" style="gap:14px">',
    '<label class="field">作品登记信息<input id="wk-reg" type="text" placeholder="登记号或说明" value="' + esc((p.copyright || {}).regName || '') + '" /></label>',
    '<label class="field">可信时间戳认证书<input id="wk-ts" type="text" placeholder="证书编号" value="' + esc((p.copyright || {}).tsName || '') + '" /></label>',
    '</div>',
    '<div style="margin-top:12px"><button class="ghost" id="wk-cpf">上传版权证明（图片或 PDF）</button> <span class="wk-sub" id="wk-cpfn">' + esc(((p.copyright || {}).file) || '未上传') + '</span></div>',
    '<div id="wk-log3" class="wk-log"></div>'
  ].join('');
}

function publishBody() {
  const p = pub;
  const inner = !p ? step1() : step === 1 ? step1() : step === 2 ? step2() : step3();
  const prev = step > 1 ? '<button class="ghost" id="wk-prev">上一步</button>' : '';
  const next = step < 3 ? '<button class="primary" id="wk-next">下一步</button>' : '<button class="primary" id="wk-publish">发布</button>';
  const draft = p ? '<button class="ghost" id="wk-draft">保存草稿</button>' : '';
  const cancel = '<button class="subtle" id="wk-cancel">取消</button>';
  return stepper() + '<div class="wk-pub" id="wk-pub-body">' + inner + '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' + cancel + prev + draft + next + '</div>';
}

/* ---------------- 收益 ---------------- */
function earningsBody(e) {
  const income = (e.income || []).length ? [
    '<table class="tbl"><thead><tr><th>时间</th><th>来源</th><th>金额</th><th>状态</th></tr></thead><tbody>',
    e.income.map((r) => '<tr><td>' + esc(fmtTime(r.createdAt)) + '</td><td>' + esc(r.source || r.note || '剧本售出') + '</td><td>' + fmtMoney(r.amount) + '</td><td>' + esc(r.status === 'pending' ? '待结算' : '已结算') + '</td></tr>').join(''),
    '</tbody></table>'
  ].join('') : '<div class="empty">暂无收益明细</div>';
  const wd = (e.withdrawals || []).length ? [
    '<table class="tbl"><thead><tr><th>时间</th><th>金额</th><th>账户</th><th>状态</th></tr></thead><tbody>',
    e.withdrawals.map((r) => '<tr><td>' + esc(fmtTime(r.createdAt)) + '</td><td>' + fmtMoney(r.amount) + '</td><td>' + esc(r.bank || '本地账户') + '</td><td>' + esc(r.status === 'processing' ? '提现中' : r.status === 'settled' ? '已到账' : r.status) + '</td></tr>').join(''),
    '</tbody></table>'
  ].join('') : '<div class="empty">暂无提现记录</div>';
  return [
    '<div class="grid g4" style="margin-bottom:16px">',
    statCard('累计收益', fmtMoney(e.total)),
    statCard('本月收益', fmtMoney(e.month)),
    statCard('待结算', fmtMoney(e.pending)),
    statCard('可提现', fmtMoney(e.available)),
    '</div>',
    '<div class="card"><div style="display:flex;align-items:center;gap:10px">',
    '<div><b>可提现金额</b><div class="wk-sub">提现后 15 个工作日内完成支付</div></div>',
    '<div style="flex:1"></div>',
    '<input id="wd-amt" type="number" placeholder="提现金额" style="width:140px" />',
    '<button class="primary" id="wd-go">申请提现</button>',
    '</div></div>',
    '<div class="section-title" style="margin-top:18px">收益明细</div>' + income,
    '<div class="section-title" style="margin-top:18px">提现明细</div>' + wd
  ].join('');
}

/* ---------------- render ---------------- */
export async function render() {
  cache.list = [];
  cache.stats = null;
  if (tab === 'works') {
    const qs = new URLSearchParams();
    if (filter.status && filter.status !== 'all') qs.set('status', filter.status);
    if (filter.q) qs.set('q', filter.q);
    if (filter.cat) qs.set('cat', filter.cat);
    const d = await api('/api/works?' + qs.toString());
    cache.list = d.list || [];
    cache.stats = Object.assign({}, d.stats, { total: d.all, cats: d.stats.cats });
    cache.meta = d.stats;
  }
  const body = tab === 'works' ? worksBody() : tab === 'publish' ? publishBody() : earningsBody(await api('/api/creator/earnings'));
  return [
    '<div class="page-head">',
    '  <div><h1>创作者中心</h1><p>剧本发布 · 作品库 · 合同与收益</p></div>',
    '  <div class="spacer"></div>',
    '  <div class="tabs-line" id="wk-tabs">' + TABS.map(([k, n]) => '<button class="' + (tab === k ? 'on' : '') + '" data-tab="' + k + '">' + n + '</button>').join('') + '</div>',
    '</div>',
    '<div id="wk-body">' + body + '</div>'
  ].join('');
}

/* ---------------- 交互 ---------------- */
async function reload() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

function readStep2() {
  const q = (s) => { const el = document.querySelector(s); return el ? el.value : ''; };
  pub.title = q('#wk-title');
  pub.cat = q('#wk-pcat');
  pub.type = q('#wk-type');
  pub.intro = q('#wk-intro');
  pub.outline = q('#wk-outline');
  pub.world = q('#wk-world');
  document.querySelectorAll('[data-ctitle]').forEach((el) => { const i = Number(el.dataset.ctitle); if (pub.chapters[i]) pub.chapters[i].title = el.value; });
  document.querySelectorAll('[data-cbody]').forEach((el) => { const i = Number(el.dataset.cbody); if (pub.chapters[i]) pub.chapters[i].body = el.value; });
  document.querySelectorAll('[data-rname]').forEach((el) => { const i = Number(el.dataset.rname); if (pub.roles[i]) pub.roles[i].name = el.value; });
  document.querySelectorAll('[data-rbio]').forEach((el) => { const i = Number(el.dataset.rbio); if (pub.roles[i]) pub.roles[i].bio = el.value; });
}

function readStep3() {
  const q = (s) => { const el = document.querySelector(s); return el ? el.value : ''; };
  pub.price = Number(q('#wk-price') || 1000);
  pub.discount = document.querySelector('#wk-dswitch').checked ? Number(q('#wk-disc') || 0) : 0;
  pub.discountDeadline = q('#wk-dl');
  pub.previewCount = Number(q('#wk-preview') || 0);
  pub.highlight = { keywords: q('#wk-kw').split(/[,，\s]+/).filter(Boolean), review: q('#wk-hr') };
  pub.copyright = Object.assign({}, pub.copyright || {}, { regName: q('#wk-reg'), tsName: q('#wk-ts') });
}

function refreshFee() {
  const box = document.querySelector('#wk-fee');
  if (!box) return;
  const price = Number(document.querySelector('#wk-price').value || 0);
  const on = document.querySelector('#wk-dswitch').checked;
  const disc = on ? Number(document.querySelector('#wk-disc').value || 0) : 0;
  const final = disc > 0 ? disc : price;
  const fee = Math.round(final * 0.1);
  box.innerHTML = '成交金额 <b>¥' + final.toLocaleString('zh-CN') + '</b> × 平台服务费 10% = <b>¥' + fee.toLocaleString('zh-CN') +
    '</b>　预估最终到手价 <b style="color:var(--ok,#34d399)">¥' + (final - fee).toLocaleString('zh-CN') + '</b>';
}

async function postForm(url, fd) {
  const r = await fetch(url, { method: 'POST', body: fd });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || '上传失败');
  return j.data;
}

async function parseFile(file) {
  const log = document.querySelector('#wk-parse-log');
  if (log) log.textContent = '正在解析剧本并进行合规审查…';
  const fd = new FormData();
  fd.append('file', file);
  try {
    const d = await postForm('/api/works/parse', fd);
    pub = Object.assign({ docId: d.docId, cover: null, price: 1000, discount: 0, previewCount: 1, highlight: { keywords: [], review: '' } }, d);
    step = 2;
    await reload();
  } catch (e) {
    if (log) log.innerHTML = '<span style="color:#f87171">解析失败：' + esc(e.message) + '</span>　<a href="#" id="wk-reupload" style="color:var(--brand)">重新上传</a>';
  }
}

function bindPublish(view) {
  const pick = view.querySelector('#wk-pick');
  const file = view.querySelector('#wk-file');
  if (pick && file) {
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) parseFile(file.files[0]); });
    const drop = view.querySelector('#wk-drop');
    if (drop) {
      drop.addEventListener('click', (e) => { if (e.target === drop || e.target.classList.contains('wk-drop-t')) file.click(); });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('on'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]); });
    }
  }
  const pasteGo = view.querySelector('#wk-paste-go');
  if (pasteGo) pasteGo.addEventListener('click', async () => {
    const txt = view.querySelector('#wk-paste').value.trim();
    if (!txt) return toast('请先粘贴剧本正文', 'err');
    const blob = new File([txt], '粘贴剧本.txt', { type: 'text/plain' });
    await parseFile(blob);
  });

  const prev = view.querySelector('#wk-prev');
  if (prev) prev.addEventListener('click', async () => {
    if (step === 3) readStep3();
    if (step === 2) readStep2();
    step = Math.max(1, step - 1);
    await reload();
  });
  const next = view.querySelector('#wk-next');
  if (next) next.addEventListener('click', async () => {
    if (step === 1) { if (!pub) return toast('请先导入剧本', 'err'); step = 2; }
    else if (step === 2) {
      readStep2();
      if (!String(pub.title || '').trim()) return toast('请填写剧本名称', 'err');
      step = 3;
    }
    await reload();
  });
  const cancel = view.querySelector('#wk-cancel');
  if (cancel) cancel.addEventListener('click', async () => { pub = null; step = 1; tab = 'works'; await reload(); });

  const draftBtn = view.querySelector('#wk-draft');
  if (draftBtn) draftBtn.addEventListener('click', () => save('draft'));
  const publishBtn = view.querySelector('#wk-publish');
  if (publishBtn) publishBtn.addEventListener('click', () => save('reviewing'));

  async function save(status) {
    if (step === 2) readStep2();
    if (step === 3) readStep3();
    if (!String(pub.title || '').trim()) return toast('请填写剧本名称', 'err');
    if (status === 'reviewing' && !(Number(pub.price) >= 1000)) return toast('剧本定价需在 1000-50000 元之间', 'err');
    const ids = new Set();
    for (const c of pub.chapters || []) { if (ids.has(c.no)) return toast('分集编号重复：第 ' + c.no + ' 集', 'err'); ids.add(c.no); }
    try {
      const body = {
        title: pub.title, cat: pub.cat, type: pub.type, intro: pub.intro,
        price: pub.price, discount: pub.discount, discountDeadline: pub.discountDeadline,
        previewCount: pub.previewCount, episodes: (pub.chapters || []).length, words: pub.words,
        outline: pub.outline, world: pub.world, roles: pub.roles, body: pub.body,
        chapters: pub.chapters, highlight: pub.highlight, cover: pub.cover, copyright: pub.copyright,
        status
      };
      if (pub.id) await api('/api/works/' + pub.id, { method: 'POST', body });
      else {
        const w = await api('/api/works', { method: 'POST', body });
        pub.id = w.id;
        await api('/api/works/' + w.id, { method: 'POST', body });
      }
      toast(status === 'draft' ? '已保存草稿' : '已提交审核（本地实例直接上架）', 'ok');
      pub = null; step = 1; tab = 'works';
      await reload();
    } catch (e) { toast(e.message, 'err'); }
  }

  const priceEl = view.querySelector('#wk-price');
  if (priceEl) {
    priceEl.addEventListener('input', refreshFee);
    view.querySelector('#wk-disc').addEventListener('input', refreshFee);
    view.querySelector('#wk-dswitch').addEventListener('change', refreshFee);
  }
  const cover = view.querySelector('#wk-coverf');
  if (cover) cover.addEventListener('change', async () => {
    if (!cover.files[0]) return;
    const { uploadFile } = await import('../lib.js');
    const a = await uploadFile(cover.files[0]);
    pub.cover = a.rel;
    toast('封面已上传', 'ok');
    await reload();
  });
  const cpf = view.querySelector('#wk-cpf');
  if (cpf) cpf.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf';
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      const { uploadFile } = await import('../lib.js');
      const a = await uploadFile(inp.files[0]);
      pub.copyright = Object.assign({}, pub.copyright || {}, { file: a.rel });
      document.querySelector('#wk-cpfn').textContent = a.name || a.rel;
      toast('版权证明已上传', 'ok');
    });
    inp.click();
  });
}

function bindWorks(view) {
  view.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { filter.status = b.dataset.st; await reload(); }));
  const q = view.querySelector('#wk-q');
  if (q) {
    let t = null;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { filter.q = q.value.trim(); await reload(); }, 320); });
  }
  const cat = view.querySelector('#wk-cat');
  if (cat) cat.addEventListener('change', async () => { filter.cat = cat.value; await reload(); });
  const nw = view.querySelector('#wk-new');
  if (nw) nw.addEventListener('click', async () => { pub = null; step = 1; tab = 'publish'; await reload(); });

  const setStatus = async (id, status) => { await api('/api/works/' + id + '/status', { method: 'POST', body: { status } }); toast('状态已更新', 'ok'); await reload(); };
  view.querySelectorAll('[data-view]').forEach((n) => n.addEventListener('click', () => detail(n.dataset.view)));
  view.querySelectorAll('[data-edit]').forEach((n) => n.addEventListener('click', async () => {
    const w = await api('/api/works/' + n.dataset.edit);
    pub = Object.assign({}, w, { chapters: w.chapters || [], roles: w.roles || [] });
    step = 3; tab = 'publish'; await reload();
  }));
  view.querySelectorAll('[data-on]').forEach((n) => n.addEventListener('click', () => setStatus(n.dataset.on, 'listed')));
  view.querySelectorAll('[data-off]').forEach((n) => n.addEventListener('click', () => setStatus(n.dataset.off, 'offline')));
  view.querySelectorAll('[data-del]').forEach((n) => n.addEventListener('click', async () => {
    if (!confirm('删除这个作品？')) return;
    await api('/api/works/' + n.dataset.del + '/delete', { method: 'POST' });
    toast('已删除', 'ok'); await reload();
  }));
  view.querySelectorAll('[data-contract]').forEach((n) => n.addEventListener('click', async () => {
    n.textContent = '生成中…';
    const t = await api('/api/works/' + n.dataset.contract + '/contract', { method: 'POST' });
    const tid = t.id || (t.task && t.task.id);
    pollTask(tid, () => {}, 700).then(() => { toast('合同已生成', 'ok'); reload(); }).catch(() => toast('合同生成失败', 'err'));
  }));
}

async function detail(id) {
  const w = await api('/api/works/' + id);
  const m = openModal([
    '<div style="display:flex;gap:14px">',
    w.thumbRel ? '<img src="' + esc(w.thumbRel) + '" style="width:120px;border-radius:10px" />' : '',
    '<div><h3 style="margin:0 0 6px">' + esc(w.title) + '</h3>',
    '<div class="wk-sub">' + esc(w.cat) + ' · ' + esc(w.typeName) + ' · ' + esc(w.statusName) + '</div>',
    '<div style="margin-top:8px">' + (w.discount > 0 ? '<b>' + fmtMoney(w.discount) + '</b> <s class="wk-old">' + fmtMoney(w.price) + '</s>' : '<b>' + fmtMoney(w.price) + '</b>') +
    '　试读 ' + w.previewCount + ' 集　' + w.episodes + ' 集 / ' + w.words + ' 字</div></div></div>',
    w.intro ? '<p style="margin-top:12px">' + esc(w.intro) + '</p>' : '',
    (w.highlight && w.highlight.keywords && w.highlight.keywords.length) ? '<div style="margin-top:8px">' + w.highlight.keywords.map((k) => '<span class="chip">' + esc(k) + '</span>').join(' ') + '</div>' : '',
    (w.highlight && w.highlight.review) ? '<div class="section-title" style="margin-top:14px">亮点解析</div><p>' + esc(w.highlight.review) + '</p>' : '',
    w.outline ? '<div class="section-title" style="margin-top:14px">故事大纲</div><pre class="wk-pre">' + esc(w.outline) + '</pre>' : '',
    w.world ? '<div class="section-title" style="margin-top:14px">世界观</div><pre class="wk-pre">' + esc(w.world) + '</pre>' : '',
    (w.roles || []).length ? '<div class="section-title" style="margin-top:14px">人物小传</div>' + w.roles.map((r) => '<div class="wk-kv"><b>' + esc(r.name) + '</b><span>' + esc((r.bio || '').slice(0, 80)) + '</span></div>').join('') : '',
    (w.chapters || []).length ? '<div class="section-title" style="margin-top:14px">剧本目录</div>' + w.chapters.map((c) => '<div class="wk-kv"><b>第' + c.no + '集</b><span>' + esc(c.title) + ' · ' + (c.chars || 0) + ' 字</span></div>').join('') : '',
    w.contractRel ? '<div style="margin-top:14px"><a class="chip ok" href="' + esc(w.contractRel) + '" download>下载合同</a></div>' : '',
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ghost" id="wk-close">关闭</button>',
    w.contractRel ? '' : '<button class="primary" id="wk-mk">生成合同</button></div>'
  ].join(''), { wide: true });
  m.querySelector('#wk-close').addEventListener('click', closeModal);
  const mk = m.querySelector('#wk-mk');
  if (mk) mk.addEventListener('click', async () => {
    const t = await api('/api/works/' + id + '/contract', { method: 'POST' });
    const tid = t.id || (t.task && t.task.id);
    await pollTask(tid, () => {}, 700);
    toast('合同已生成', 'ok'); closeModal(); reload();
  });
}

function bindEarnings(view) {
  const go = view.querySelector('#wd-go');
  if (go) go.addEventListener('click', async () => {
    const amt = Number(view.querySelector('#wd-amt').value || 0);
    if (!amt) return toast('请输入提现金额', 'err');
    try { await api('/api/creator/withdraw', { method: 'POST', body: { amount: amt } }); toast('已提交提现申请', 'ok'); await reload(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

export async function mount(view) {
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    tab = b.dataset.tab;
    if (tab === 'publish' && !pub) step = 1;
    await reload();
  }));
  if (tab === 'works') bindWorks(view);
  else if (tab === 'publish') bindPublish(view);
  else bindEarnings(view);
}
