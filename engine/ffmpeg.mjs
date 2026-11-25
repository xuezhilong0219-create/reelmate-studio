import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';

export function runFF(args, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { err += d.toString(); if (err.length > 60000) err = err.slice(-30000); });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, opts.timeout || 180000);
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, log: String(e && e.message) }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, log: err }); });
  });
}

export function probe(file) {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      try { const j = JSON.parse(out); resolve(j); } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}

/** 从媒体文件里抽首帧作为缩略图 */
export async function thumbnail(src, dest, at = 0.3) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await runFF(['-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', dest]);
  return r.ok;
}

export const hasFFmpeg = async () => {
  const r = await runFF(['-version']);
  return r.ok;
};
