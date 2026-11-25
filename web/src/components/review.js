import { esc, toast } from '../lib.js';

/* 结果审核抽屉（官方 film.json tasks.review.*）
   play/pause · mute/unmute · fullscreen · zoomHint 点击查看原图
   历史批注 / 新增批注 / 发送 / 展开收起 / 查看更多
   进入画布 / 提交审核 / 通过 / 驳回 */

const fmt = (t) => {
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

export function openReview(cfg) {
  const state = {
    files: (cfg.files || []).slice(),
    comments: (cfg.comments || []).slice(),
    cur: 0,
    expanded: false,
    showAll: false,
    review: cfg.reviewStatus || ''
  };

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(6,10,16,.72);display:grid;place-items:center;padding:18px';
  wrap.setAttribute('data-review-drawer', '1');
  const box = document.createElement('div');
  box.style.cssText = 'width:min(1160px,96vw);max-height:92vh;display:flex;flex-direction:column;background:#0d141d;border:1px solid #253143;border-radius:14px;color:#e8edf7;overflow:hidden';
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const close = () => wrap.remove();

  const stName = () => (state.review === 'pending' ? '待审核' : state.review === 'pass' ? '已通过' : state.review === 'fail' ? '已驳回' : '未提交');
  const stColor = () => (state.review === 'pending' ? '#7dd3fc' : state.review === 'pass' ? 'var(--ok,#34d399)' : state.review === 'fail' ? 'var(--err,#f87171)' : 'var(--dim)');

  const file = () => state.files[state.cur] || null;

  function header() {
    return '<div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #1a2330">' +
      '<div style="min-width:0"><div style="font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(cfg.title || '未命名任务') + '</div>' +
      '<div style="font-size:11.5px;color:var(--dim);margin-top:2px">' + esc(cfg.subtitle || '') + '</div></div>' +
      '<span class="chip" style="font-size:10.5px;color:' + stColor() + '">' + stName() + '</span>' +
      '<span class="chip" style="font-size:10.5px">版本 ' + (cfg.version ? 'v' + cfg.version : '—') + '</span>' +
      '<span style="flex:1"></span><button class="icon-btn" data-rv-close>✕</button></div>';
  }

  function media() {
    const f = file();
    if (!f) {
      return '<div style="flex:1;display:grid;place-items:center;color:var(--dim);font-size:12.5px;border:1px dashed #253143;border-radius:10px;min-height:260px">当前任务暂未提交结果素材</div>';
    }
    if (f.kind === 'video') {
      return '<div id="rv-stage" style="flex:1;background:#070b11;border-radius:10px;overflow:hidden;display:grid;place-items:center;min-height:260px">' +
        '<video id="rv-v" src="' + esc(f.rel) + '" muted loop autoplay playsinline style="max-width:100%;max-height:52vh"></video></div>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:8px">' +
        '<button class="ghost tiny" data-rv="play">暂停</button>' +
        '<button class="ghost tiny" data-rv="mute">取消静音</button>' +
        '<button class="ghost tiny" data-rv="full">全屏</button>' +
        '<span style="flex:1"></span><span style="font-size:11px;color:var(--dim)">' + esc(f.name || '') + '</span></div>';
    }
    if (f.kind === 'audio') {
      return '<div style="flex:1;display:grid;place-items:center;min-height:220px"><audio id="rv-v" src="' + esc(f.rel) + '" controls style="width:80%"></audio></div>' +
        '<div style="display:flex;gap:6px;margin-top:8px"><button class="ghost tiny" data-rv="mute">取消静音</button><span style="flex:1"></span><span style="font-size:11px;color:var(--dim)">' + esc(f.name || '') + '</span></div>';
    }
    return '<div id="rv-stage" style="flex:1;background:#070b11;border-radius:10px;overflow:hidden;display:grid;place-items:center;min-height:260px">' +
      '<img id="rv-i" src="' + esc(f.rel) + '" style="max-width:100%;max-height:54vh;object-fit:contain;cursor:zoom-in" /></div>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-top:8px">' +
      '<button class="ghost tiny" data-rv="full">全屏</button>' +
      '<span style="font-size:11px;color:var(--dim)">点击查看原图</span><span style="flex:1"></span>' +
      '<span style="font-size:11px;color:var(--dim)">' + esc(f.name || '') + '</span></div>';
  }

  function strip() {
    if (!state.files.length) return '';
    return '<div style="display:flex;gap:6px;overflow-x:auto;padding:8px 0 2px">' + state.files.map((f, i) =>
      '<div data-rvf="' + i + '" style="flex:0 0 auto;width:76px;height:52px;border-radius:8px;overflow:hidden;border:1px solid ' + (i === state.cur ? 'var(--brand)' : '#253143') + ';background:#070b11;cursor:pointer;display:grid;place-items:center">' +
      (f.kind === 'image' ? '<img src="' + esc(f.rel) + '" style="width:100%;height:100%;object-fit:cover" />' : '<span style="font-size:10px;color:var(--dim)">' + esc((f.kind || 'file').toUpperCase()) + '</span>') + '</div>').join('') + '</div>';
  }

  function comments() {
    const list = state.showAll ? state.comments : state.comments.slice(0, 4);
    const items = list.length
      ? list.map((c) => '<div style="padding:7px 0;border-bottom:1px solid #161e29"><div style="font-size:11px;color:var(--dim)">' + esc(c.by || '本地用户') + ' · ' + esc(fmt(c.at)) + '</div>' +
        '<div style="font-size:12.5px;margin-top:3px;white-space:pre-wrap">' + esc(c.text) + '</div></div>').join('')
      : '<div style="font-size:12px;color:var(--dim);padding:10px 0">暂无批注</div>';
    const more = !state.showAll && state.comments.length > 4 ? '<button class="ghost tiny" data-rv="more" style="margin-top:6px">查看更多</button>' : '';
    return '<div style="width:330px;display:flex;flex-direction:column;border-left:1px solid #1a2330;padding-left:14px">' +
      '<div style="display:flex;align-items:center;gap:8px"><div class="section-title" style="margin:0">历史批注</div><span class="chip" style="font-size:10px">' + state.comments.length + '</span>' +
      '<span style="flex:1"></span><button class="ghost tiny" data-rv="expand">' + (state.expanded ? '收起' : '展开') + '</button></div>' +
      '<div id="rv-clist" style="flex:1;overflow:auto;max-height:' + (state.expanded ? '46vh' : '180px') + ';margin-top:6px">' + items + more + '</div>' +
      '<div style="margin-top:10px"><textarea id="rv-text" placeholder="请输入批注内容" rows="2" style="width:100%;font-size:12.5px;background:#0b111a;border:1px solid #253143;color:#e8edf7;border-radius:8px;padding:7px 9px;resize:vertical"></textarea>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="primary" data-rv="send">发送</button></div></div></div>';
  }

  function footer() {
    const hasCanvas = !!cfg.canvasId || (cfg.canvases || []).length > 0;
    return '<div style="display:flex;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid #1a2330">' +
      '<button class="ghost" data-rv="canvas">进入画布</button>' +
      (cfg.canUpload ? '<button class="ghost" data-rv="upload">上传结果素材</button>' : '') +
      '<span style="flex:1;font-size:11.5px;color:var(--dim)">' + (hasCanvas ? '' : '当前任务尚未绑定画布') + '</span>' +
      '<button class="ghost" data-rv="submit">提交审核</button>' +
      '<button class="ghost" data-rv="fail">驳回</button>' +
      '<button class="primary" data-rv="pass">通过</button></div>';
  }

  function paint() {
    box.innerHTML = header() +
      '<div style="display:flex;gap:14px;padding:14px 16px;overflow:hidden;flex:1;min-height:0">' +
      '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' + media() + strip() + '</div>' + comments() + '</div>' + footer();
    bind();
  }

  function bind() {
    box.querySelector('[data-rv-close]').addEventListener('click', close);
    box.querySelectorAll('[data-rvf]').forEach((el) => el.addEventListener('click', () => { state.cur = Number(el.getAttribute('data-rvf')); paint(); }));
    const v = box.querySelector('#rv-v');
    box.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.getAttribute('data-rv');
      if (act === 'play') { if (!v) return; if (v.paused) { v.play(); b.textContent = '暂停'; } else { v.pause(); b.textContent = '播放'; } return; }
      if (act === 'mute') { if (!v) return; v.muted = !v.muted; b.textContent = v.muted ? '取消静音' : '静音'; return; }
      if (act === 'full') {
        const stage = box.querySelector('#rv-stage') || box.querySelector('#rv-i');
        if (stage && stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
        return;
      }
      if (act === 'expand') { state.expanded = !state.expanded; paint(); return; }
      if (act === 'more') { state.showAll = true; paint(); return; }
      if (act === 'send') {
        const ta = box.querySelector('#rv-text');
        const text = String((ta && ta.value) || '').trim();
        if (!text) return toast('请输入批注内容', 'err');
        try {
          const list = await cfg.onComment(text);
          state.comments = list || state.comments;
          toast('批注已发送', 'ok');
          paint();
        } catch (e) { toast(e.message, 'err'); }
        return;
      }
      if (act === 'canvas') {
        const cid = cfg.canvasId || ((cfg.canvases || [])[0] || {}).id;
        if (!cid) return toast('当前任务尚未绑定画布', 'err');
        cfg.onEnterCanvas && cfg.onEnterCanvas(cid);
        close();
        return;
      }
      if (act === 'upload') { cfg.onUpload && cfg.onUpload(); return; }
      if (act === 'submit' || act === 'pass' || act === 'fail') {
        try {
          const rr = await cfg.onAction(act);
          if (rr && rr.review) { state.review = rr.review.status; paint(); }
          toast(act === 'submit' ? '已提交审核' : act === 'pass' ? '已通过' : '已驳回', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      }
    }));
    const img = box.querySelector('#rv-i');
    if (img) img.addEventListener('click', () => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.92);display:grid;place-items:center;cursor:zoom-out';
      ov.innerHTML = '<img src="' + esc(img.getAttribute('src')) + '" style="max-width:96vw;max-height:94vh" />';
      ov.addEventListener('click', () => ov.remove());
      document.body.appendChild(ov);
    });
  }

  paint();
  return { close, refresh: (next) => { if (next) { state.files = next.files || state.files; state.comments = next.comments || state.comments; state.review = next.reviewStatus || state.review; } paint(); } };
}
