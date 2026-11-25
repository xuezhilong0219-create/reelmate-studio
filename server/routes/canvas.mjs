import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, save, MEDIA } from '../db.mjs';
import { ok, fail, reply } from '../route.mjs';
import { enqueue } from '../queue.mjs';

const relFile = (rel) => (rel ? path.join(MEDIA, String(rel).replace(/^\/media\//, '')) : null);

/* 画布节点上游：返回入边来的节点（含其 data.rel） */
function upstream(c, nodeId) {
  const ids = (c.edges || []).filter((e) => (e.to || e.target) === nodeId).map((e) => e.from || e.source);
  return ids.map((id) => (c.nodes || []).find((n) => n.id === id)).filter(Boolean);
}

/* 自由画布 / 工作流 / 3D 导演台 / 影视项目 / 广告短剧 / 视频翻译 */
export function registerCanvas(r) {

  /* ---------- 自由画布 ---------- */
  r.get('/api/canvas', (req, res) => reply(res, ok({ list: db().canvasProjects })));

  r.post('/api/canvas', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = {
      id: uid('cv_'), title: String(b.title || '未命名画布').slice(0, 50),
      nodes: Array.isArray(b.nodes) ? b.nodes : [],
      edges: Array.isArray(b.edges) ? b.edges : [],
      view: b.view || { x: 0, y: 0, zoom: 1 },
      share: null, pinned: [], createdAt: now(), updatedAt: now()
    };
    d.canvasProjects.unshift(row);
    save();
    reply(res, ok(row));
  });

  r.get('/api/canvas/:id', (req, res, ctx) => {
    const c = db().canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    reply(res, ok(c));
  });

  r.post('/api/canvas/:id', (req, res, ctx) => {
    const d = db();
    const c = d.canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    Object.assign(c, ctx.body || {}, { id: c.id, updatedAt: now() });
    save();
    reply(res, ok(c));
  });

  r.post('/api/canvas/:id/delete', (req, res, ctx) => {
    const d = db();
    d.canvasProjects = d.canvasProjects.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  r.post('/api/canvas/:id/share', (req, res, ctx) => {
    const d = db();
    const c = d.canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    c.share = c.share || { token: uid('sh_'), createdAt: now(), enabled: true };
    c.share.enabled = (ctx.body || {}).enabled !== false;
    save();
    reply(res, ok(c.share));
  });

  /* 画布节点执行：text/image/video 节点跑生成 */
  r.post('/api/canvas/:id/run-node', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const c = d.canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    const node = (c.nodes || []).find((n) => n.id === b.nodeId);
    if (!node) return reply(res, fail('节点不存在'), 404);
    const kind = node.type === 'image' ? 'text-to-image' : node.type === 'video' ? 'text-to-video' : node.type === 'audio' ? 'text-to-music'
      : node.type === 'clip' ? 'clip' : node.type === 'script' ? 'script' : node.type === 'asset' ? 'asset'
      : node.type === 'table' ? 'table' : node.type === 'threeDWorld' ? 'threeDWorld' : node.type === 'director' ? 'director'
      : node.type === 'upload' ? 'upload' : 'text-to-image';
    const task = enqueue('canvas-node', { canvasId: c.id, nodeId: node.id }, async ({ progress }) => {
      progress(30, '节点执行');
      if (kind === 'text-to-image') {
        const { renderImage } = await import('../../engine/image.mjs');
        const img = await renderImage({ prompt: node.data && node.data.prompt || '画布节点', width: 1024, height: 576, seedText: node.id });
        node.data = { ...(node.data || {}), rel: img.rel };
      } else if (kind === 'text-to-video') {
        const { renderImage } = await import('../../engine/image.mjs');
        const { renderShot } = await import('../../engine/video.mjs');
        const plate = await renderImage({ prompt: node.data && node.data.prompt || '画布节点', width: 1024, height: 576, seedText: node.id });
        const shot = await renderShot({ imageFile: plate.file, duration: 3, motion: 'zoom-in' });
        node.data = { ...(node.data || {}), rel: shot.rel };
      } else if (kind === 'clip') {
        /* 视频合成：把上游所有视频/图片节点按连线顺序拼成一条成片 */
        const { concatShots, renderShot } = await import('../../engine/video.mjs');
        const ups = upstream(c, node.id).map((n) => relFile(n.data && n.data.rel)).filter((x) => x && fs.existsSync(x));
        if (!ups.length) throw new Error('合成节点上游没有可用的视频或图片');
        progress(45, '合成 ' + ups.length + ' 段');
        /* 静态图片先转成 3 秒镜头，才能参与拼接 */
        const clips = [];
        for (const file of ups) {
          if (/\.(png|jpe?g|webp)$/i.test(file)) {
            const shot = await renderShot({ imageFile: file, duration: 3, motion: 'zoom-in' });
            if (!shot.ok) throw new Error('图片转镜头失败');
            clips.push(shot.file);
          } else clips.push(file);
        }
        const merged = await concatShots(clips, { transition: (node.data && node.data.transition) || 'dissolve' });
        if (!merged.ok) throw new Error(merged.error || '合成失败');
        node.data = { ...(node.data || {}), rel: merged.rel, segments: clips.length };
      } else if (kind === 'script') {
        /* 分镜节点：按场景/景别/台词生成分镜板 */
        const { renderImage } = await import('../../engine/image.mjs');
        const dt = node.data || {};
        const prompt = [dt.scene, dt.size, dt.dialog].filter(Boolean).join(' · ') || dt.prompt || '分镜';
        const img = await renderImage({
          prompt, width: 1024, height: 576, seedText: node.id,
          title: dt.scene || '分镜', subtitle: dt.dialog || '', tag: dt.size || '中景'
        });
        node.data = { ...dt, rel: img.rel };
      } else if (kind === 'asset') {
        if (!(node.data && node.data.rel)) throw new Error('资产节点还没有选择素材');
      } else if (kind === 'table') {
        /* 表格节点：自定义表格 / 上传分镜单都渲染成表格图 */
        const { renderTableImage } = await import('../../engine/nodes.mjs');
        const dt = node.data || {};
        const img = await renderTableImage({ title: dt.title || '', text: dt.text || '', rows: dt.rows, header: dt.header !== false });
        node.data = { ...dt, rel: img.rel, cols: img.cols, rowsCount: img.rows };
      } else if (kind === 'threeDWorld') {
        /* 3D 世界：720° 全景（可用上游图或提示词生成底图） */
        const { threeDWorld } = await import('../../engine/nodes.mjs');
        const dt = node.data || {};
        const upRel = upstream(c, node.id).map((n) => n.data && n.data.rel).find((x) => x);
        const src = relFile(dt.rel || upRel);
        const pano = await threeDWorld(src && fs.existsSync(src) ? src : null, { prompt: dt.prompt, turns: dt.turns || 2, elevation: dt.elevation || 0, seed: node.id });
        node.data = { ...dt, rel: pano.rel, panorama: true, angle: pano.angle };
      } else if (kind === 'director') {
        /* 3D 导演台节点：渲染当前机位 */
        const { renderStage } = await import('../../engine/stage.mjs');
        const dt = node.data || {};
        const proj = dt.directorId ? (db().director || []).find((x) => x.id === dt.directorId) : null;
        const scene = proj || {
          title: dt.title || '画布导演台',
          stage: dt.stage || { width: 20, depth: 20, ground: '#1a1a1f' },
          actors: dt.actors || [{ x: -1.6, z: 0, height: 1.8, color: 'blue', pose: 'idle', facing: 0 }],
          cameras: dt.cameras || [{ id: 'cam1', name: '主摄', fov: 42, pos: { x: 0, y: 2.2, z: 8 }, yaw: 0, pitch: -4 }],
          activeCamera: dt.activeCamera || 'cam1',
        };
        const frame = await renderStage(scene, { width: 1280, height: 720, cameraId: scene.activeCamera });
        node.data = { ...dt, rel: frame.rel, directorId: dt.directorId || null };
      } else if (kind === 'upload') {
        if (!(node.data && node.data.rel)) throw new Error('上传节点还没有选择文件');
      } else {
        const { renderMusic } = await import('../../engine/audio.mjs');
        const au = await renderMusic({ prompt: node.data && node.data.prompt || '', duration: 12 });
        node.data = { ...(node.data || {}), rel: au.rel };
      }
      node.status = 'done';
      c.updatedAt = now();
      save();
      return { ok: true, node };
    }, { tool: 'canvas-node', title: node.type + ' 节点' });
    reply(res, ok(task));
  });


  /* ---------- 画布：任务绑定 / 提交结果版本 / 多人协同 ---------- */
  const filmTasks = (d) => {
    const out = [];
    for (const f of d.filmProjects || []) {
      for (const t of f.tasks || []) {
        out.push({ filmId: f.id, filmTitle: f.title, id: t.id, name: t.name, shot: t.shot || '', status: t.status || 'todo' });
      }
    }
    return out;
  };
  const onlineOf = (c) => {
    const t0 = Date.now();
    c.presence = (c.presence || []).filter((p) => t0 - Date.parse(p.at || 0) < 60000);
    return c.presence;
  };

  r.get('/api/canvas/:id/tasks', (req, res, ctx) => {
    const c = db().canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    reply(res, ok({ bound: c.task || null, list: filmTasks(db()).slice(0, 300), submissions: (c.submissions || []).slice(-20) }));
  });

  r.post('/api/canvas/:id/task', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const c = d.canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    if (!b.taskId) { c.task = null; c.updatedAt = now(); save(); return reply(res, ok({ bound: null })); }
    const hit = filmTasks(d).find((t) => t.id === b.taskId);
    if (!hit) return reply(res, fail('任务不存在'), 404);
    c.task = { filmId: hit.filmId, filmTitle: hit.filmTitle, taskId: hit.id, name: hit.name, shot: hit.shot, boundAt: now() };
    c.updatedAt = now();
    save();
    reply(res, ok({ bound: c.task }));
  });

  r.post('/api/canvas/:id/submit', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const c = d.canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    c.submissions = c.submissions || [];
    const version = 'v' + (c.submissions.length + 1);
    const outs = (c.nodes || [])
      .filter((n) => n.data && n.data.rel)
      .map((n) => ({ nodeId: n.id, type: n.type, rel: n.data.rel, prompt: (n.data && n.data.prompt) || '' }));
    if (!outs.length) return reply(res, fail('画布还没有产出结果，先运行节点再提交'), 400);
    const sub = {
      id: uid('sb_'), version, name: String(b.name || '').slice(0, 40) || ('版本 ' + version),
      at: now(), by: '本地用户', outputs: outs, note: String(b.note || '').slice(0, 200),
      taskId: c.task ? c.task.taskId : null,
    };
    c.submissions.push(sub);
    if (c.task) {
      const f = (d.filmProjects || []).find((x) => x.id === c.task.filmId);
      const t = f && (f.tasks || []).find((x) => x.id === c.task.taskId);
      if (t) {
        t.canvasId = c.id;
        t.result = { canvasId: c.id, version: sub.version, at: sub.at, count: outs.length, rel: outs[0].rel };
        t.submissions = t.submissions || [];
        t.submissions.push({ version: sub.version, at: sub.at, count: outs.length, rel: outs[0].rel, canvasId: c.id });
        if (t.status === 'todo') t.status = 'review';
        f.updatedAt = now();
      }
    }
    c.updatedAt = now();
    save();
    reply(res, ok({ submission: sub, version: sub.version, count: outs.length, task: c.task || null }));
  });

  r.get('/api/canvas/:id/submissions', (req, res, ctx) => {
    const c = db().canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    reply(res, ok({ list: c.submissions || [] }));
  });

  r.post('/api/canvas/:id/collab', (req, res, ctx) => {
    const b = ctx.body || {};
    const c = db().canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    c.collab = c.collab || { enabled: false, collaborators: [] };
    if (b.enabled !== undefined) c.collab.enabled = !!b.enabled;
    if (Array.isArray(b.collaborators)) c.collab.collaborators = b.collaborators.slice(0, 20);
    c.updatedAt = now();
    save();
    reply(res, ok(c.collab));
  });

  r.post('/api/canvas/:id/presence', (req, res, ctx) => {
    const b = ctx.body || {};
    const c = db().canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    c.presence = c.presence || [];
    const user = String(b.user || '本地用户');
    const i = c.presence.findIndex((p) => p.user === user);
    const row = { user, at: now(), follow: b.follow || null, demo: !!b.demo, nodeId: b.nodeId ? String(b.nodeId) : null };
    if (i >= 0) c.presence[i] = row; else c.presence.push(row);
    save();
    reply(res, ok({ online: onlineOf(c), count: onlineOf(c).length, locks: c.locks || {} }));
  });

  r.post('/api/canvas/:id/lock', (req, res, ctx) => {
    const b = ctx.body || {};
    const c = db().canvasProjects.find((x) => x.id === ctx.params.id);
    if (!c) return reply(res, fail('画布不存在'), 404);
    c.locks = c.locks || {};
    const nid = String(b.nodeId || '');
    if (!nid) return reply(res, fail('请先选择节点'), 400);
    if (b.on === false) delete c.locks[nid];
    else if (!c.locks[nid]) c.locks[nid] = { by: String(b.user || '本地用户'), at: now() };
    else if (c.locks[nid].by !== String(b.user || '本地用户')) return reply(res, fail('节点已被 ' + c.locks[nid].by + ' 锁定'), 409);
    save();
    reply(res, ok({ locks: c.locks }));
  });

  /* ---------- 工作流 ---------- */
  r.get('/api/workflows', (req, res) => reply(res, ok({ list: db().workflows })));
  r.post('/api/workflows', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = { id: uid('wf_'), name: String(b.name || '新工作流').slice(0, 50), nodes: b.nodes || [], edges: b.edges || [], runs: [], createdAt: now(), updatedAt: now() };
    d.workflows.unshift(row);
    save();
    reply(res, ok(row));
  });
  r.get('/api/workflows/:id', (req, res, ctx) => {
    const w = db().workflows.find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('工作流不存在'), 404);
    reply(res, ok(w));
  });
  r.post('/api/workflows/:id', (req, res, ctx) => {
    const d = db();
    const w = d.workflows.find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('工作流不存在'), 404);
    Object.assign(w, ctx.body || {}, { id: w.id, updatedAt: now() });
    save();
    reply(res, ok(w));
  });
  r.post('/api/workflows/:id/delete', (req, res, ctx) => {
    const d = db();
    d.workflows = d.workflows.filter((x) => x.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });
  /* 工作流执行：按边序求值，text → image → video / audio 逐节点真跑 */
  r.post('/api/workflows/:id/run', async (req, res, ctx) => {
    const d = db();
    const w = d.workflows.find((x) => x.id === ctx.params.id);
    if (!w) return reply(res, fail('工作流不存在'), 404);
    const task = enqueue('workflow-run', { id: w.id }, async ({ progress }) => {
      const { renderImage } = await import('../../engine/image.mjs');
      const { renderShot } = await import('../../engine/video.mjs');
      const { renderMusic } = await import('../../engine/audio.mjs');
      const run = { id: uid('run_'), at: now(), status: 'running', nodes: [] };
      const nodes = (w.nodes || []).slice();
      const edges = w.edges || [];
      const done = new Map();
      const outputs = new Map();

      /* 拓扑序：入边全部完成的节点先跑；环上剩余节点按原顺序兜底 */
      const order = [];
      const pending = new Set(nodes.map((n) => n.id));
      let guard = 0;
      while (pending.size && guard++ < 200) {
        let moved = false;
        for (const n of nodes) {
          if (!pending.has(n.id)) continue;
          const deps = edges.filter((e) => (e.to || e.target) === n.id).map((e) => e.from || e.source);
          if (deps.every((id) => done.has(id) || !pending.has(id))) { order.push(n); pending.delete(n.id); done.set(n.id, true); moved = true; }
        }
        if (!moved) { for (const n of nodes) if (pending.has(n.id)) { order.push(n); pending.delete(n.id); } }
      }

      for (let i = 0; i < order.length; i++) {
        const n = order[i];
        progress(8 + Math.round((i / Math.max(1, order.length)) * 84), '节点 ' + (i + 1) + '/' + order.length + ' · ' + n.type);
        const ups = edges.filter((e) => (e.to || e.target) === n.id).map((e) => outputs.get(e.from || e.source)).filter(Boolean);
        const prompt = (n.data && (n.data.prompt || n.data.text)) || n.prompt || '工作流节点';
        try {
          if (n.type === 'text') {
            outputs.set(n.id, { rel: null, text: String(prompt) });
          } else if (n.type === 'image') {
            const img = await renderImage({ prompt, width: 1024, height: 576, seedText: n.id, style: (n.data && n.data.style) || undefined });
            outputs.set(n.id, { rel: img.rel, file: img.file });
          } else if (n.type === 'video') {
            const plate = ups.find((u) => u.rel);
            const src = plate && plate.rel ? plate.file : (await renderImage({ prompt, width: 1024, height: 576, seedText: n.id })).file;
            const shot = await renderShot({ imageFile: src, duration: 3, motion: (n.data && n.data.motion) || 'zoom-in' });
            outputs.set(n.id, { rel: shot.rel, file: shot.file });
          } else if (n.type === 'audio') {
            const au = await renderMusic({ prompt, duration: 12 });
            outputs.set(n.id, { rel: au.rel, file: au.file });
          } else if (n.type === 'script') {
            const dt = n.data || {};
            const img = await renderImage({
              prompt: [dt.scene, dt.size, dt.dialog].filter(Boolean).join(' · ') || prompt,
              width: 1024, height: 576, seedText: n.id,
              title: dt.scene || '分镜', subtitle: dt.dialog || '', tag: dt.size || '中景'
            });
            outputs.set(n.id, { rel: img.rel, file: img.file });
          } else if (n.type === 'clip') {
            const { concatShots } = await import('../../engine/video.mjs');
            const files = ups.map((u) => u && u.file).filter((x) => x && fs.existsSync(x));
            if (!files.length) throw new Error('合成节点上游没有可用的视频或图片');
            const merged = await concatShots(files, { transition: (n.data && n.data.transition) || 'dissolve' });
            outputs.set(n.id, { rel: merged.rel, file: merged.file });
          } else if (n.type === 'asset' || n.type === 'upload') {
            const rel = (n.data && n.data.rel) || (ups.find((u) => u && u.rel) || {}).rel || null;
            if (!rel) throw new Error((n.type === 'upload' ? '上传' : '资产') + '节点还没有选择素材');
            outputs.set(n.id, { rel, file: rel ? relFile(rel) : null });
          } else if (n.type === 'table') {
            const { renderTableImage } = await import('../../engine/nodes.mjs');
            const dt = n.data || {};
            const img = await renderTableImage({ title: dt.title || '', text: dt.text || '', rows: dt.rows, header: dt.header !== false });
            outputs.set(n.id, { rel: img.rel, file: img.file });
          } else if (n.type === 'threeDWorld') {
            const { threeDWorld } = await import('../../engine/nodes.mjs');
            const dt = n.data || {};
            const upRel = (ups.find((u) => u && u.rel) || {}).rel || dt.rel || null;
            const src = upRel ? relFile(upRel) : null;
            const pano = await threeDWorld(src && fs.existsSync(src) ? src : null, { prompt: dt.prompt || prompt, turns: dt.turns || 2, elevation: dt.elevation || 0, seed: n.id });
            outputs.set(n.id, { rel: pano.rel, file: pano.file });
          } else if (n.type === 'director') {
            const { renderStage } = await import('../../engine/stage.mjs');
            const dt = n.data || {};
            const proj = dt.directorId ? (db().director || []).find((x) => x.id === dt.directorId) : null;
            const scene = proj || {
              title: dt.title || '工作流导演台',
              stage: dt.stage || { width: 20, depth: 20, ground: '#1a1a1f' },
              actors: dt.actors || [{ x: -1.6, z: 0, height: 1.8, color: 'blue', pose: 'idle', facing: 0 }],
              cameras: dt.cameras || [{ id: 'cam1', name: '主摄', fov: 42, pos: { x: 0, y: 2.2, z: 8 }, yaw: 0, pitch: -4 }],
              activeCamera: dt.activeCamera || 'cam1',
            };
            const frame = await renderStage(scene, { width: 1280, height: 720, cameraId: scene.activeCamera });
            outputs.set(n.id, { rel: frame.rel, file: frame.file });
          } else {
            outputs.set(n.id, { rel: null });
          }
          const out = outputs.get(n.id) || {};
          if (out.rel) { n.data = { ...(n.data || {}), rel: out.rel }; n.status = 'done'; }
          run.nodes.push({ id: n.id, type: n.type, ok: true, out });
        } catch (e) {
          run.nodes.push({ id: n.id, type: n.type, ok: false, error: String(e.message || e).slice(0, 200) });
        }
      }
      run.status = 'done';
      run.duration = Date.now() - new Date(run.at).getTime();
      w.runs = [run, ...(w.runs || [])].slice(0, 20);
      save();
      return { ok: true, run };
    }, { tool: 'workflow-run', title: w.name });
    reply(res, ok(task));
  });

  /* ---------- 3D 导演台 ---------- */
  r.get('/api/director', (req, res) => reply(res, ok({ list: db().director })));
  r.post('/api/director', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = {
      id: uid('dr_'), title: String(b.title || '未命名机位').slice(0, 40),
      stage: b.stage || { width: 20, depth: 20, ground: '#1a1a1f' },
      actors: b.actors || [],
      cameras: b.cameras || [{ id: 'cam1', name: '主摄', fov: 42, pos: { x: 0, y: 2.2, z: 8 }, target: { x: 0, y: 1, z: 0 } }],
      activeCamera: 'cam1', frameRel: null, createdAt: now(), updatedAt: now()
    };
    d.director.unshift(row);
    save();
    reply(res, ok(row));
  });
  r.get('/api/director/:id', (req, res, ctx) => {
    const x = db().director.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('项目不存在'), 404);
    reply(res, ok(x));
  });
  r.post('/api/director/:id', (req, res, ctx) => {
    const d = db();
    const x = d.director.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('项目不存在'), 404);
    Object.assign(x, ctx.body || {}, { id: x.id, updatedAt: now() });
    save();
    reply(res, ok(x));
  });
  r.post('/api/director/:id/delete', (req, res, ctx) => {
    const d = db();
    d.director = d.director.filter((y) => y.id !== ctx.params.id);
    save();
    reply(res, ok({ ok: true }));
  });

  /* 导演台拍摄：把当前机位渲染成一帧（用本地光栅 + 深度排序投影） */
  r.post('/api/director/:id/shoot', async (req, res, ctx) => {
    const d = db();
    const x = d.director.find((y) => y.id === ctx.params.id);
    if (!x) return reply(res, fail('项目不存在'), 404);
    const task = enqueue('director-shoot', { id: x.id }, async ({ progress }) => {
      const { renderStage } = await import('../../engine/stage.mjs');
      progress(40, '渲染机位');
      const out = await renderStage(x, { width: 1280, height: 720, cameraId: x.activeCamera });
      x.frameRel = out.rel;
      save();
      return { ok: true, rel: out.rel, file: out.file };
    }, { tool: 'director-shoot', title: x.title });
    reply(res, ok(task));
  });

  /* ---------- 影视项目（见 routes/film.mjs） / 广告短剧 ---------- */
  r.get('/api/ad-drama', (req, res) => reply(res, ok({ list: db().adDrama })));
  r.post('/api/ad-drama', (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const row = { id: uid('ad_'), title: String(b.title || '未命名广告短剧').slice(0, 50), product: b.product || '', audience: b.audience || '', duration: Number(b.duration) || 30, status: 'draft', shots: [], createdAt: now() };
    d.adDrama.unshift(row);
    save();
    reply(res, ok(row));
  });

  /* ---------- 视频翻译 ---------- */
  r.get('/api/translate', (req, res) => reply(res, ok({ list: db().translations })));
  r.post('/api/translate', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    if (!b.assetId) return reply(res, fail('请选择视频'));
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('视频不存在'), 404);
    const row = {
      id: uid('tr_'), assetId: a.id, title: a.name, targetLang: b.targetLang || 'zh-CN',
      lines: b.lines || [], status: 'pending', videoRel: null, createdAt: now()
    };
    d.translations.unshift(row);
    save();
    const task = enqueue('translate', { id: row.id }, async ({ progress }) => {
      const { translateVideo } = await import('../../engine/effects.mjs');
      const llm = await import('../../engine/llm.mjs');
      progress(30, '转写台本');
      let lines = row.lines;
      if (!lines.length) {
        if (llm.llmEnabled()) {
          const out = await llm.chatJSON([{ role: 'system', content: '把视频台词整理成 JSON 数组 [{"role":"","text":"","start":0,"end":2}]，只输出 JSON' }, { role: 'user', content: String(b.hint || '一段人物对话') }]);
          if (Array.isArray(out)) lines = out;
        }
        if (!lines.length) lines = [{ role: '旁白', text: String(b.hint || '这是一段示例台词。') }];
      }
      progress(60, '生成配音');
      const out = await translateVideo({ file: a.file, lines, voice: b.voice });
      row.lines = lines;
      row.videoRel = out.rel;
      row.status = 'done';
      save();
      return { ok: true, rel: out.rel, lines };
    }, { tool: 'translate', title: a.name });
    reply(res, ok({ ...row, task }));
  });

  /* ---------- 视频重绘（redraw）---------- */
  r.get('/api/redraw', (req, res) => reply(res, ok({ list: db().redraws })));
  r.post('/api/redraw', async (req, res, ctx) => {
    const b = ctx.body || {};
    const d = db();
    const a = d.assets.find((x) => x.id === b.assetId);
    if (!a) return reply(res, fail('请选择素材'), 404);
    const row = { id: uid('rw_'), assetId: a.id, title: a.name, style: b.style || 'anime', segments: [], status: 'pending', rel: null, createdAt: now() };
    d.redraws.unshift(row);
    save();
    const task = enqueue('redraw', { id: row.id }, async ({ progress }) => {
      const { imageToImage } = await import('../../engine/effects.mjs');
      progress(50, '逐帧重绘');
      const out = await imageToImage(a.file, { style: row.style });
      row.rel = out.rel;
      row.status = 'done';
      save();
      return { ok: true, rel: out.rel };
    }, { tool: 'redraw', title: a.name });
    reply(res, ok({ ...row, task }));
  });
}
