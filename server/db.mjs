import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.join(ROOT, 'data');
export const MEDIA = path.join(DATA, 'media');
export const DB_FILE = path.join(DATA, 'db.json');

for (const d of [DATA, MEDIA, path.join(MEDIA, 'image'), path.join(MEDIA, 'video'), path.join(MEDIA, 'audio'), path.join(MEDIA, 'upload'), path.join(DATA, 'thumbs')]) {
  fs.mkdirSync(d, { recursive: true });
}

export const uid = (p = '') => p + crypto.randomBytes(8).toString('hex');
export const now = () => new Date().toISOString();
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const MODEL_CATALOG = [
  { id: 'tianmu_3_5_pro', name: '天幕3.5 Pro', kind: 'video', desc: '本地引擎·电影质感' },
  { id: 'tianmu_3_0_pro', name: '天幕3.0 Pro', kind: 'video', desc: '本地引擎·均衡画质' },
  { id: 'tomoviee2_1', name: '天幕2.1', kind: 'video', desc: '本地引擎·快速出片' },
  { id: 'seedance_1_5_pro', name: '即梦3.5 Pro', kind: 'video', desc: '本地引擎·动态运镜' },
  { id: 'kling_2_6', name: '可灵2.6', kind: 'video', desc: '本地引擎·人物动作' },
  { id: 'veo3_1', name: 'TV 3.1', kind: 'video', desc: '本地引擎·长镜头' },
  { id: 'nano_banana_pro', name: 'Nano Banana Pro', kind: 'image', desc: '本地引擎·高精度构图' },
  { id: 'seedream_5_0_pro', name: 'Seedream 5.0 Pro', kind: 'image', desc: '本地引擎·海报级' },
  { id: 'gpt_image_2_5_flare', name: 'TGI 2.5', kind: 'image', desc: '本地引擎·写实光影' },
  { id: 'master', name: '专家模式', kind: 'both', desc: '本地引擎·全参数开放' }
];

function seedDB() {
  return {
    meta: { version: 1, createdAt: now(), name: 'Reelmate Studio' },
    users: [{ id: 'u_local', name: '本地用户', email: 'local@studio', role: 'owner', createdAt: now() }],
    sessions: {},
    settings: {
      siteName: '剧作工坊',
      siteSub: '本地 AI 影视创作工作台',
      llm: { baseUrl: '', apiKey: '', model: 'gpt-4o-mini', temperature: 0.8 },
      engine: { imageWidth: 1280, imageHeight: 720, fps: 24, concurrency: 2, watermark: false },
      defaults: { ratio: '16:9', duration: 5, model: 'tianmu_3_0_pro', imageModel: 'nano_banana_pro' }
    },
    models: MODEL_CATALOG,
    team: { id: 'team_local', name: '我的创作组', ownerId: 'u_local', seats: 10, credits: 1000000, createdAt: now() },
    members: [{ id: 'u_local', name: '本地用户', email: 'local@studio', groupId: 'g_admin', role: 'owner', joinedAt: now(), status: 'active' }],
    groups: [
      { id: 'g_admin', name: '管理员', permissions: ['all'] },
      { id: 'g_editor', name: '编辑', permissions: ['project', 'episode', 'asset', 'generate'] },
      { id: 'g_viewer', name: '只读', permissions: ['view'] }
    ],
    projects: [], episodes: [], storyboards: [], assets: [], folders: [],
    scripts: [], novels: [], canvas: [], canvasProjects: [], workflows: [],
    tasks: [], ledger: [], works: [], knowledge: [], prompts: [], voices: [],
    director: [], filmProjects: [], adDrama: [], translations: [], redraws: [],
    activities: [], invites: [], creator: { works: [], earnings: [] }
  };
}

let cache = null;

export function db() {
  if (cache) return cache;
  const fresh = seedDB();
  if (fs.existsSync(DB_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      cache = { ...fresh, ...loaded };
    } catch {
      cache = fresh;
    }
  } else {
    cache = fresh;
    saveNow();
  }
  return cache;
}

let timer = null;
export function save() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; writeNow(); }, 40);
}
export function saveNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  writeNow();
}
function writeNow() {
  if (!cache) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

export function addLedger(delta, reason, taskId) {
  const d = db();
  const row = { id: uid('lg_'), at: now(), delta, reason, taskId: taskId || null };
  d.ledger.unshift(row);
  d.ledger = d.ledger.slice(0, 800);
  save();
  return row;
}
