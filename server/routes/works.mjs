import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';

/* 创作者中心：作品发布（导入剧本 → 确认信息 → 信息配置）、作品库、合同、收益管理
   对应官方 creatorCenter.json 全部键 */

const CATS = ['现代言情', '古代言情', '悬疑推理', '科幻未来', '玄幻仙侠', '职场商战', '青春校园', '现实题材'];
const CATS_ALL = CATS.concat(['短剧', '喜剧', '都市', '古装', '悬疑', '科幻', '言情', '现实']);
const TYPES = [['ai', 'AI辅助创作'], ['manual', '人工创作'], ['other', '其他']];
const ST = { draft: '草稿', reviewing: '审核中', listed: '已上架', sold: '已售出', offline: '已下架', rejected: '驳回' };
const LEVELS = [[0, '新手编剧'], [3, '优质编剧'], [8, '金牌编剧']];

const DOC = path.join(MEDIA, 'doc');
const relOf = (f) => '/media/doc/' + path.basename(f);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function levelOf(n) {
  let out = LEVELS[0][1];
  for (const [k, v] of LEVELS) if (n >= k) out = v;
  return out;
}

function rowOf(w) {
  const p = num(w.price), d = num(w.discount);
  return {
    id: w.id, title: w.title, cat: w.cat || '', type: w.type || 'ai',
    typeName: (TYPES.find((t) => t[0] === w.type) || TYPES[0])[1],
    price: p, discount: d, finalPrice: d > 0 ? d : p,
    discountDeadline: w.discountDeadline || '',
    previewCount: num(w.previewCount), episodes: num(w.episodes), words: num(w.words),
    intro: w.intro || '', highlight: w.highlight || { keywords: [], review: '' },
    cover: w.cover || null, rel: w.rel || null, thumbRel: w.thumbRel || w.cover || null,
    kind: w.kind || 'image', status: w.status || 'draft',
    statusName: ST[w.status || 'draft'] || w.status,
    views: num(w.views), likes: num(w.likes), sold: num(w.sold),
    contractRel: w.contractRel || null, copyright: w.copyright || null,
    outline: w.outline || '', world: w.world || '', roles: w.roles || [], body: w.body || '',
    chapters: w.chapters || [], author: w.author || '本地用户',
    createdAt: w.createdAt, updatedAt: w.updatedAt || w.createdAt
  };
}

/* 剧本解析：拆集 + 抽模块（大纲 / 世界观 / 人物小传 / 正文） */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNo(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let n = 0;
  for (const ch of s) { if (CN_NUM[ch]) n = CN_NUM[ch]; else if (ch === '十') n = (n || 1) * 10; }
  return n || 0;
}

export function parseScript(text, filename) {
  const raw = String(text || '').replace(/\r/g, '').replace(/\u3000/g, ' ');
  const lines = raw.split('\n');
  const title = (lines.find((l) => /^[^\s]{2,20}$/.test(l.trim())) || path.basename(String(filename || '未命名剧本'), path.extname(String(filename || '')))).trim().slice(0, 40);

  /* 人物小传：名字：台词 或 名字（年龄） —— 排除表头/场记/元信息词 */
  const SKIP = new Set(['内景', '外景', '旁白', '画外音', '字幕', '剧本名称', '剧本分类', '创作类型', '剧本简介',
    '故事大纲', '世界观', '人物小传', '剧本正文', '剧本目录', '角色名', '人物', '角色', '场景', '道具', '备注',
    '时间', '地点', '镜号', '景别', '画面', '台词', '动作', '音效', '音乐', '标题', '集数', '作者', '备注：']);
  const names = new Map();
  const reName = /(?:^|\n)\s*([\u4e00-\u9fa5A-Za-z]{2,4})\s*[:：]/g;
  let m;
  while ((m = reName.exec(raw))) {
    const n = m[1];
    if (SKIP.has(n) || SKIP.has(n.replace(/[【】]/g, ''))) continue;
    names.set(n, (names.get(n) || 0) + 1);
  }
  const roles = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([name, cnt]) => ({ name, lines: cnt, bio: name + '，本剧主要角色之一（出现 ' + cnt + ' 处台词）' }));

  /* 世界观：取【世界观】/世界观：段落正文；没有则回落到含「设定 / 时代背景 / 故事背景」的行 */
  const sectionOf = (tag, next) => {
    const i = lines.findIndex((l) => new RegExp('【\\s*' + tag + '\\s*】|^' + tag + '\\s*[:：]').test(l));
    if (i < 0) return '';
    const out = [];
    for (let k = i + 1; k < lines.length; k++) {
      const l = lines[k];
      if (/^\s*【[^】]+】\s*$/.test(l)) break;
      if (next && new RegExp('^\\s*' + next + '\\s*[:：]').test(l)) break;
      out.push(l);
      if (out.join('\n').length > 1200) break;
    }
    return out.join('\n').trim();
  };
  let world = sectionOf('世界观') || sectionOf('时代背景') || sectionOf('故事背景');
  if (!world) world = lines.filter((l) => /世界观|时代背景|故事背景/.test(l)).join('\n');
  const outlineSec = sectionOf('故事大纲') || sectionOf('大纲');

  /* 元信息：剧本分类 / 创作类型 / 剧本简介 */
  const metaOf = (tag) => {
    const l = lines.find((x) => new RegExp('^\\s*(【\\s*' + tag + '\\s*】|' + tag + '\\s*[:：])').test(x));
    if (!l) return '';
    return l.replace(new RegExp('^\\s*(【\\s*' + tag + '\\s*】|' + tag + '\\s*[:：])\\s*'), '').trim();
  };
  const catRaw = metaOf('剧本分类');
  const cat = CATS_ALL.find((c) => catRaw.includes(c)) || '';
  const typeRaw = metaOf('创作类型');
  const type = /人工/.test(typeRaw) ? 'manual' : /其他/.test(typeRaw) ? 'other' : 'ai';
  const intro = metaOf('剧本简介') || (lines.find((l) => /剧本简介/.test(l)) || '').replace(/剧本简介[:：]?/, '').trim();

  /* 拆集 */
  const marks = [];
  const reEp = /第\s*([一二三四五六七八九十\d]+)\s*集[^\n]{0,30}/g;
  while ((m = reEp.exec(raw))) marks.push({ at: m.index, no: cnNo(m[1]), head: m[0].trim() });
  const chapters = [];
  if (marks.length) {
    for (let i = 0; i < marks.length; i++) {
      const s = marks[i].at, e = i + 1 < marks.length ? marks[i + 1].at : raw.length;
      const body = raw.slice(s, e).trim();
      const head = marks[i].head;
      chapters.push({ no: marks[i].no || i + 1, title: head.replace(/^第\s*[一二三四五六七八九十\d]+\s*集\s*[-—:：]?\s*/, '').slice(0, 40) || ('第' + (i + 1) + '集'), body, chars: body.length });
    }
  } else {
    const size = Math.max(600, Math.ceil(raw.length / Math.max(1, Math.min(24, Math.ceil(raw.length / 1600)))));
    for (let i = 0, no = 1; i < raw.length && no <= 24; i += size, no++) {
      const body = raw.slice(i, i + size).trim();
      chapters.push({ no, title: '第' + no + '集', body, chars: body.length });
    }
  }
  const autoOutline = chapters.map((c) => '第' + c.no + '集：' + (c.body.split(/[。！？\n]/).find((x) => x.trim().length > 6) || c.title).trim().slice(0, 60)).join('\n').slice(0, 1200);
  const outline = (outlineSec ? outlineSec.slice(0, 1200) : autoOutline);
  const bodySec = sectionOf('剧本正文') || sectionOf('正文') || '';

  return {
    title,
    words: raw.length,
    episodes: chapters.length,
    chars: roles.length,
    roles,
    outline,
    world: world.slice(0, 800),
    chapters: chapters.slice(0, 30),
    body: (bodySec || raw).slice(0, 60000),
    cat, type, intro
  };
}

/* 合同正文 */
function contractText(w) {
  const price = num(w.price), d = num(w.discount);
  const final = d > 0 ? d : price;
  return [
    '剧本著作财产权转让协议',
    '',
    '甲方（受让方）：剧作工坊平台用户',
    '乙方（转让方）：' + (w.author || '本地用户'),
    '',
    '一、作品信息',
    '  作品名称：' + w.title,
    '  剧本分类：' + (w.cat || '—'),
    '  创作类型：' + ((TYPES.find((t) => t[0] === w.type) || TYPES[0])[1]),
    '  总集数：' + num(w.episodes) + ' 集　　字数：约 ' + num(w.words) + ' 字',
    '  允许试读：前 ' + num(w.previewCount) + ' 集',
    '',
    '二、价款',
    '  剧本定价：' + price + ' 元' + (d > 0 ? '（折扣价 ' + d + ' 元，截止 ' + (w.discountDeadline || '不限期') + '）' : ''),
    '  成交金额：' + final + ' 元',
    '  平台服务费：成交金额 × 10% = ' + Math.round(final * 0.1) + ' 元',
    '  预估最终到手价：' + (final - Math.round(final * 0.1)) + ' 元',
    '',
    '三、权利约定',
    '  1. 乙方保证对上述剧本享有完整著作权，无权利瑕疵。',
    '  2. 自本协议生效之日起，剧本的改编权、摄制权、信息网络传播权等著作财产权转让给甲方。',
    '  3. 乙方保留署名权。',
    '  4. 剧本售出后 30 天为结算周期。',
    '',
    '四、其他',
    '  本协议由剧作工坊本地实例生成，仅用于本地工作流演示，不具备现实法律效力。',
    '',
    '生成时间：' + new Date().toLocaleString('zh-CN'),
    '作品编号：' + w.id
  ].join('\n');
}

export function registerWorks(r) {
  /* ---------- 剧本解析（发布流程第一步） ---------- */
  r.post('/api/works/parse', async (req, res, ctx) => {
    const files = ctx.files || [];
    if (!files.length) return reply(res, fail('请上传剧本文件'));
    const f = files[0];
    const ext = path.extname(f.filename || '').toLowerCase();
    if (!['.docx', '.txt', '.doc'].includes(ext)) return reply(res, fail('请上传DOCX、TXT格式剧本'));
    if (!f.data || !f.data.length) return reply(res, fail('文件内容为空，请检查后重新上传'));
    if (f.data.length > 10 * 1024 * 1024) return reply(res, fail('仅支持上传10M以内剧本'));
    fs.mkdirSync(DOC, { recursive: true });
    const id = uid('doc_');
    const dest = path.join(DOC, id + ext);
    fs.writeFileSync(dest, f.data);
    let text = '';
    try {
      const { readDocument } = await import('../../engine/office.mjs');
      const d = readDocument(dest, f.filename);
      text = d.kind === 'rows' ? (d.rows || []).map((row) => row.join('\t')).join('\n') : String(d.text || '');
    } catch (e) {
      return reply(res, fail('剧本解析失败：' + String(e.message || e).slice(0, 80)));
    }
    if (!String(text).trim()) return reply(res, fail('未识别出有效信息，请检查文档内容或按模板梳理剧本信息'));
    const parsed = parseScript(text, f.filename);
    reply(res, ok({ docId: id, rel: relOf(dest), filename: f.filename, size: f.data.length, ...parsed }));
  });

  /* ---------- 作品列表 ---------- */
  r.get('/api/works', (req, res, ctx) => {
    const q = ctx.query || {};
    const d = db();
    d.works = d.works || [];
    let rows = d.works.map(rowOf);
    if (q.status && q.status !== 'all') rows = rows.filter((w) => w.status === q.status);
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((w) => (w.title || '').toLowerCase().includes(s) || (w.intro || '').toLowerCase().includes(s)); }
    if (q.cat) rows = rows.filter((w) => w.cat === q.cat);
    const byStatus = {};
    for (const k of Object.keys(ST)) byStatus[k] = d.works.filter((w) => (w.status || 'draft') === k).length;
    const sum = d.creator && d.creator.earnings ? d.creator.earnings.reduce((s, e) => s + num(e.amount), 0) : 0;
    reply(res, ok({
      list: rows, total: rows.length, all: d.works.length,
      stats: { byStatus, cats: CATS, types: TYPES.map((t) => ({ k: t[0], n: t[1] })), revenue: sum }
    }));
  });

  /* ---------- 空白模版（必须排在 /:id 之前） ---------- */
  r.get('/api/works/template', (req, res) => {
    const txt = [
      '剧本名称：',
      '剧本分类：（现代言情 / 古代言情 / 悬疑推理 / 科幻未来 / 玄幻仙侠 / 职场商战 / 青春校园 / 现实题材）',
      '创作类型：AI辅助创作 / 人工创作 / 其他',
      '剧本简介：',
      '',
      '【故事大纲】',
      '',
      '【世界观】',
      '',
      '【人物小传】',
      '角色名：人物简介……',
      '',
      '【剧本正文】',
      '第1集 - 集标题',
      '内景 场景名 日/夜',
      '　　动作描写……',
      '角色名：台词内容……',
      '',
      '第2集 - 集标题',
      '外景 场景名 日/夜',
      '　　动作描写……',
      '角色名：台词内容……'
    ].join('\n');
    const body = Buffer.from(txt, 'utf8');
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': body.length,
      'content-disposition': 'attachment; filename="script-template.txt"; filename*=UTF-8\'\'%E5%89%A7%E6%9C%AC%E6%A8%A1%E7%89%88.txt'
    });
    res.end(body);
  });
  r.get('/api/works/:id', (req, res, ctx) => {
    const w = (db().works || []).find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('未找到该作品'), 404);
    reply(res, ok(rowOf(w)));
  });

  /* ---------- 发布 / 编辑 ---------- */
  const build = (b, base) => {
    const out = { ...(base || {}) };
    const set = (k, v) => { if (v !== undefined) out[k] = v; };
    set('title', b.title !== undefined ? String(b.title).slice(0, 60) : undefined);
    set('cat', b.cat !== undefined ? String(b.cat) : undefined);
    set('type', b.type !== undefined ? String(b.type) : undefined);
    set('intro', b.intro !== undefined ? String(b.intro).slice(0, 600) : undefined);
    if (b.price !== undefined) out.price = clamp(Math.round(num(b.price) / 100) * 100, 0, 50000);
    if (b.discount !== undefined) out.discount = Math.max(0, Math.round(num(b.discount) / 100) * 100);
    set('discountDeadline', b.discountDeadline !== undefined ? String(b.discountDeadline) : undefined);
    if (b.previewCount !== undefined) out.previewCount = Math.max(0, Math.round(num(b.previewCount)));
    if (b.episodes !== undefined) out.episodes = Math.max(0, Math.round(num(b.episodes)));
    if (b.words !== undefined) out.words = Math.max(0, Math.round(num(b.words)));
    if (b.highlight !== undefined) out.highlight = { keywords: Array.isArray(b.highlight.keywords) ? b.highlight.keywords : String(b.highlight.keywords || '').split(/[,，\s]+/).filter(Boolean), review: String(b.highlight.review || '') };
    if (b.chapters !== undefined) out.chapters = Array.isArray(b.chapters) ? b.chapters.slice(0, 30) : [];
    set('outline', b.outline !== undefined ? String(b.outline).slice(0, 4000) : undefined);
    set('world', b.world !== undefined ? String(b.world).slice(0, 4000) : undefined);
    set('body', b.body !== undefined ? String(b.body) : undefined);
    if (b.roles !== undefined) out.roles = Array.isArray(b.roles) ? b.roles.slice(0, 30) : [];
    if (b.cover !== undefined) out.cover = b.cover || null;
    if (b.copyright !== undefined) out.copyright = b.copyright || null;
    if (b.rel !== undefined) out.rel = b.rel || null;
    if (b.kind !== undefined) out.kind = b.kind || 'image';
    if (b.assetId !== undefined) out.assetId = b.assetId || null;
    if (b.status !== undefined && ST[b.status]) out.status = b.status;
    return out;
  };

  r.post('/api/works', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    d.works = d.works || [];
    if (!String(b.title || '').trim()) return reply(res, fail('请填写剧本名称'));
    const a = b.assetId ? (d.assets || []).find((x) => x.id === b.assetId) : null;
    const row = build(b, {
      id: uid('wk_'), author: (d.users[0] || {}).name || '本地用户',
      status: 'draft', views: 0, likes: 0, sold: 0,
      rel: (a && a.rel) || null, thumbRel: (a && (a.thumbRel || a.thumb)) || null,
      episodes: 0, words: 0, price: 1000, discount: 0, previewCount: 1,
      createdAt: now(), updatedAt: now()
    });
    row.title = String(b.title).slice(0, 60);
    d.works.unshift(row);
    save();
    reply(res, ok(rowOf(row)));
  });

  r.post('/api/works/:id', (req, res, ctx) => {
    const d = db();
    const w = (d.works || []).find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('未找到该作品'), 404);
    Object.assign(w, build(ctx.body || {}, w), { id: w.id, updatedAt: now() });
    save();
    reply(res, ok(rowOf(w)));
  });

  r.post('/api/works/:id/status', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const w = (d.works || []).find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('未找到该作品'), 404);
    if (!ST[b.status]) return reply(res, fail('状态不合法'));
    w.status = b.status;
    w.updatedAt = now();
    /* 售出即记账：写一条收益流水（本地实例不接支付，用于收益管理可视化） */
    if (b.status === 'sold') {
      const d2 = ensureCreator();
      const exist = d2.creator.earnings.find((e) => e.workId === w.id);
      const amount = num(w.discount) > 0 ? num(w.discount) : num(w.price);
      if (!exist && amount > 0) {
        w.sold = num(w.sold) + 1;
        d2.creator.earnings.unshift({
          id: uid('in_'), workId: w.id, source: '剧本售出 · ' + w.title,
          amount, status: 'pending', createdAt: now()
        });
      }
    }
    save();
    reply(res, ok(rowOf(w)));
  });

  r.post('/api/works/:id/like', (req, res, ctx) => {
    const w = (db().works || []).find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('作品不存在'), 404);
    w.likes = num(w.likes) + 1;
    save();
    reply(res, ok(rowOf(w)));
  });

  r.post('/api/works/:id/delete', (req, res, ctx) => {
    const d = db();
    d.works = (d.works || []).filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ---------- 合同下载 ---------- */
  r.post('/api/works/:id/contract', (req, res, ctx) => {
    const d = db();
    const w = (d.works || []).find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('未找到该作品'), 404);
    const task = enqueue('contract', { id: w.id }, async ({ progress }) => {
      progress(30, '生成合同正文');
      fs.mkdirSync(DOC, { recursive: true });
      const file = path.join(DOC, 'contract_' + w.id + '.txt');
      fs.writeFileSync(file, contractText(w), 'utf8');
      progress(80, '写入文件');
      w.contractRel = relOf(file);
      w.contractFile = file;
      save();
      return { ok: true, rel: w.contractRel, file, name: (w.title || '剧本') + '-著作财产权转让协议.txt' };
    }, { tool: 'contract', title: '生成合同 · ' + w.title });
    reply(res, ok(task));
  });

  /* ---------- 收益管理 ---------- */
  const ensureCreator = () => {
    const d = db();
    if (!d.creator || typeof d.creator !== 'object') d.creator = {};
    if (!Array.isArray(d.creator.earnings)) d.creator.earnings = [];
    if (!Array.isArray(d.creator.withdrawals)) d.creator.withdrawals = [];
    return d;
  };

  r.get('/api/creator/earnings', (req, res) => {
    const d = ensureCreator();
    const all = d.creator.earnings;
    const t0 = new Date(); const ym = t0.getFullYear() + '-' + String(t0.getMonth() + 1).padStart(2, '0');
    const total = all.reduce((s, e) => s + num(e.amount), 0);
    const month = all.filter((e) => String(e.createdAt || '').slice(0, 7) === ym).reduce((s, e) => s + num(e.amount), 0);
    const pending = all.filter((e) => e.status === 'pending').reduce((s, e) => s + num(e.amount), 0);
    const withdrawn = d.creator.withdrawals.filter((w) => w.status !== 'failed').reduce((s, w) => s + num(w.amount), 0);
    const processing = d.creator.withdrawals.filter((w) => w.status === 'processing').reduce((s, w) => s + num(w.amount), 0);
    reply(res, ok({
      total, month, pending, processing,
      available: Math.max(0, total - withdrawn - processing),
      income: all.slice(0, 100),
      withdrawals: d.creator.withdrawals.slice(0, 100),
      works: (d.works || []).filter((w) => w.status === 'sold').map((w) => ({ id: w.id, title: w.title, price: num(w.price) }))
    }));
  });

  r.post('/api/creator/withdraw', (req, res, ctx) => {
    const d = ensureCreator();
    const b = ctx.body || {};
    const amount = num(b.amount);
    const all = d.creator.earnings;
    const total = all.reduce((s, e) => s + num(e.amount), 0);
    const done = d.creator.withdrawals.filter((w) => w.status !== 'failed').reduce((s, w) => s + num(w.amount), 0);
    const available = Math.max(0, total - done);
    if (amount <= 0) return reply(res, fail('请输入提现金额'));
    if (amount > available) return reply(res, fail('暂无可提现金额（可提现 ' + available + ' 元）'));
    const row = { id: uid('wd_'), amount, status: 'processing', bank: b.bank || '本地账户', createdAt: now(), note: '发起提现后 15 个工作日进行支付（本地实例立即记账）' };
    d.creator.withdrawals.unshift(row);
    save();
    reply(res, ok(row));
  });

  /* ---------- 创作者概览（兼容旧接口） ---------- */
  r.get('/api/creator', (req, res) => {
    const d = ensureCreator();
    const works = (d.works || []).map(rowOf);
    const views = works.reduce((s, w) => s + w.views, 0);
    const likes = works.reduce((s, w) => s + w.likes, 0);
    const byKind = {};
    for (const w of works) byKind[w.kind] = (byKind[w.kind] || 0) + 1;
    reply(res, ok({
      works, level: levelOf(works.length),
      stats: { total: works.length, views, likes, byKind, assets: (d.assets || []).length, tasks: (d.tasks || []).length, sold: works.filter((w) => w.status === 'sold').length },
      earnings: d.creator.earnings, cats: CATS, types: TYPES.map((t) => ({ k: t[0], n: t[1] })), status: ST
    }));
  });
}
