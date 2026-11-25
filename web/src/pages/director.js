
import { api, esc, toast, openModal, closeModal, pollTask } from '../lib.js';

let list = [];
let cur = null;

const MANNEQUIN_COLORS = [
  { k: 'red', n: '红色', c: '#e5484d' }, { k: 'orange', n: '橙色', c: '#f76b15' },
  { k: 'yellow', n: '黄色', c: '#f5d90a' }, { k: 'green', n: '绿色', c: '#30a46c' },
  { k: 'cyan', n: '青色', c: '#00b8d9' }, { k: 'blue', n: '蓝色', c: '#3b82f6' },
  { k: 'lightBlue', n: '浅蓝色', c: '#7dd3fc' }, { k: 'purple', n: '紫色', c: '#8b5cf6' },
  { k: 'rose', n: '玫红色', c: '#e93d82' }, { k: 'pink', n: '粉色', c: '#ff9fb4' },
  { k: 'black', n: '黑色', c: '#2b2f38' }, { k: 'white', n: '白色', c: '#e8ecf4' },
  { k: 'gray', n: '灰色', c: '#8b939f' },
];

const POSES = [
  { k: 'idle', n: '站立' }, { k: 'wave', n: '挥手' }, { k: 'point', n: '指向前方' },
  { k: 'run', n: '奔跑' }, { k: 'crouch', n: '蹲伏' },
];

const CAM_PRESETS = [
  { name: '主摄', fov: 42, pos: { x: 0, y: 2.4, z: 8 }, target: { x: 0, y: 1.1, z: 0 } },
  { name: '侧面', fov: 36, pos: { x: 7.5, y: 2.0, z: 3 }, target: { x: 0, y: 1.1, z: 0 } },
  { name: '俯拍', fov: 50, pos: { x: 0.4, y: 7.2, z: 5.4 }, target: { x: 0, y: 0.8, z: 0 } },
  { name: '过肩', fov: 34, pos: { x: -1.6, y: 1.9, z: 3.2 }, target: { x: 1.2, y: 1.2, z: -1 } },
  { name: '低角', fov: 46, pos: { x: 1.2, y: 0.6, z: 4.6 }, target: { x: 0, y: 1.5, z: 0 } },
];

export async function render() {
  const d = await api('/api/director');
  list = d.list || [];
  return [
    '<div class="page-head">',
    '  <div><h1>3D 导演台</h1><p>自由调度角色站位与姿态，定格电影级专属机位</p></div>',
    '  <div class="spacer"></div>',
    '  <button class="primary" id="new">新建机位</button>',
    '</div>',
    '<div class="dr-wrap">',
    '  <div>',
    '    <div class="dr-stage" id="stage">' + (list.length ? '<div class="empty">选择右侧机位查看或拍摄</div>' : '<div class="empty">还没有机位</div>') + '</div>',
    '    <div class="dr-list" id="cams" style="margin-top:10px"></div>',
    '  </div>',
    '  <div class="panel">',
    '    <h3 id="dr-title">机位面板</h3>',
    '    <div id="dr-ctrl" style="display:flex;flex-direction:column;gap:10px"></div>',
    '  </div>',
    '</div>',
  ].join('');
}

export async function mount(view) {
  const stage = view.querySelector('#stage');
  const cams = view.querySelector('#cams');
  const ctrl = view.querySelector('#dr-ctrl');

  view.querySelector('#new').addEventListener('click', async () => {
    const row = await api('/api/director', {
      method: 'POST',
      body: {
        title: '机位 ' + (list.length + 1),
        actors: [
          { id: 'a1', name: '男主', x: -1.1, z: 0.4, height: 1.78, facing: 20, pose: 'idle', color: '#5ec8ff' },
          { id: 'a2', name: '女主', x: 1.4, z: -0.5, height: 1.66, facing: -30, pose: 'wave', color: '#ff9fb4' },
        ],
        props: [{ id: 'p1', name: '灯柱', x: 3.4, z: 1.2, height: 2.6, color: '#7b8398' }],
        cameras: CAM_PRESETS.map((c, i) => ({ id: 'cam' + (i + 1), ...c })),
        activeCamera: 'cam1',
      },
    });
    open(row);
  });

  async function open(row) {
    cur = row;
    view.querySelector('#dr-title').textContent = row.title;
    stage.innerHTML = row.frameRel
      ? '<img src="' + esc(row.frameRel) + '" />'
      : '<div class="empty">点「拍摄」出图</div>';

    cams.innerHTML = (row.cameras || []).map((c) =>
      '<div class="dr-item" data-cam="' + c.id + '" style="cursor:pointer' + (c.id === row.activeCamera ? ';border-color:#2f6a92' : '') + '">' +
      '<span class="dot"></span><span>' + esc(c.name) + '</span>' +
      '<span style="color:var(--dim);font-size:11px">FOV ' + c.fov + '</span></div>').join('');
    cams.querySelectorAll('[data-cam]').forEach((n) => n.addEventListener('click', async () => {
      cur.activeCamera = n.getAttribute('data-cam');
      await api('/api/director/' + cur.id, { method: 'POST', body: { activeCamera: cur.activeCamera } });
      open(cur);
    }));

    ctrl.innerHTML = [
      '<button class="primary" id="shoot">拍摄当前机位</button>',
      '<div id="shoot-prog"></div>',
      '<div class="section-title" style="margin:8px 0 0">演员</div>',
      (cur.actors || []).map((a, i) => [
        '<div style="border:1px solid var(--line);border-radius:9px;padding:8px">',
        '<div style="display:flex;align-items:center;gap:6px;font-size:12.5px"><span style="width:8px;height:8px;border-radius:50%;background:' + esc(a.color || '#5ec8ff') + '"></span>' + esc(a.name) + '<span class="x" data-rm="' + a.id + '" style="margin-left:auto;cursor:pointer;color:var(--dim)">✕</span></div>',
        '<div class="swatches" data-sw="' + i + '" style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 2px">' +
          MANNEQUIN_COLORS.map((c) => '<i data-c="' + c.c + '" title="' + c.n + '" style="width:14px;height:14px;border-radius:50%;cursor:pointer;background:' + c.c + ';box-shadow:0 0 0 ' + ((a.color || '').toLowerCase() === c.c.toLowerCase() ? '2px var(--line2)' : '1px rgba(0,0,0,.35)') + ' inset"></i>').join('') +
        '</div>',
        '<div class="slider" style="margin-top:4px"><span style="font-size:11px;color:var(--dim);width:34px">姿势</span>' +
          '<select data-pose="' + i + '" style="flex:1;font-size:12px">' + POSES.map((q) => '<option value="' + q.k + '"' + ((a.pose || 'idle') === q.k ? ' selected' : '') + '>' + q.n + '</option>').join('') + '</select></div>',
        slider('X', a.x, -9, 9, 0.1, 'a' + i + 'x'),
        slider('Z', a.z, -9, 9, 0.1, 'a' + i + 'z'),
        slider('朝向', a.facing || 0, -180, 180, 5, 'a' + i + 'f'),
        '</div>',
      ].join('')).join(''),
      '<div class="section-title" style="margin:8px 0 0">机位</div>',
      (cur.cameras || []).filter((c) => c.id === cur.activeCamera).map((c) => [
        '<div style="border:1px solid var(--line);border-radius:9px;padding:8px">',
        '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">' + esc(c.name) + '</div>',
        slider('FOV', c.fov, 18, 80, 1, 'cf'),
        slider('高', c.pos.y, 0.4, 12, 0.1, 'cy'),
        slider('距', c.pos.z, -12, 14, 0.2, 'cz'),
        slider('偏航', c.yaw || 0, -180, 180, 2, 'cyaw'),
        '</div>',
      ].join('')).join(''),
      '<button class="ghost" id="add-actor">+ 添加演员</button>',
    ].join('');

    ctrl.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.getAttribute('data-k');
      const v = Number(inp.value);
      const lab = inp.parentElement.querySelector('span');
      if (lab) lab.textContent = v;
      apply(k, v);
    }));
    ctrl.querySelectorAll('[data-sw]').forEach((box) => box.querySelectorAll('[data-c]').forEach((sw) => sw.addEventListener('click', async () => {
      const i = Number(box.getAttribute('data-sw'));
      const a = (cur.actors || [])[i];
      if (!a) return;
      a.color = sw.getAttribute('data-c');
      await api('/api/director/' + cur.id, { method: 'POST', body: { actors: cur.actors } });
      open(cur);
    })));
    ctrl.querySelectorAll('[data-pose]').forEach((sel) => sel.addEventListener('change', async () => {
      const a = (cur.actors || [])[Number(sel.getAttribute('data-pose'))];
      if (!a) return;
      a.pose = sel.value;
      await api('/api/director/' + cur.id, { method: 'POST', body: { actors: cur.actors } });
    }));
    ctrl.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', async () => {
      cur.actors = (cur.actors || []).filter((a) => a.id !== x.getAttribute('data-rm'));
      await api('/api/director/' + cur.id, { method: 'POST', body: { actors: cur.actors } });
      open(cur);
    }));
    ctrl.querySelector('#add-actor').addEventListener('click', async () => {
      cur.actors = [...(cur.actors || []), { id: 'a' + Date.now().toString(36), name: '演员' + ((cur.actors || []).length + 1), x: 0, z: 0, height: 1.72, facing: 0, color: '#8b7cff' }];
      await api('/api/director/' + cur.id, { method: 'POST', body: { actors: cur.actors } });
      open(cur);
    });
    ctrl.querySelector('#shoot').addEventListener('click', async () => {
      const prog = ctrl.querySelector('#shoot-prog');
      const t = await api('/api/director/' + cur.id + '/shoot', { method: 'POST' });
      pollTask(t.id, (tk) => {
        prog.innerHTML = '<div class="progress"><i style="width:' + (tk.progress || 0) + '%"></i></div>';
        if (tk.status === 'done') {
          cur.frameRel = tk.result.rel;
          stage.innerHTML = '<img src="' + esc(tk.result.rel) + '" />';
          prog.innerHTML = '';
          toast('机位已定格', 'ok');
        }
      });
    });
  }

  function slider(label, val, min, max, step, key) {
    return '<div class="slider" style="margin-top:4px"><span style="font-size:11px;color:var(--dim);width:34px">' + label + '</span>' +
      '<input type="range" data-k="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (val == null ? 0 : val) + '" />' +
      '<span>' + (val == null ? 0 : val) + '</span></div>';
  }

  let t2 = null;
  function apply(k, v) {
    if (!cur) return;
    if (k[0] === 'a' && k.length > 2) {
      const i = Number(k.slice(1, k.length - 1));
      const f = k.slice(-1);
      const a = (cur.actors || [])[i];
      if (!a) return;
      if (f === 'x') a.x = v; else if (f === 'z') a.z = v; else a.facing = v;
    } else {
      const c = (cur.cameras || []).find((x) => x.id === cur.activeCamera);
      if (!c) return;
      if (k === 'cf') c.fov = v;
      else if (k === 'cy') c.pos = { ...(c.pos || {}), y: v };
      else if (k === 'cz') c.pos = { ...(c.pos || {}), z: v };
      else if (k === 'cyaw') c.yaw = v;
    }
    clearTimeout(t2);
    t2 = setTimeout(() => {
      api('/api/director/' + cur.id, { method: 'POST', body: { actors: cur.actors, cameras: cur.cameras } }).catch(() => {});
    }, 500);
  }

  if (list.length) open(list[0]);
}
