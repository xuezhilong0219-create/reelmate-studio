import { db, uid, now, save } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';

/* 知识库 / 提示词库 / 音色库 / 作品与创作者 / 合作中心 / 活动 / 影视与广告短剧详情 / 翻译与重绘详情 */

const VOICES = [
  { id: 'zh-CN', name: '中文女声 · 慧慧', lang: 'zh-CN', gender: 'female', engine: 'SAPI', note: '基准音色' },
  { id: 'zh-CN-soft', name: '中文柔声 · 低语', lang: 'zh-CN', gender: 'female', engine: 'SAPI+变调' },
  { id: 'zh-CN-news', name: '中文播报 · 新闻', lang: 'zh-CN', gender: 'female', engine: 'SAPI+变调' },
  { id: 'zh-CN-male', name: '中文男声 · 低沉', lang: 'zh-CN', gender: 'male', engine: 'SAPI+变调' },
  { id: 'narrator', name: '纪录片旁白', lang: 'zh-CN', gender: 'male', engine: 'SAPI+变调' },
  { id: 'child', name: '少年音', lang: 'zh-CN', gender: 'female', engine: 'SAPI+变调' },
  { id: 'elder', name: '长者音', lang: 'zh-CN', gender: 'male', engine: 'SAPI+变调' },
  { id: 'en-US', name: 'English · Zira', lang: 'en-US', gender: 'female', engine: 'SAPI' },
  { id: 'en-US-male', name: 'English · 低沉男声', lang: 'en-US', gender: 'male', engine: 'SAPI+变调' }
];

const ACTIVITY_SEED = [
  { key: 'new-year-short', title: '新春短剧共创季', sub: '用本地引擎拍一支 60 秒贺岁短片', tag: '征稿', reward: '首页推荐位', until: '长期' },
  { key: 'novel-adapt', title: '小说改编马拉松', sub: '上传小说，一键改编成分集剧本', tag: '改编', reward: '创作积分 ×2', until: '长期' },
  { key: 'ad-contest', title: '品牌广告短剧大赛', sub: '30 秒讲清一个卖点', tag: '比赛', reward: '合作中心优先派单', until: '长期' },
  { key: 'edu-channel', title: '教育频道共建', sub: '知识类短视频模板征集', tag: '共建', reward: '模板署名', until: '长期' }
];

export function registerExtra(r) {

  /* ---------------- 知识库 ---------------- */
  r.get('/api/knowledge', (req, res, ctx) => {
    const q = ctx.query || {};
    const d = db();
    let rows = d.knowledge.slice();
    if (q.tag) rows = rows.filter((x) => (x.tags || []).includes(q.tag));
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((x) => (x.title || '').toLowerCase().includes(s) || (x.content || '').toLowerCase().includes(s)); }
    const tags = Array.from(new Set(d.knowledge.flatMap((x) => x.tags || [])));
    reply(res, ok({ list: rows, total: rows.length, tags }));
  });

  r.post('/api/knowledge', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    if (!String(b.title || '').trim()) return reply(res, fail('请填写知识条目标题'));
    const row = {
      id: uid('kb_'), title: String(b.title).slice(0, 80), content: String(b.content || ''),
      tags: Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(/[,，\s]+/).filter(Boolean),
      kind: b.kind || 'note', source: b.source || '手动录入', author: (d.users[0] || {}).name || '本地用户',
      createdAt: now(), updatedAt: now()
    };
    d.knowledge.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.post('/api/knowledge/:id', (req, res, ctx) => {
    const d = db();
    const k = d.knowledge.find((x) => x.id === ctx.params.id);
    if (!k) return reply(res, fail('知识条目不存在'), 404);
    Object.assign(k, ctx.body || {}, { id: k.id, updatedAt: now() });
    save();
    reply(res, ok(k));
  });

  r.post('/api/knowledge/:id/delete', (req, res, ctx) => {
    const d = db();
    d.knowledge = d.knowledge.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* ---------------- 提示词库 ---------------- */
  r.get('/api/prompts', (req, res, ctx) => {
    const q = ctx.query || {};
    let rows = db().prompts.slice();
    if (q.kind) rows = rows.filter((x) => x.kind === q.kind);
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((x) => (x.title || '').toLowerCase().includes(s) || (x.text || '').toLowerCase().includes(s)); }
    reply(res, ok({ list: rows, total: rows.length }));
  });

  r.post('/api/prompts', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    if (!String(b.text || '').trim()) return reply(res, fail('请填写提示词内容'));
    const row = { id: uid('pm_'), title: String(b.title || b.text).slice(0, 60), text: String(b.text), kind: b.kind || 'image', tags: b.tags || [], uses: 0, createdAt: now() };
    d.prompts.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.post('/api/prompts/:id/delete', (req, res, ctx) => {
    const d = db();
    d.prompts = d.prompts.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  r.post('/api/prompts/:id/use', (req, res, ctx) => {
    const d = db();
    const p = d.prompts.find((x) => x.id === ctx.params.id);
    if (!p) return reply(res, fail('提示词不存在'), 404);
    p.uses = (p.uses || 0) + 1;
    save();
    reply(res, ok(p));
  });

  /* ---------------- 音色库 ---------------- */
  r.get('/api/voices', (req, res) => reply(res, ok({ list: VOICES })));

  /* ---------------- 作品 / 创作者中心：见 routes/works.mjs ---------------- */

  /* ---------------- 合作中心 ---------------- */
  r.get('/api/partner', (req, res) => {
    const d = db();
    const invites = d.invites || [];
    reply(res, ok({
      level: '本地合作方', commission: 0.8, unlimited: true,
      tickets: [
        { id: 'tk_1', title: '品牌 30 秒剧情广告', budget: '本地结算', status: 'open', need: '短剧 + 广告' },
        { id: 'tk_2', title: '小说改编分集剧', budget: '本地结算', status: 'open', need: '剧本 + 分镜' },
        { id: 'tk_3', title: '教育课程短视频', budget: '本地结算', status: 'open', need: '口播 + 配音' }
      ],
      invites,
      stats: { works: (d.works || []).length, projects: d.projects.length, members: d.members.length }
    }));
  });

  /* ---------------- 活动 ---------------- */
  r.get('/api/activities', (req, res) => {
    const d = db();
    if (!Array.isArray(d.activities) || !d.activities.length) {
      d.activities = ACTIVITY_SEED.map((a) => ({ id: 'ac_' + a.key, ...a, joined: 0, joinedByMe: false }));
      save();
    }
    reply(res, ok({ list: d.activities }));
  });

  r.post('/api/activities/:id/join', (req, res, ctx) => {
    const d = db();
    const a = (d.activities || []).find((x) => x.id === ctx.params.id);
    if (!a) return reply(res, fail('活动不存在'), 404);
    a.joinedByMe = !a.joinedByMe;
    a.joined = Math.max(0, (a.joined || 0) + (a.joinedByMe ? 1 : -1));
    save();
    reply(res, ok(a));
  });

  /* ---------------- 影视项目详情：见 routes/film.mjs ---------------- */

  /* ---------------- 广告短剧详情与生成 ---------------- */
  r.get('/api/ad-drama/:id', (req, res, ctx) => {
    const x = db().adDrama.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('广告短剧不存在'), 404);
    reply(res, ok(x));
  });

  r.post('/api/ad-drama/:id', (req, res, ctx) => {
    const d = db();
    const x = d.adDrama.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('广告短剧不存在'), 404);
    Object.assign(x, ctx.body || {}, { id: x.id, updatedAt: now() });
    save();
    reply(res, ok(x));
  });

  r.post('/api/ad-drama/:id/delete', (req, res, ctx) => {
    const d = db();
    d.adDrama = d.adDrama.filter((y) => y.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* 广告短剧一键成片：文案 → 分镜图 → 镜头 → 合成 + 配乐 */
  r.post('/api/ad-drama/:id/generate', async (req, res, ctx) => {
    const d = db();
    const x = d.adDrama.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('广告短剧不存在'), 404);
    const b = ctx.body || {};
    const task = enqueue('ad-drama', { id: x.id }, async ({ progress }) => {
      const { renderImage } = await import('../../engine/image.mjs');
      const { renderShot, concatShots, muxAudio } = await import('../../engine/video.mjs');
      const { renderMusic } = await import('../../engine/audio.mjs');
      const total = Math.max(10, Math.min(120, Number(x.duration) || 30));
      const n = Math.max(2, Math.min(6, Math.round(total / 8)));
      const per = Math.max(2, Math.round(total / n));
      const lines = [
        '开场：' + (x.product || '产品') + ' 出现在生活场景里',
        '痛点：' + (x.audience || '目标人群') + ' 正在遇到的麻烦',
        '转折：' + (x.product || '产品') + ' 给出解决方案',
        '卖点特写，画面高级质感',
        '使用后的轻松瞬间',
        '落版：品牌名 + 行动号召'
      ];
      const shots = [];
      for (let i = 0; i < n; i++) {
        progress(6 + Math.round((i / n) * 74), '广告镜头 ' + (i + 1) + '/' + n);
        const img = await renderImage({
          prompt: lines[i % lines.length] + '，' + (b.style || 'cinematic') + ' 广告质感',
          title: i === n - 1 ? (x.product || '品牌') : '',
          subtitle: i === n - 1 ? '立即体验' : '',
          width: 1280, height: 720, style: b.style || 'cinematic', seedText: x.id + i, index: i
        });
        const shot = await renderShot({ imageFile: img.file, duration: per, motion: i % 2 ? 'pan-right' : 'zoom-in', look: b.look || 'punch', caption: lines[i % lines.length] });
        shots.push({ ...shot, imageRel: img.rel, caption: lines[i % lines.length] });
      }
      progress(84, '合成成片');
      const merged = await concatShots(shots.map((s) => s.file), { transition: 'dissolve' });
      if (!merged || !merged.rel) return { ok: false, error: '合成失败' };
      let rel = merged.rel; let file = merged.file;
      try {
        progress(90, '配乐');
        const mus = await renderMusic({ prompt: '广告短片背景音乐，明亮有推进感', mood: 'happy', duration: Math.max(6, Math.round(merged.duration || total)) });
        if (mus && mus.file) {
          const muxed = await muxAudio(merged.file, mus.file, { volume: 0.5 });
          if (muxed && muxed.rel) { rel = muxed.rel; file = muxed.file; }
        }
      } catch (e) {}
      x.shots = shots.map((s) => ({ rel: s.rel, imageRel: s.imageRel, caption: s.caption }));
      x.videoRel = rel;
      x.status = 'done';
      save();
      return { ok: true, rel, file, shots: x.shots.length, duration: merged.duration };
    }, { tool: 'ad-drama', title: x.title, credits: 30 });
    reply(res, ok(task));
  });

  /* ---------------- 翻译 / 重绘详情 ---------------- */
  r.get('/api/translate/:id', (req, res, ctx) => {
    const x = db().translations.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('翻译任务不存在'), 404);
    reply(res, ok(x));
  });

  r.get('/api/redraw/:id', (req, res, ctx) => {
    const x = db().redraws.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('重绘任务不存在'), 404);
    reply(res, ok(x));
  });

  /* ---------------- 教程 ---------------- */
  r.get('/api/tutorial', (req, res) => {
    reply(res, ok({ list: [
      { key: 'start', title: '5 分钟上手', steps: ['打开工具箱选一个能力', '填写画面描述', '点开始生成，等进度条走完', '结果自动进入资产库'] },
      { key: 'script', title: '从小说到成片', steps: ['小说改编里导入原文', '开始分析拿到人物与分集', '改编为剧本并生成剧集项目', '批量生成分镜图与分镜视频', '整集合成导出'] },
      { key: 'team', title: '团队协作', steps: ['团队页添加成员与分组', '在权限矩阵勾选模块权限', '积分流水只做可视化统计，不阻塞生成'] },
      { key: 'local', title: '本地引擎说明', steps: ['图像由本地光栅引擎程序化绘制', '视频用 ffmpeg 做运镜与转场', '配音用 Windows SAPI，音效用合成器', '不联网、无额度限制'] }
    ] }));
  });
}