import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';
import { db, ROOT, DATA, MEDIA, saveNow } from './db.mjs';
import { createRouter, reply, ok, fail } from './route.mjs';
import { streamFile, sendJSON, mimeOf, parseMultipart, readBody, readJSON } from './util.mjs';
import { hasFFmpeg } from '../engine/ffmpeg.mjs';
import { registerToolbox } from './routes/tools.mjs';
import { registerAssets } from './routes/assets.mjs';
import { registerContent } from './routes/content.mjs';
import { registerTeam } from './routes/team.mjs';
import { registerCanvas } from './routes/canvas.mjs';
import { registerExtra } from './routes/extra.mjs';
import { registerPost } from './routes/post.mjs';
import { registerEditor } from './routes/editor.mjs';
import { registerVPost } from './routes/vpost.mjs';
import { registerSheet } from './routes/sheet.mjs';
import { registerIngest } from './routes/ingest.mjs';
import { registerWorks } from './routes/works.mjs';
import { registerFilm } from './routes/film.mjs';
import { registerTaskBoard } from './routes/taskboard.mjs';

const PORT = Number(process.env.PORT) || 8848;
const HOST = process.env.HOST || '127.0.0.1';
const WEB = path.join(ROOT, 'web');

const r = createRouter();

/* 健康检查 */
r.get('/api/health', async (req, res) => {
  const d = db();
  const ff = await hasFFmpeg();
  reply(res, ok({
    ok: true,
    version: d.meta.version,
    name: d.settings.siteName,
    ffmpeg: ff,
    llm: !!(d.settings.llm && d.settings.llm.baseUrl),
    assets: d.assets.length,
    tasks: d.tasks.length,
    unlimited: true
  }));
});

/* 仪表盘汇总 */
r.get('/api/dashboard', (req, res) => {
  const d = db();
  const by = { image: 0, video: 0, audio: 0 };
  for (const a of d.assets) by[a.kind] = (by[a.kind] || 0) + 1;
  reply(res, ok({
    projects: d.projects.length,
    episodes: d.episodes.length,
    storyboards: d.storyboards.length,
    assets: d.assets.length,
    byKind: by,
    tasks: { total: d.tasks.length, running: d.tasks.filter((t) => t.status === 'running').length, done: d.tasks.filter((t) => t.status === 'done').length },
    recentProjects: d.projects.slice(0, 6),
    recentAssets: d.assets.slice(0, 12),
    recentTasks: d.tasks.slice(0, 8)
  }));
});

registerToolbox(r);
registerAssets(r);
registerContent(r);
registerTeam(r);
registerCanvas(r);
registerExtra(r);
registerPost(r);
registerEditor(r);
registerVPost(r);
registerSheet(r);
registerIngest(r);
registerWorks(r);
registerFilm(r);
  registerTaskBoard(r);

/* 路由清单（调试） */
r.get('/api/_routes', (req, res) => reply(res, ok(r.list())));

/* ================= HTTP 服务 ================= */

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file = path.join(WEB, rel);
  if (!file.startsWith(WEB)) return sendJSON(res, 403, { code: 403, msg: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    /* SPA fallback */
    file = path.join(WEB, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('web/index.html 缺失');
    }
  }
  streamFile(req, res, file);
}

function serveMedia(req, res, pathname) {
  const rel = pathname.replace(/^\/media\//, '');
  const file = path.join(MEDIA, decodeURIComponent(rel));
  if (!file.startsWith(MEDIA)) return sendJSON(res, 403, { code: 403, msg: 'forbidden' });
  streamFile(req, res, file);
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url || '/', true);
  const pathname = decodeURIComponent(u.pathname || '/');
  const ctxBase = { query: u.query || {}, params: {}, body: null };

  try {
    if (pathname.startsWith('/media/')) return serveMedia(req, res, pathname);

    const hit = r.match(req.method || 'GET', pathname);
    if (hit) {
      ctxBase.params = hit.params;
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const ct = String(req.headers['content-type'] || '');
        if (ct.includes('multipart/form-data')) {
          const buf = await readBody(req);
          const parsed = parseMultipart(buf, ct);
          ctxBase.files = parsed.files;
          ctxBase.fields = parsed.fields;
          ctxBase.body = {};
        } else {
          ctxBase.body = await readJSON(req);
        }
      }
      await hit.handler(req, res, ctxBase);
      return;
    }

    if (pathname.startsWith('/api/')) return sendJSON(res, 404, fail('接口不存在: ' + pathname, 404));

    return serveStatic(req, res, pathname);
  } catch (e) {
    const msg = String((e && e.stack) || e);
    console.error('[ERR]', pathname, msg);
    if (!res.headersSent) sendJSON(res, 500, fail(msg.slice(0, 400), 500));
    else try { res.end(); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  const d = db();
  console.log('');
  console.log('  ' + d.settings.siteName + '  ·  ' + d.settings.siteSub);
  console.log('  ────────────────────────────────────────');
  console.log('  本地地址   http://' + HOST + ':' + PORT + '/');
  console.log('  工具箱     http://' + HOST + ':' + PORT + '/#/tools');
  console.log('  资产库     http://' + HOST + ':' + PORT + '/#/assets');
  console.log('  数据文件   ' + path.join(DATA, 'db.json'));
  console.log('  媒体目录   ' + MEDIA);
  console.log('  付费/额度  无限制（本地版）');
  console.log('');
});

process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

