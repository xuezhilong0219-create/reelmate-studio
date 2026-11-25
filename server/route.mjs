/* 极简路由表：pattern 支持 :param 与通配 */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const src = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
        if (seg === '*') { keys.push('rest'); return '(.*)'; }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    routes.push({ method, re: new RegExp('^' + src + '$'), keys, handler, pattern });
  };
  const get = (p, h) => add('GET', p, h);
  const post = (p, h) => add('POST', p, h);
  const put = (p, h) => add('PUT', p, h);
  const del = (p, h) => add('DELETE', p, h);
  const match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] || ''); });
      return { handler: r.handler, params };
    }
    return null;
  };
  const list = () => routes.map((r) => r.method + ' ' + r.pattern);
  return { get, post, put, del, add, match, list, routes };
}

export const ok = (data, extra) => ({ code: 0, msg: 'ok', data: data === undefined ? null : data, ...(extra || {}) });
export const fail = (msg, code = 1) => ({ code, msg: String(msg || 'error'), data: null });

/** 统一响应：带 code/msg/data，与 reelmate 后端一致 */
export function reply(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

