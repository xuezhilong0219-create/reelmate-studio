
export const state = { settings: null, health: null, tasks: [], models: null, cache: {} };

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) o.body = opts.body;
    else { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  }
  const res = await fetch(path, o);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('响应不是 JSON：' + text.slice(0, 120)); }
  if (json && json.code !== 0) throw new Error(json.msg || '请求失败');
  return json.data;
}

export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  box.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = '.3s'; setTimeout(() => d.remove(), 320); }, 2600);
}

export function openModal(html, opts = {}) {
  const mask = document.getElementById('modal-mask');
  const modal = document.getElementById('modal');
  modal.className = 'modal' + (opts.wide ? ' wide' : '');
  modal.innerHTML = html;
  mask.classList.add('on');
  if (opts.onMount) opts.onMount(modal);
  return modal;
}
export function closeModal() {
  document.getElementById('modal-mask').classList.remove('on');
  document.getElementById('modal').innerHTML = '';
}
export function openDrawer(title, html) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML = html;
  document.getElementById('drawer').classList.add('on');
  document.getElementById('drawer-mask').classList.add('on');
}
export function closeDrawer() {
  document.getElementById('drawer').classList.remove('on');
  document.getElementById('drawer-mask').classList.remove('on');
}

export function fmtDur(s) {
  if (s == null) return '—';
  s = Math.max(0, Math.round(s * 10) / 10);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's';
}
export function fmtBytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (Math.round(v * 10) / 10) + u[i];
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, '0');
  return d.getMonth() + 1 + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
export function kindLabel(k) {
  return ({ image: '图片', video: '视频', audio: '音频', text: '文本' })[k] || k || '素材';
}

export function mediaUrl(rel) { return rel || ''; }

export function assetPreview(a, opts = {}) {
  if (!a) return '<div class="asset-thumb">✕</div>';
  const rel = a.thumbRel || a.rel;
  const inner = a.kind === 'video'
    ? (a.thumbRel
      ? '<img src="' + esc(a.thumbRel) + '" alt="" loading="lazy" /><span class="play-badge">▶</span>'
      : '<video src="' + esc(a.rel || '') + '" muted preload="metadata" playsinline onmouseover="this.play()" onmouseout="this.pause()"></video>')
    : a.kind === 'audio'
      ? '<div style="font-size:26px">♪</div>'
      : '<img src="' + esc(rel || '') + '" alt="" loading="lazy" />';
  return '<div class="asset-thumb">' + inner + '</div>';
}

/** 轮询任务直到完成 */
export function pollTask(id, onTick, interval = 900) {
  let stop = false;
  const tick = async () => {
    if (stop) return;
    try {
      const t = await api('/api/tasks/' + id);
      onTick(t);
      if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') return;
    } catch (e) { /* 忽略瞬时错误 */ }
    setTimeout(tick, interval);
  };
  tick();
  return () => { stop = true; };
}

export function statusLabel(s) {
  return ({ queued: '排队', running: '生成中', done: '完成', failed: '失败', cancelled: '已取消' })[s] || s;
}

export function taskBadge(n) {
  const b = document.getElementById('task-badge');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.classList.remove('hidden'); } else b.classList.add('hidden');
}

export async function refreshBadge() {
  try {
    const d = await api('/api/tasks?limit=50');
    const active = (d.list || []).filter((t) => t.status === 'running' || t.status === 'queued').length;
    taskBadge(active);
  } catch {}
}

export function bind(el, sel, ev, fn) {
  el.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, fn));
}

export function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((n) => {
    const k = n.getAttribute('name');
    if (n.type === 'checkbox') out[k] = n.checked;
    else if (n.type === 'number') out[k] = n.value === '' ? undefined : Number(n.value);
    else out[k] = n.value;
  });
  return out;
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/api/assets/upload', { method: 'POST', body: fd });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => resolve(inp.files && inp.files[0]);
    inp.click();
  });
}

export async function ensureSettings() {
  if (!state.settings) state.settings = await api('/api/settings');
  return state.settings;
}
export async function saveSettings(patch) {
  state.settings = await api('/api/settings', { method: 'POST', body: patch });
  return state.settings;
}
