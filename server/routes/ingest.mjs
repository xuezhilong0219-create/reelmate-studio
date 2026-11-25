import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';
import { readDocument } from '../../engine/office.mjs';
import { addAsset } from './tools.mjs';

/* ============ 剧本 / 分镜单导入 + AI 智能提取资产 ============ */

const PROP_WORDS = ['伞','刀','枪','手机','信','钥匙','药','酒','杯','照片','录音笔','契约','令牌','车','镜子','钟','烟','行李','账本','徽章','面具','项链','戒指','相机','电脑','花','灯','表','包','书','笔','剑','鞭','绳','箱','盒','票'];

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const k = String(x || '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function splitSentences(text) {
  return String(text || '').split(/[。！？；\n]/).map((s) => s.trim()).filter(Boolean);
}

/* 单字道具必须有量词佐证（一把伞 / 那封信 / 两根绳），否则「我信你」会被判成「信」 */
const CLASSIFIERS = '把只个支条张台部根块串枚幅盒瓶袋片盏面粒颗封';
const SAFE_SINGLE = new Set(['刀', '枪', '剑', '鞭', '绳', '酒', '药']);
function propHit(line, w) {
  if (!line) return false;
  if (w.length > 1) return line.includes(w);
  if (SAFE_SINGLE.has(w)) return line.includes(w);
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp('[' + CLASSIFIERS + ']' + esc).test(line)) return true;
  return new RegExp(esc + '(子|把|柄|身|口)?[，。、！？\\s]?$').test(line) && /[一二三四五六七八九十几两这那每]/.test(line);
}

/* 从「名字：台词」里捞角色名（正文与对白都算） */
function nameCandidates(text) {
  const out = [];
  const re = /(?:^|\n|。|！|？|；)\s*([\u4e00-\u9fa5A-Za-z]{2,4})\s*[:：]/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1]);
  return out;
}

/** 从项目（剧本 + 剧集 + 分镜 + 正文）里抽出角色 / 场景 / 道具 */
function extractFromProject(projectId) {
  const d = db();
  const project = d.projects.find((p) => p.id === projectId);
  if (!project) return null;

  const chars = [];
  const places = [];
  const props = [];
  const texts = [];

  const sc = project.sourceScriptId ? d.scripts.find((s) => s.id === project.sourceScriptId) : null;
  const scripts = sc ? [sc] : d.scripts.filter((s) => (s.script && s.script.meta && s.script.meta.projectId === projectId));
  for (const s of scripts) {
    const body = s.script || {};
    if (s.text) texts.push(s.text);
    for (const c of body.characters || []) {
      chars.push({
        name: c.name,
        desc: [c.gender, c.age ? c.age + ' 岁' : '', c.identity, c.look, c.trait].filter(Boolean).join('，'),
        raw: c
      });
    }
    for (const ep of body.episodes || []) {
      for (const scene of ep.scenes || []) {
        if (scene.place) places.push(scene.place);
        texts.push(scene.action || '');
        for (const ln of scene.dialog || []) { if (ln.role) chars.push({ name: ln.role, desc: '', raw: {} }); texts.push(ln.text || ''); }
        for (const sh of scene.shots || []) if (sh.prompt) texts.push(sh.prompt);
      }
    }
  }
  if (project.idea) texts.push(project.idea);
  if (project.logline) texts.push(project.logline);

  const eps = d.episodes.filter((e) => e.projectId === projectId);
  for (const e of eps) {
    for (const scene of e.scenes || []) {
      if (scene.place) places.push(scene.place);
      texts.push(scene.action || '');
      for (const ln of scene.dialog || []) { if (ln.role) chars.push({ name: ln.role, desc: '', raw: {} }); texts.push(ln.text || ''); }
      for (const sh of scene.shots || []) if (sh.prompt) texts.push(sh.prompt);
    }
  }
  for (const b of d.storyboards.filter((x) => x.projectId === projectId)) {
    if (b.prompt) texts.push(b.prompt);
    if (b.dialog) texts.push(b.dialog);
  }

  /* 角色补全：显式 characters 之外，再从「名字：台词」里捞 */
  for (const r of texts) {
    let guess = nameCandidates(r);
    if (!guess.length) {
      /* 正文里「林知推开门」这种也没有冒号时，用出现频次最高的 2–3 字人名兜底不靠谱，跳过 */
      guess = [];
    }
    for (const n of guess) chars.push({ name: n, desc: '', raw: {} });
  }

  for (const t of texts) {
    for (const line of splitSentences(t)) {
      for (const w of PROP_WORDS) if (propHit(line, w)) { props.push(w); break; }
    }
  }

  /* 场景名去重时把「内景/外景 · X」里的 X 也收进来 */
  const sceneOut = uniq(places.map((p) => String(p).split(/[·.、\/]/).pop().trim()).filter((p) => p && p.length <= 12));
  const charOut = uniq(chars.map((c) => String(c.name || '').trim()).filter((n) => n.length >= 2 && n.length <= 6 && !/^(内景|外景|第.集)$/.test(n)));
  return {
    project,
    characters: charOut.map((n) => chars.find((c) => c.name === n) || { name: n, desc: '', raw: {} }),
    scenes: sceneOut,
    props: uniq(props).slice(0, 24),
    style: project.style || 'cinematic',
    genre: project.genre || ''
  };
}

function promptOf(cat, name, extra, style, genre) {
  const tail = [genre ? genre + '题材' : '现代都市', style === 'cinematic' ? '电影感，写实质感' : '绘本质感', '干净背景，主体清晰'].filter(Boolean).join('，');
  if (cat === 'character') return '角色「' + name + '」：' + (extra || '主角') + '，' + tail + '，半身肖像';
  if (cat === 'scene') return '场景「' + name + '」：' + (extra || '环境空镜') + '，' + tail + '，宽幅全景';
  return '道具「' + name + '」：' + (extra || '静物特写') + '，' + tail + '，产品级布光';
}

export function registerIngest(r) {
  /* ---------- 1. 上传剧本 / 分镜单，返回解析结果 ---------- */
  r.post('/api/ingest/upload', async (req, res, ctx) => {
    const files = ctx.files || [];
    if (!files.length) return reply(res, fail('请选择要上传的文件'));
    const f = files[0];
    const dir = path.join(MEDIA, 'upload');
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(f.filename || '').toLowerCase() || '.txt';
    const id = uid('doc_');
    const file = path.join(dir, id + ext);
    fs.writeFileSync(file, f.data);

    let parsed;
    try {
      parsed = readDocument(file, f.filename);
    } catch (e) {
      return reply(res, fail('解析失败：' + String((e && e.message) || e)));
    }

    const text = parsed.kind === 'text' ? parsed.text : '';
    const rows = parsed.kind === 'rows' ? parsed.rows : [];
    const flat = text || rows.map((r) => r.join(' ')).join('\n');

    /* 粗略判断是分镜单还是剧本：有镜号/景别/画面 表头就是分镜单 */
    const head = (rows[0] || []).join(' ');
    const looksStoryboard = /镜号|景别|画面|分镜|运镜|台词/.test(head) || (!text && rows.length > 3);
    const looksScript = /第[一二三四五六七八九十\d]+[集场]|场景|内景|外景|角色|人物/.test(flat);

    const minutes = Math.max(1, Math.round(flat.length / 1600));
    reply(res, ok({
      id: id,
      file: '/media/upload/' + id + ext,
      filename: f.filename,
      ext,
      kind: parsed.kind,
      text: text.slice(0, 20000),
      rows: rows.slice(0, 200),
      chars: flat.length,
      lines: flat.split('\n').filter(Boolean).length,
      looksStoryboard,
      looksScript,
      epsHint: Math.min(24, minutes),
      legacy: !!parsed.legacy
    }));
  });

  /* ---------- 2. 从上传内容直接建项目 ---------- */
  r.post('/api/ingest/create', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const text = String(b.text || '').trim();
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!text && !rows.length) return reply(res, fail('没有可用的剧本内容'));

    const title = String(b.title || '').trim() || (text ? (text.split('\n')[0] || '未命名项目').slice(0, 40) : '未命名项目');
    const project = {
      id: uid('pj_'), title, kind: (b.kind === 'storyboard' || b.kind === '分镜单') ? '分镜单' : (b.kind || '短剧'),
      genre: b.genre || '都市', logline: String(b.logline || '').slice(0, 200),
      idea: text.slice(0, 400), style: b.style || 'cinematic',
      palette: '午夜蓝', cover: null, status: 'draft', episodes: 0,
      owner: '本地用户', members: [], sourceScriptId: null, createdAt: now(), updatedAt: now()
    };
    d.projects.unshift(project);

    let epCount = 0, sbCount = 0;

    if (rows.length) {
      /* 分镜单：按行建分镜，遇到新集号就新建剧集 */
      const header = rows[0].map((h) => String(h || ''));
      const hasHeader = /镜号|景别|画面|台词|分镜/.test(header.join(' '));
      const body = hasHeader ? rows.slice(1) : rows;
      const col = (nameCands, fallback) => {
        const i = header.findIndex((h) => nameCands.some((n) => h.includes(n)));
        return i >= 0 ? i : fallback;
      };
      const cNo = col(['镜号', '序号'], 0);
      const cSize = col(['景别'], 1);
      const cShot = col(['画面', '描述', '内容'], 2);
      const cLine = col(['台词', '对白', '字幕'], 3);

      const ep = { id: uid('ep_'), projectId: project.id, no: 1, title: '第 1 集', logline: '', hook: '', status: 'draft', scenes: [], videoRel: null, createdAt: now(), updatedAt: now() };
      d.episodes.push(ep);
      epCount = 1;
      body.slice(0, 400).forEach((row, i) => {
        const prompt = String(row[cShot] || '').trim();
        const sb = {
          id: uid('sb_'), projectId: project.id, episodeId: ep.id, no: i + 1,
          size: String(row[cSize] || '中景').trim() || '中景',
          motion: 'zoom-in', look: 'cinematic', duration: 3,
          prompt: prompt || '分镜 ' + (i + 1),
          caption: String(row[cNo] || ('镜 ' + (i + 1))), dialog: String(row[cLine] || ''),
          mood: '', imageRel: null, videoRel: null, status: 'draft', createdAt: now()
        };
        d.storyboards.push(sb);
        sbCount++;
      });
    } else {
      /* 纯文本剧本：按「第N集」切分集，集内按空行切场 */
      const chunks = text.split(/(?=第[一二三四五六七八九十\d]+集)/g).map((s) => s.trim()).filter(Boolean);
      const parts = chunks.length ? chunks : [text];
      parts.slice(0, 24).forEach((seg, i) => {
        const ep = {
          id: uid('ep_'), projectId: project.id, no: i + 1,
          title: (seg.split('\n')[0] || ('第 ' + (i + 1) + ' 集')).slice(0, 40),
          logline: seg.replace(/\s+/g, ' ').slice(0, 120), hook: '', status: 'draft',
          scenes: [], videoRel: null, createdAt: now(), updatedAt: now()
        };
        const paras = seg.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).slice(1, 9);
        paras.forEach((p, k) => {
          const lines = p.split('\n').map((s) => s.trim()).filter(Boolean);
          const placeM = p.match(/(内景|外景)[\s·.、]+([^\s·.、]+)/) || p.match(/【(.+?)】/);
          ep.scenes.push({
            no: k + 1, beat: k === 0 ? '开场钩子' : '推进',
            place: placeM ? (placeM[2] || placeM[1]) : '未标注场景',
            time: '日', heading: lines[0] ? lines[0].slice(0, 40) : '',
            action: p.slice(0, 400),
            dialog: lines.filter((s) => /[:：]/.test(s)).slice(0, 6).map((s) => ({ role: s.split(/[:：]/)[0].trim().slice(0, 12), text: s.split(/[:：]/).slice(1).join(':').trim().slice(0, 120) })),
            mood: '', shots: []
          });
        });
        d.episodes.push(ep);
        epCount++;
      });
    }

    project.episodes = epCount;
    project.updatedAt = now();
    save();
    reply(res, ok({ project, episodes: epCount, storyboards: sbCount }));
  });

  /* ---------- 3. AI 智能提取资产：拆角色 / 场景 / 道具并生成提示词 ---------- */
  r.get('/api/projects/:id/extract/preview', (req, res, ctx) => {
    const e = extractFromProject(ctx.params.id);
    if (!e) return reply(res, fail('项目不存在'), 404);
    reply(res, ok({
      project: { id: e.project.id, title: e.project.title, genre: e.project.genre, style: e.project.style },
      characters: e.characters.map((c) => ({ name: c.name, desc: c.desc, prompt: promptOf('character', c.name, c.desc, e.style, e.genre) })),
      scenes: e.scenes.map((s) => ({ name: s, prompt: promptOf('scene', s, '', e.style, e.genre) })),
      props: e.props.map((p) => ({ name: p, prompt: promptOf('prop', p, '', e.style, e.genre) })),
      counts: { characters: e.characters.length, scenes: e.scenes.length, props: e.props.length }
    }));
  });

  r.post('/api/projects/:id/extract', async (req, res, ctx) => {
    const e = extractFromProject(ctx.params.id);
    if (!e) return reply(res, fail('项目不存在'), 404);
    const b = ctx.body || {};
    const want = {
      character: b.character !== false,
      scene: b.scene !== false,
      prop: b.prop === true
    };
    const d = db();
    const exist = new Set(d.assets.filter((a) => (a.projectIds || []).includes(e.project.id)).map((a) => (a.cat || '') + '|' + String((a.meta || {}).role || (a.meta || {}).setting || (a.meta || {}).implement || a.name)));

    const job = [];
    if (want.character) for (const c of e.characters) job.push({ cat: 'character', name: c.name, extra: c.desc });
    if (want.scene) for (const s of e.scenes) job.push({ cat: 'scene', name: s, extra: '环境空镜，无人' });
    if (want.prop) for (const p of e.props) job.push({ cat: 'prop', name: p, extra: '静物特写' });
    const todo = job.filter((j) => !exist.has(j.cat + '|' + j.name)).slice(0, Number(b.limit) || 18);
    if (!todo.length) return reply(res, ok({ created: 0, skipped: job.length, message: '资产清单已是最新，无需重新提取' }));

    const task = enqueue('asset-extract', { projectId: e.project.id, n: todo.length }, async ({ progress }) => {
      const { renderImage } = await import('../../engine/image.mjs');
      const made = [];
      for (let i = 0; i < todo.length; i++) {
        const it = todo[i];
        progress(6 + Math.round((i / todo.length) * 88), '生成资产图 ' + (i + 1) + '/' + todo.length + ' · ' + it.name);
        const prompt = promptOf(it.cat, it.name, it.extra, e.style, e.genre);
        const img = await renderImage({
          prompt, title: it.name,
          width: it.cat === 'character' ? 768 : 1024, height: it.cat === 'character' ? 1024 : 576,
          style: e.style, seedText: e.project.id + it.cat + it.name, index: i
        });
        const row = addAsset({
          name: it.name, kind: 'image', rel: img.rel, file: img.file, width: img.width, height: img.height,
          meta: { cat: it.cat, [it.cat === 'character' ? 'role' : it.cat === 'scene' ? 'setting' : 'implement']: it.name, prompt, projectId: e.project.id, extracted: true }
        });
        row.cat = it.cat;
        row.projectIds = [e.project.id];
        row.subject = true;
        made.push({ id: row.id, cat: it.cat, name: it.name, rel: row.rel });
      }
      e.project.updatedAt = now();
      save();
      return { ok: true, created: made.length, items: made };
    }, { tool: 'asset-extract', title: 'AI 提取资产 · ' + e.project.title, credits: todo.length });

    reply(res, ok(task));
  });

  /* ---------- 剧本拆分镜 / 匹配本集资产 / 拆解分镜脚本（官方 home.tutorial step4–step6） ---------- */
  const SIZES = ['远景', '全景', '中景', '近景', '特写'];
  const MOTIONS = ['推近', '拉远', '横向摇移', '跟随', '固定'];

  const epText = (ep) => {
    const parts = [ep.logline || '', ep.hook || ''];
    for (const s of ep.scenes || []) {
      parts.push(s.heading || '', s.action || '');
      for (const d of s.dialog || []) parts.push(String(d.role || '') + '：' + String(d.text || ''));
    }
    return parts.filter(Boolean).join('\n');
  };

  const planShots = (ep, opt = {}) => {
    const beats = [];
    for (const s of ep.scenes || []) {
      const lines = splitSentences(s.action || '').filter((x) => x.trim().length > 1);
      for (const ln of lines) beats.push({ place: s.place || '', text: ln.trim() });
      if (!lines.length && s.heading) beats.push({ place: s.place || '', text: s.heading });
    }
    if (!beats.length) beats.push({ place: '', text: ep.title || ep.logline || '画面' });
    const max = Math.max(1, Math.min(24, Number(opt.count) || Math.min(12, beats.length)));
    return beats.slice(0, max).map((b, i) => ({
      no: i + 1,
      place: b.place,
      size: i % 4 === 0 ? '全景' : i % 3 === 0 ? '近景' : i % 2 ? '中景' : '特写',
      motion: MOTIONS[i % MOTIONS.length],
      look: 'cinematic',
      duration: 3,
      caption: String(b.text).slice(0, 24),
      prompt: String(b.text).slice(0, 120),
      mood: '',
    }));
  };

  r.get('/api/episodes/:id/split/preview', (req, res, ctx) => {
    const ep = (db().episodes || []).find((x) => x.id === ctx.params.id);
    if (!ep) return reply(res, fail('剧集不存在'), 404);
    const shots = planShots(ep, {});
    reply(res, ok({ episode: { id: ep.id, title: ep.title, no: ep.no }, shots, count: shots.length, chars: epText(ep).length }));
  });

  r.post('/api/episodes/:id/split', (req, res, ctx) => {
    const d = db();
    const ep = (d.episodes || []).find((x) => x.id === ctx.params.id);
    if (!ep) return reply(res, fail('剧集不存在'), 404);
    const b = ctx.body || {};
    const shots = Array.isArray(b.shots) && b.shots.length ? b.shots : planShots(ep, b);
    const replace = b.replace !== false;
    if (replace) d.storyboards = (d.storyboards || []).filter((s) => s.episodeId !== ep.id);
    const base = (d.storyboards || []).filter((s) => s.episodeId === ep.id).length;
    const made = [];
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const row = {
        id: uid('sb_'), projectId: ep.projectId, episodeId: ep.id, no: base + i + 1,
        size: s.size || '中景', motion: s.motion || '推近', look: s.look || 'cinematic',
        duration: Number(s.duration) || 3, prompt: s.prompt || s.caption || '', caption: s.caption || '',
        dialog: s.dialog || '', mood: s.mood || '', place: s.place || '',
        imageRel: null, videoRel: null, status: 'idle', createdAt: now(),
      };
      d.storyboards.push(row);
      made.push(row);
    }
    ep.status = 'storyboard';
    ep.updatedAt = now();
    save();
    reply(res, ok({ episode: ep, storyboards: made, count: made.length }));
  });

  r.get('/api/episodes/:id/cast', (req, res, ctx) => {
    const d = db();
    const ep = (d.episodes || []).find((x) => x.id === ctx.params.id);
    if (!ep) return reply(res, fail('剧集不存在'), 404);
    const e = extractFromProject(ep.projectId);
    if (!e) return reply(res, fail('项目不存在'), 404);
    const text = epText(ep);
    const places = (ep.scenes || []).map((s) => String(s.place || '').trim()).filter(Boolean);
    const assetOf = (cat, name) => (d.assets || []).find((a) => {
      const m = a.meta || {};
      const key = cat === 'character' ? m.role : cat === 'scene' ? m.setting : m.implement;
      return (a.cat || '') === cat && String(key || '') === name;
    });
    const mk = (cat, name) => {
      const a = assetOf(cat, name);
      return {
        cat, name, matched: text.includes(name) || (cat === 'scene' && places.includes(name)),
        assetId: a ? a.id : null, rel: a ? a.rel : null,
        prompt: promptOf(cat, name, cat === 'character' ? '主体' : cat === 'scene' ? '环境空镜，无人' : '静物特写', e.style, e.genre),
      };
    };
    const characters = e.characters.map((c) => mk('character', c.name));
    const scenes = e.scenes.map((s) => mk('scene', s));
    const props = e.props.map((p) => mk('prop', p));
    reply(res, ok({
      episode: { id: ep.id, title: ep.title, no: ep.no },
      characters, scenes, props,
      selected: (ep.cast || []).map((c) => c.cat + '|' + c.name),
      places,
    }));
  });

  r.post('/api/episodes/:id/cast', (req, res, ctx) => {
    const d = db();
    const ep = (d.episodes || []).find((x) => x.id === ctx.params.id);
    if (!ep) return reply(res, fail('剧集不存在'), 404);
    const list = Array.isArray((ctx.body || {}).items) ? ctx.body.items : [];
    ep.cast = list.slice(0, 40).map((x) => ({ cat: String(x.cat || ''), name: String(x.name || ''), assetId: x.assetId || null, rel: x.rel || null }));
    ep.updatedAt = now();
    save();
    reply(res, ok({ cast: ep.cast, count: ep.cast.length }));
  });

  r.post('/api/episodes/:id/breakdown', (req, res, ctx) => {
    const d = db();
    const ep = (d.episodes || []).find((x) => x.id === ctx.params.id);
    if (!ep) return reply(res, fail('剧集不存在'), 404);
    const b = ctx.body || {};
    const ids = Array.isArray(b.ids) ? b.ids : null;
    const rows = (d.storyboards || []).filter((s) => s.episodeId === ep.id && (!ids || ids.includes(s.id)));
    if (!rows.length) return reply(res, fail('本集还没有分镜，先做剧本拆分镜'), 400);
    const cast = ep.cast || [];
    const lead = cast.filter((c) => c.cat === 'character').map((c) => c.name).slice(0, 3).join('、');
    const sceneName = cast.filter((c) => c.cat === 'scene').map((c) => c.name).slice(0, 2).join('、');
    const propName = cast.filter((c) => c.cat === 'prop').map((c) => c.name).slice(0, 3).join('、');
    for (const s of rows) {
      const bits = [s.size || '中景', s.motion || '', s.place || sceneName, lead, propName].filter(Boolean);
      const bodyText = String(s.prompt || s.caption || '').trim();
      s.prompt = bodyText ? (bodyText + '。镜头：' + bits.join('，')) : (bits.join('，') + '，电影感');
      s.broken = true;
      s.updatedAt = now();
    }
    ep.status = 'ready';
    ep.updatedAt = now();
    save();
    reply(res, ok({ count: rows.length, sample: rows[0] && rows[0].prompt }));
  });
}
