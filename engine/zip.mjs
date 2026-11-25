import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* 极简 ZIP 打包器：只用 node 内置模块，deflate 压缩 + CRC32 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { date, time };
}

/**
 * 把一组 { name, file } 或 { name, data } 打成 ZIP，写到 destFile。
 * name 允许带子目录（用 / 分隔）。
 * 返回 { file, bytes, count }。
 */
export function zipTo(destFile, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime(new Date());

  for (const e of entries) {
    if (!e) continue;
    let data;
    let name = String(e.name || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
    if (/[^\x00-\x7f]/.test(name)) {
      /* 中文名走 UTF-8 标志位，不转换编码 */
    }
    if (e.data) data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    else if (e.file && fs.existsSync(e.file)) data = fs.readFileSync(e.file);
    else continue;

    const crc = crc32(data);
    let body = data;
    let method = 0;
    if (!e.store) {
      try {
        const packed = zlib.deflateRawSync(data, { level: 6 });
        if (packed.length < data.length * 0.94) { body = packed; method = 8; }
      } catch (err) { /* 保留原始数据 */ }
    }

    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);          /* UTF-8 名称 */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(stamp.time, 12);
    cd.writeUInt16LE(stamp.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const buf = Buffer.concat([...chunks, cdBuf, end]);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
  return { file: destFile, bytes: buf.length, count: central.length / 2 };
}

export function safeEntryName(s, fallback = 'file') {
  const t = String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return t || fallback;
}
