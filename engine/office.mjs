import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ============ 零依赖 Office 读取：docx / xlsx / csv / txt / md ============ */

/** 读取 ZIP 里的所有条目（只支持 store / deflate） */
export function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP / Office 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) { try { data = zlib.inflateRawSync(raw); } catch { data = Buffer.alloc(0); } }
    else data = Buffer.alloc(0);
    out.set(name, { data, size: usize });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unent = (s) => String(s || '').replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m] || m);

/** docx → 纯文本（段落换行，表格行用 | 分隔） */
export function readDocx(file) {
  const z = readZip(file);
  const doc = z.get('word/document.xml');
  if (!doc) throw new Error('docx 里没有 word/document.xml');
  const xml = doc.data.toString('utf8');
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => unent(l).replace(/\t+$/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attr(attrs, name) {
  const m = String(attrs || '').match(new RegExp(name + '\\s*=\\s*"([^"]*)"|' + name + '\\s*=\\s*([^"\\s>]+)'));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

function colIndex(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/i);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/** xlsx → 二维数组（第一张工作表） */
export function readXlsx(file) {
  const z = readZip(file);
  const shared = [];
  const ss = z.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = ss.data.toString('utf8');
    const items = xml.split('<si>').slice(1);
    for (const it of items) {
      let t = '';
      const chunks = it.split('<r>').slice(1);
      if (chunks.length) {
        for (const c of chunks) { const m = c.match(/<t[^>]*>([\s\S]*?)<\/t>/); if (m) t += m[1]; }
      } else {
        const m = it.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (m) t = m[1];
      }
      shared.push(unent(t));
    }
  }
  const wb = z.get('xl/workbook.xml');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (wb) {
    const xml = wb.data.toString('utf8');
    const m = xml.match(/r:id\s*=\s*"rId(\d+)"|r:id\s*=\s*rId(\d+)/);
    if (m) {
      const rid = 'rId' + (m[1] || m[2]);
      const rels = z.get('xl/_rels/workbook.xml.rels');
      if (rels) {
        const rx = rels.data.toString('utf8');
        const rel = rx.match(new RegExp('Id\\s*=\\s*"?' + rid + '"?[^>]*Target\\s*=\\s*"([^"]+)"'))
          || rx.match(new RegExp('Target\\s*=\\s*"([^"]+)"[^>]*Id\\s*=\\s*"?' + rid + '"?'));
        if (rel) sheetPath = rel[1].replace(/^\/?xl\//, 'xl/').replace(/^\.\.\//, '');
      }
    }
  }
  const sh = z.get(sheetPath) || z.get([...z.keys()].find((k) => /^xl\/worksheets\/.*\.xml$/.test(k)) || '');
  if (!sh) throw new Error('xlsx 里没有工作表');
  const xml = sh.data.toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cm[1] || cm[3] || '';
      const inner = cm[2] || '';
      const ref = attr(attrs, 'r');
      const idx = ref ? colIndex(ref) : cells.length;
      const type = attr(attrs, 't');
      let val = '';
      if (type === 'inlineStr') {
        const m = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = m ? unent(m[1]) : '';
      } else if (type === 's') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? (shared[Number(v[1])] || '') : '';
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? unent(v[1]) : '';
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => String(c || '').trim()));
}

export function readCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x || '').trim()));
}

/** 统一入口：按扩展名读成 { text } 或 { rows } */
export function readDocument(file, filename) {
  const ext = path.extname(filename || file).toLowerCase();
  if (ext === '.docx') return { kind: 'text', text: readDocx(file) };
  if (ext === '.xlsx') return { kind: 'rows', rows: readXlsx(file) };
  if (ext === '.csv' || ext === '.tsv') return { kind: 'rows', rows: readCsv(fs.readFileSync(file, 'utf8')) };
  if (ext === '.txt' || ext === '.md') return { kind: 'text', text: fs.readFileSync(file, 'utf8') };
  if (ext === '.doc') {
    const raw = fs.readFileSync(file);
    const txt = raw.toString('utf16le').replace(/[^\u4e00-\u9fa5\u3000-\u303fA-Za-z0-9，。！？、；：“”‘’（）《》\s]/g, ' ');
    return { kind: 'text', text: txt.replace(/ {3,}/g, '\n').trim(), legacy: true };
  }
  const txt = fs.readFileSync(file, 'utf8');
  return { kind: 'text', text: txt };
}
