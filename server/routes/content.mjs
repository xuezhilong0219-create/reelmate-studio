import { db, uid, now, save } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';
import { makeScript, scriptToText, analyzeNovel, detectGenre, GENRES } from '../../engine/llm.mjs';

/* ================= 小说市场：内置精选书单 ================= */
const MARKET_TAGS = ['都市', '古装', '悬疑', '甜宠', '科幻', '玄幻', '职场', '校园', '家庭', '犯罪'];
const MARKET_CATS = ['现代言情', '古代言情', '悬疑推理', '科幻未来', '玄幻仙侠', '职场商战', '青春校园'];

const MARKET_CATALOG = [
  { id: 'mk_night_train', title: '夜班列车', genre: '悬疑', cat: '悬疑推理', tags: ['悬疑', '犯罪'], chapters: 8, words: 96000, heat: 9812,
    intro: '末班列车每晚多出一节车厢，只有值夜员看得见。第七天，他在那节车厢里看见了自己的名字。' },
  { id: 'mk_snow_changan', title: '雪落长门', genre: '古装', cat: '古代言情', tags: ['古装', '家庭'], chapters: 12, words: 152000, heat: 8640,
    intro: '长门宫的最后一场雪落下时，废后正在替仇人缝一件冬衣。' },
  { id: 'mk_orbit_echo', title: '轨道回声', genre: '科幻', cat: '科幻未来', tags: ['科幻', '悬疑'], chapters: 10, words: 118000, heat: 7720,
    intro: '记忆可以备份，但不能删除。于是所有人都学会了在同一段人生里反复撒谎。' },
  { id: 'mk_sugar_shop', title: '楼下有家糖水铺', genre: '甜宠', cat: '现代言情', tags: ['甜宠', '都市'], chapters: 9, words: 87000, heat: 12040,
    intro: '她每晚十点去买一碗双皮奶，只为看老板把糖罐放回同一个位置。' },
  { id: 'mk_sword_cloud', title: '云海剑冢', genre: '玄幻', cat: '玄幻仙侠', tags: ['玄幻', '古装'], chapters: 15, words: 210000, heat: 6550,
    intro: '剑冢里埋着三千把断剑，只有一把愿意认一个不会用剑的人做主人。' },
  { id: 'mk_office_27', title: '二十七层的灯', genre: '职场', cat: '职场商战', tags: ['职场', '都市'], chapters: 11, words: 105000, heat: 5310,
    intro: '整层楼只有她那一盏灯亮到凌晨三点，直到新来的总监把电闸拉了。' },
  { id: 'mk_last_desk', title: '最后一排靠窗', genre: '校园', cat: '青春校园', tags: ['校园', '甜宠'], chapters: 7, words: 68000, heat: 9330,
    intro: '毕业照那天，最后一排靠窗的位置空着，谁也没提那个人为什么没来。' },
  { id: 'mk_old_house', title: '老房子的年夜饭', genre: '家庭', cat: '现代言情', tags: ['家庭'], chapters: 6, words: 54000, heat: 4180,
    intro: '父亲走后第三年，四兄妹第一次在同一张桌子上吃饭，为的是把房子卖掉。' },
  { id: 'mk_dock_rain', title: '码头没有雨', genre: '犯罪', cat: '悬疑推理', tags: ['犯罪', '悬疑'], chapters: 13, words: 143000, heat: 7020,
    intro: '卧底第七年，他终于等到一句“收网”，却先等来了自己人的枪口。' },
  { id: 'mk_midnight_radio', title: '午夜电台', genre: '都市', cat: '现代言情', tags: ['都市', '悬疑'], chapters: 8, words: 91000, heat: 6180,
    intro: '凌晨一点的电话里，那个女人说：“我三年前就死了，你还记得我吗？”' },
];

const SAMPLE_CH = [
  '风从楼缝里穿过，整座城市像一台没关掉的机器，低低地响。',
  '她把外套的拉链拉到下巴，还是觉得冷，那种从骨头里渗出来的冷。',
  '走廊尽头的灯坏了很久，物业一直说下周修，下周从来没来过。',
  '他站在门口没有进来，只把一张折过两次的纸放在鞋柜上。',
  '“你确定要看？”她问。他没有回答，只是把手指按在纸的边缘。',
  '纸上的字迹很轻，像是写的人怕惊动什么。',
  '那一瞬间，三年前那个雨夜的所有细节一起回来了。',
  '她听见自己的心跳，比雨点更密。',
  '“这件事到此为止。”他说完就走了，脚步声在楼道里拖得很长。',
  '窗外的车灯扫过天花板，一晃，又暗下去。',
  '第二天她还是去了那个地方，明知道不该去。',
  '门是虚掩的，里面有人在等她，桌上摆着两杯已经凉掉的茶。',
  '“你迟到了四年。”对方说。',
  '所有准备好的话，在这一句面前全部失效。',
  '她坐下来，把那张纸推过去，指尖有些抖。',
  '对面的人没有看纸，只是一直看着她，像在确认什么。',
  '“我不需要证据，”对方说，“我需要你记得。”',
  '那一刻她忽然明白，所谓真相，不过是有人愿意替你记住。',
  '雨又开始下了，比昨夜更大。',
  '她站起来，把椅子推回原位，然后转身走进雨里。'
];

/** 依据书单条目拼出一段可分析、可改编的样章正文 */
function buildSampleText(b) {
  const g = GENRES[b.genre] || GENRES['都市'];
  const out = ['《' + b.title + '》', '', b.intro || ''];
  const n = 4;
  for (let c = 1; c <= n; c++) {
    out.push('', '第' + c + '章 · ' + ['初见', '裂痕', '旧信', '雨夜'][(c - 1) % 4]);
    const start = (c * 3) % SAMPLE_CH.length;
    for (let i = 0; i < 6; i++) out.push(SAMPLE_CH[(start + i) % SAMPLE_CH.length]);
    out.push('地点是' + g.loc[(c + i0(c)) % g.loc.length] + '，气氛' + ['压抑', '克制', '暗涌', '锋利'][c % 4] + '。');
  }
  return out.join('\n');
}
function i0(c) { return c * 2; }

export function registerContent(r) {

  /* ================= 剧本项目 ================= */
  r.get('/api/projects', (req, res, ctx) => {
    const q = ctx.query || {};
    const d = db();
    let rows = d.projects.slice();
    if (q.kind) rows = rows.filter((p) => p.kind === q.kind);
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((p) => (p.title || '').toLowerCase().includes(s)); }
    reply(res, ok({ list: rows, total: rows.length }));
  });

  r.post('/api/projects', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = {
      id: uid('pj_'),
      title: String(b.title || '未命名项目').slice(0, 60),
      kind: b.kind || 'script',
      genre: b.genre || detectGenre(b.title || b.idea || ''),
      logline: b.logline || '',
      idea: b.idea || '',
      style: b.style || '短剧',
      palette: (GENRES[b.genre] || GENRES['都市']).palette,
      cover: b.cover || null,
      status: b.status || 'draft',
      episodes: 0,
      owner: d.users[0].name,
      members: [d.users[0].id],
      createdAt: now(),
      updatedAt: now()
    };
    d.projects.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.get('/api/projects/:id', (req, res, ctx) => {
    const d = db();
    const p = d.projects.find((x) => x.id === ctx.params.id);
    if (!p) return reply(res, fail('项目不存在'), 404);
    const eps = d.episodes.filter((e) => e.projectId === p.id);
    reply(res, ok({ project: p, episodes: eps, scripts: d.scripts.filter((s) => s.projectId === p.id) }));
  });

  r.post('/api/projects/:id', (req, res, ctx) => {
    const d = db();
    const p = d.projects.find((x) => x.id === ctx.params.id);
    if (!p) return reply(res, fail('项目不存在'), 404);
    Object.assign(p, ctx.body || {}, { updatedAt: now(), id: p.id });
    save();
    reply(res, ok(p));
  });

  r.post('/api/projects/:id/delete', (req, res, ctx) => {
    const d = db();
    d.projects = d.projects.filter((x) => x.id !== ctx.params.id);
    d.episodes = d.episodes.filter((x) => x.projectId !== ctx.params.id);
    d.storyboards = d.storyboards.filter((x) => x.projectId !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ================= 剧集 ================= */
  r.get('/api/projects/:id/episodes', (req, res, ctx) => {
    const d = db();
    const eps = d.episodes.filter((e) => e.projectId === ctx.params.id).sort((a, b) => a.no - b.no);
    reply(res, ok({ list: eps }));
  });

  r.post('/api/projects/:id/episodes', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const siblings = d.episodes.filter((e) => e.projectId === ctx.params.id);
    const row = {
      id: uid('ep_'), projectId: ctx.params.id,
      no: siblings.length + 1,
      title: String(b.title || '第' + (siblings.length + 1) + '集').slice(0, 60),
      logline: b.logline || '', hook: b.hook || '',
      status: b.status || 'draft',
      scenes: Array.isArray(b.scenes) ? b.scenes : [],
      createdAt: now(), updatedAt: now()
    };
    d.episodes.push(row);
    const p = d.projects.find((x) => x.id === ctx.params.id);
    if (p) { p.episodes = d.episodes.filter((e) => e.projectId === p.id).length; p.updatedAt = now(); }
    save();
    reply(res, ok(row));
  });

  r.get('/api/episodes/:id', (req, res, ctx) => {
    const d = db();
    const e = d.episodes.find((x) => x.id === ctx.params.id);
    if (!e) return reply(res, fail('剧集不存在'), 404);
    const boards = d.storyboards.filter((s) => s.episodeId === e.id).sort((a, b) => a.no - b.no);
    reply(res, ok({ episode: e, storyboards: boards }));
  });

  r.post('/api/episodes/:id', (req, res, ctx) => {
    const d = db();
    const e = d.episodes.find((x) => x.id === ctx.params.id);
    if (!e) return reply(res, fail('剧集不存在'), 404);
    Object.assign(e, ctx.body || {}, { id: e.id, projectId: e.projectId, updatedAt: now() });
    save();
    reply(res, ok(e));
  });

  r.post('/api/episodes/:id/delete', (req, res, ctx) => {
    const d = db();
    const e = d.episodes.find((x) => x.id === ctx.params.id);
    d.episodes = d.episodes.filter((x) => x.id !== ctx.params.id);
    d.storyboards = d.storyboards.filter((x) => x.episodeId !== ctx.params.id);
    save();
    reply(res, ok({ ok: true, episode: e }));
  });

  /* ================= 分镜 ================= */
  r.get('/api/episodes/:id/storyboards', (req, res, ctx) => {
    const d = db();
    reply(res, ok({ list: d.storyboards.filter((s) => s.episodeId === ctx.params.id).sort((a, b) => a.no - b.no) }));
  });

  r.post('/api/episodes/:id/storyboards', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const sibs = d.storyboards.filter((s) => s.episodeId === ctx.params.id);
    const row = {
      id: uid('sb_'), projectId: b.projectId || null, episodeId: ctx.params.id,
      no: sibs.length + 1,
      size: b.size || '中景', motion: b.motion || 'zoom-in', look: b.look || 'cinematic',
      duration: Number(b.duration) || 3,
      prompt: b.prompt || '', caption: b.caption || '', dialog: b.dialog || '',
      imageRel: null, videoRel: null, assetImageId: null, assetVideoId: null,
      status: 'draft', createdAt: now()
    };
    d.storyboards.push(row);
    save();
    reply(res, ok(row));
  });

  /* 批量生成分镜图 */
  r.post('/api/storyboards/batch-image', async (req, res, ctx) => {
    const b = ctx.body || {};
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (!ids.length) return reply(res, fail('请选择分镜'));
    const d = db();
    const task = enqueue('storyboard-image', { ids }, async ({ progress }) => {
      const { renderImage } = await import('../../engine/image.mjs');
      const out = [];
      for (let i = 0; i < ids.length; i++) {
        progress(5 + Math.round((i / ids.length) * 85), '分镜图 ' + (i + 1) + '/' + ids.length);
        const s = d.storyboards.find((x) => x.id === ids[i]);
        if (!s) continue;
        const img = await renderImage({ prompt: s.prompt || s.caption || '分镜', title: s.caption || '', width: 1280, height: 720, style: 'cinematic', seedText: s.prompt + s.no, index: s.no });
        s.imageRel = img.rel;
        s.status = 'image';
        out.push({ id: s.id, rel: img.rel });
      }
      save();
      return { ok: true, items: out, count: out.length };
    }, { tool: 'storyboard-image', title: '批量分镜图', credits: ids.length * 2 });
    reply(res, ok(task));
  });

  /* 批量生成分镜视频（图→视频，然后整集合成） */
  r.post('/api/storyboards/batch-video', async (req, res, ctx) => {
    const b = ctx.body || {};
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (!ids.length) return reply(res, fail('请选择分镜'));
    const d = db();
    const task = enqueue('storyboard-video', { ids }, async ({ progress }) => {
      const { renderImage } = await import('../../engine/image.mjs');
      const { renderShot, concatShots } = await import('../../engine/video.mjs');
      const shots = [];
      for (let i = 0; i < ids.length; i++) {
        progress(5 + Math.round((i / ids.length) * 75), '分镜视频 ' + (i + 1) + '/' + ids.length);
        const s = d.storyboards.find((x) => x.id === ids[i]);
        if (!s) continue;
        let src = s.imageRel ? { file: (await import('../db.mjs')).MEDIA + s.imageRel.replace('/media', '') } : null;
        if (!src || !s.imageRel) {
          const img = await renderImage({ prompt: s.prompt || '分镜', title: s.caption || '', width: 1280, height: 720, style: 'cinematic', seedText: s.prompt + s.no, index: s.no });
          s.imageRel = img.rel; src = img;
        }
        const shot = await renderShot({ imageFile: src.file, duration: s.duration || 3, motion: s.motion, look: s.look, subtitle: s.dialog, caption: s.caption });
        s.videoRel = shot.rel;
        s.status = 'done';
        shots.push(shot);
      }
      progress(88, '整集合成');
      const merged = await concatShots(shots.map((s) => s.file), { transition: b.transition || 'dissolve' });
      const ep = ids.length ? d.storyboards.find((x) => x.id === ids[0]) : null;
      if (ep) {
        const episode = d.episodes.find((e) => e.id === ep.episodeId);
        if (episode) { episode.videoRel = merged.rel; episode.status = 'done'; }
      }
      save();
      return { ok: true, videoRel: merged.rel, duration: merged.duration, count: shots.length };
    }, { tool: 'storyboard-video', title: '批量分镜视频', credits: ids.length * 6 });
    reply(res, ok(task));
  });

  r.post('/api/storyboards/:id', (req, res, ctx) => {
    const d = db();
    const s = d.storyboards.find((x) => x.id === ctx.params.id);
    if (!s) return reply(res, fail('分镜不存在'), 404);
    Object.assign(s, ctx.body || {}, { id: s.id });
    save();
    reply(res, ok(s));
  });

  r.post('/api/storyboards/:id/delete', (req, res, ctx) => {
    const d = db();
    d.storyboards = d.storyboards.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ================= 剧本生成 ================= */
  r.get('/api/scripts', (req, res) => reply(res, ok({ list: db().scripts })));

  r.get('/api/scripts/:id', (req, res, ctx) => {
    const s = db().scripts.find((x) => x.id === ctx.params.id);
    if (!s) return reply(res, fail('剧本不存在'), 404);
    reply(res, ok(s));
  });

  r.post('/api/scripts/generate', async (req, res, ctx) => {
    const b = ctx.body || {};
    const idea = String(b.idea || '').trim();
    if (!idea && !b.title) return reply(res, fail('请填写故事创意'));
    const d = db();
    const task = enqueue('script-generate', b, async ({ progress }) => {
      progress(20, '构思人物');
      const llm = await import('../../engine/llm.mjs');
      let script = null;
      if (llm.llmEnabled() && b.useLLM !== false) {
        progress(35, '调用大模型');
        script = await llm.chatJSON([
          { role: 'system', content: '你是短剧编剧，只输出 JSON。结构：{"title":"","genre":"","logline":"","characters":[{"name":"","gender":"","age":0,"identity":"","trait":"","goal":"","secret":""}],"episodes":[{"no":1,"title":"","logline":"","hook":"","scenes":[{"no":1,"heading":"","action":"","dialog":[{"role":"","text":""}],"mood":"","shots":[{"no":1,"size":"","duration":3,"motion":"zoom-in","look":"cinematic","prompt":"","caption":""}]}]}]}' },
          { role: 'user', content: '创意：' + idea + '\n集数：' + (b.episodes || 3) + '，每集场数：' + (b.scenesPerEp || 3) }
        ], { maxTokens: 6000 });
      }
      if (!script) script = makeScript({ idea, title: b.title, genre: b.genre, episodes: Number(b.episodes) || 3, scenesPerEp: Number(b.scenesPerEp) || 3, style: b.style });
      progress(75, '整理剧本');
      const row = {
        id: uid('sc_'), title: script.title, genre: script.genre || detectGenre(idea), style: script.style || '短剧',
        logline: script.logline || '', projectId: b.projectId || null,
        script, text: scriptToText(script), createdAt: now()
      };
      d.scripts.unshift(row);
      if (b.projectId) {
        const p = d.projects.find((x) => x.id === b.projectId);
        if (p) { p.updatedAt = now(); p.status = 'scripted'; }
      }
      save();
      return { ok: true, id: row.id, script, text: row.text };
    }, { tool: 'script-generate', title: (b.title || idea).slice(0, 24), credits: 8 });
    reply(res, ok(task));
  });

  /* 剧本 → 项目（把生成的剧集/分镜灌进项目） */
  r.post('/api/scripts/:id/to-project', (req, res, ctx) => {
    const d = db();
    const s = d.scripts.find((x) => x.id === ctx.params.id);
    if (!s) return reply(res, fail('剧本不存在'), 404);
    const b = ctx.body || {};
    const p = {
      id: uid('pj_'), title: s.title, kind: 'drama', genre: s.genre, logline: s.logline,
      idea: '', style: s.style, palette: (GENRES[s.genre] || GENRES['都市']).palette,
      cover: null, status: 'scripted', episodes: 0, owner: d.users[0].name,
      members: [d.users[0].id], sourceScriptId: s.id, createdAt: now(), updatedAt: now()
    };
    d.projects.unshift(p);
    const created = [];
    for (const ep of s.script.episodes || []) {
      const episode = {
        id: uid('ep_'), projectId: p.id, no: ep.no, title: ep.title, logline: ep.logline,
        hook: ep.hook || '', status: 'draft', scenes: ep.scenes || [], videoRel: null, createdAt: now(), updatedAt: now()
      };
      d.episodes.push(episode);
      for (const sc of ep.scenes || []) {
        for (const sh of sc.shots || []) {
          d.storyboards.push({
            id: uid('sb_'), projectId: p.id, episodeId: episode.id, no: sh.no,
            size: sh.size, motion: sh.motion, look: sh.look, duration: sh.duration,
            prompt: sh.prompt, caption: sc.heading + (sh.caption ? ' · ' + sh.caption : ''),
            dialog: (sc.dialog || []).map((x) => x.role + '：' + x.text).join('\n'),
            mood: sc.mood, imageRel: null, videoRel: null, status: 'draft', createdAt: now()
          });
        }
      }
      created.push(episode);
    }
    p.episodes = created.length;
    save();
    reply(res, ok({ project: p, episodes: created.length }));
  });

  /* ================= 小说 / 改编 ================= */
  r.get('/api/novels', (req, res) => reply(res, ok({ list: db().novels })));

  r.post('/api/novels', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = {
      id: uid('nv_'), title: String(b.title || '未命名小说').slice(0, 60),
      text: String(b.text || ''), genre: detectGenre(b.text || b.title || ''),
      chapters: 0, status: 'imported', analysis: null, createdAt: now()
    };
    d.novels.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.get('/api/novels/:id', (req, res, ctx) => {
    const n = db().novels.find((x) => x.id === ctx.params.id);
    if (!n) return reply(res, fail('小说不存在'), 404);
    reply(res, ok(n));
  });

  r.post('/api/novels/:id/delete', (req, res, ctx) => {
    const d = db();
    d.novels = d.novels.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* 小说分析：世界观 / 角色卡 / 章节 / 剧集大纲 */
  r.post('/api/novels/:id/analyze', async (req, res, ctx) => {
    const d = db();
    const n = d.novels.find((x) => x.id === ctx.params.id);
    if (!n) return reply(res, fail('小说不存在'), 404);
    const task = enqueue('novel-analyze', { id: n.id }, async ({ progress }) => {
      const llm = await import('../../engine/llm.mjs');
      progress(30, '解析正文');
      let result = null;
      if (llm.llmEnabled()) {
        progress(45, '大模型分析');
        result = await llm.chatJSON([
          { role: 'system', content: '你是小说改编顾问，只输出 JSON：{"worldview":{"era":"","rules":"","conflict":"","tone":""},"characters":[{"name":"","gender":"","age":0,"identity":"","trait":"","goal":"","secret":""}],"chapters":[{"no":1,"title":"","summary":"","key":""}],"episodes":[{"no":1,"title":"","summary":"","chapters":[1,2]}]}' },
          { role: 'user', content: String(n.text).slice(0, 12000) }
        ], { maxTokens: 6000 });
      }
      if (!result) result = analyzeNovel(n.text, { title: n.title });
      progress(85, '写入');
      n.analysis = result;
      n.chapters = (result.chapters || []).length;
      n.status = 'analyzed';
      save();
      return { ok: true, analysis: result };
    }, { tool: 'novel-analyze', title: n.title, credits: 6 });
    reply(res, ok(task));
  });

  /* 小说 → 剧本 */
  r.post('/api/novels/:id/to-script', async (req, res, ctx) => {
    const d = db();
    const n = d.novels.find((x) => x.id === ctx.params.id);
    if (!n) return reply(res, fail('小说不存在'), 404);
    const task = enqueue('novel-to-script', { id: n.id }, async ({ progress }) => {
      const llm = await import('../../engine/llm.mjs');
      progress(40, '改编剧本');
      const script = makeScript({ idea: n.text.slice(0, 800) || n.title, title: n.title, genre: n.genre, episodes: Math.max(3, n.chapters || 6), scenesPerEp: 3 });
      const row = { id: uid('sc_'), title: script.title + '（改编）', genre: n.genre, style: '短剧', logline: script.logline, script, text: scriptToText(script), novelId: n.id, createdAt: now() };
      d.scripts.unshift(row);
      n.status = 'scripted';
      save();
      return { ok: true, id: row.id, script };
    }, { tool: 'novel-to-script', title: n.title, credits: 10 });
    reply(res, ok(task));
  });

  /* 小说市场（内置示例书单 + 本地库，供改编练习） */
  r.get('/api/novel-market', (req, res, ctx) => {
    const q = ctx.query || {};
    const tags = MARKET_TAGS;
    const cats = MARKET_CATS;
    let rows = [
      ...MARKET_CATALOG.map((b) => ({ ...b, source: '精选书单', imported: !!db().novels.find((n) => n.marketId === b.id) })),
      ...db().novels.map((n) => ({ id: n.marketId || n.id, dbId: n.id, title: n.title, genre: n.genre, tags: [n.genre], chapters: n.chapters, intro: String(n.text || '').slice(0, 80), source: '我的书架', imported: true }))
    ];
    if (q.cat) rows = rows.filter((x) => x.cat === q.cat);
    if (q.tag) rows = rows.filter((x) => (x.tags || []).includes(q.tag));
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((x) => (x.title || '').toLowerCase().includes(s) || String(x.intro || '').toLowerCase().includes(s)); }
    reply(res, ok({ tags, categories: cats, list: rows, total: rows.length }));
  });

  /* 一键导入精选书单到我的书架（内置样章正文，可直接分析改编） */
  r.post('/api/novel-market/:id/import', (req, res, ctx) => {
    const b = MARKET_CATALOG.find((x) => x.id === ctx.params.id);
    if (!b) return reply(res, fail('书目不存在'), 404);
    const d = db();
    const exist = d.novels.find((n) => n.marketId === b.id);
    if (exist) return reply(res, ok(exist));
    const text = buildSampleText(b);
    const row = {
      id: uid('nv_'), marketId: b.id, title: b.title, text,
      genre: b.genre, chapters: b.chapters, status: 'imported', analysis: null, createdAt: now()
    };
    d.novels.unshift(row);
    save();
    reply(res, ok(row));
  });

  /* 分集大纲批量生成（小说改编流水线） */
  r.post('/api/novels/:id/outline', async (req, res, ctx) => {
    const d = db();
    const n = d.novels.find((x) => x.id === ctx.params.id);
    if (!n) return reply(res, fail('小说不存在'), 404);
    const analysis = n.analysis || analyzeNovel(n.text, { title: n.title });
    n.analysis = analysis;
    save();
    reply(res, ok({ episodes: analysis.episodes, chapters: analysis.chapters }));
  });
}
