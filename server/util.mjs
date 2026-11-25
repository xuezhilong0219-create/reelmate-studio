import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

export const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

export function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
}

export function sendText(res, code, text, type) {
  const body = Buffer.from(String(text), 'utf8');
  res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

export function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJSON(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  const txt = buf.toString('utf8');
  try { return JSON.parse(txt); } catch { return {}; }
}

export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, files: [] };
  const boundary = '--' + (m[1] || m[2]).trim();
  const parts = [];
  let idx = buf.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    parts.push(buf.slice(start + 2, next - 2));
    idx = next;
  }
  const fields = {};
  const files = [];
  for (const part of parts) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    const head = part.slice(0, sep).toString('utf8');
    const body = part.slice(sep + 4);
    const nameM = /name="([^"]*)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    if (fileM) {
      files.push({ field: nameM ? nameM[1] : 'file', filename: fileM[1], data: body });
    } else if (nameM) {
      fields[nameM[1]] = body.toString('utf8');
    }
  }
  return { fields, files };
}

export function streamFile(req, res, filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return sendJSON(res, 404, { code: 404, msg: 'not found' }); }
  if (!stat.isFile()) return sendJSON(res, 404, { code: 404, msg: 'not found' });
  const type = mimeOf(filePath);
  const range = req.headers.range;
  if (range) {
    const rm = /bytes=(\d*)-(\d*)/.exec(range);
    let start = rm && rm[1] ? parseInt(rm[1], 10) : 0;
    let end = rm && rm[2] ? parseInt(rm[2], 10) : stat.size - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) { res.writeHead(416); return res.end(); }
    res.writeHead(206, {
      'content-type': type,
      'content-range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1
    });
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }
  const codeLike = /\.(js|mjs|css|html|json)$/i.test(filePath);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'accept-ranges': 'bytes',
    'cache-control': codeLike ? 'no-store, must-revalidate' : 'public, max-age=86400',
    'last-modified': stat.mtime.toUTCString(),
  });
  fs.createReadStream(filePath).pipe(res);
}

export const safeName = (s) => String(s || 'file').replace(/[^\w\u4e00-\u9fa5.\-]+/g, '_').slice(0, 80);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const pick = (obj, keys) => { const o = {}; for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k]; return o; };
export const hashSeed = (s) => { const h = crypto.createHash('sha1').update(String(s)).digest('hex'); return parseInt(h.slice(0, 8), 16); };
