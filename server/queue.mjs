import { db, uid, now, save, addLedger } from './db.mjs';

/* 本地任务队列：并发受 settings.engine.concurrency 控制，任务状态全部落 db */
const queue = [];
let running = 0;
const listeners = new Set();

export const onTask = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (t) => { for (const fn of listeners) { try { fn(t); } catch {} } };

export function getTask(id) {
  return db().tasks.find((t) => t.id === id) || null;
}

export function listTasks(filter = {}) {
  const d = db();
  let rows = d.tasks;
  if (filter.kind) rows = rows.filter((t) => t.kind === filter.kind);
  if (filter.status) rows = rows.filter((t) => t.status === filter.status);
  if (filter.tool) rows = rows.filter((t) => t.tool === filter.tool);
  return rows.slice(0, filter.limit || 120);
}

/** 入队一个任务：runner 返回结果对象 */
export function enqueue(kind, params = {}, runner, meta = {}) {
  const d = db();
  const task = {
    id: uid('task_'),
    kind,
    tool: meta.tool || kind,
    title: meta.title || kind,
    params,
    status: 'queued',
    progress: 0,
    step: '排队中',
    result: null,
    error: null,
    credits: meta.credits || 0,
    createdAt: now(),
    startedAt: null,
    finishedAt: null
  };
  d.tasks.unshift(task);
  d.tasks = d.tasks.slice(0, 600);
  save();
  queue.push({ task, runner });
  emit(task);
  pump();
  return task;
}

export function updateTask(task, patch) {
  Object.assign(task, patch);
  save();
  emit(task);
  return task;
}

function concurrency() {
  const n = Number((db().settings.engine || {}).concurrency) || 2;
  return Math.max(1, Math.min(6, n));
}

async function pump() {
  while (running < concurrency() && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job).finally(() => { running--; pump(); });
  }
}

async function runJob({ task, runner }) {
  updateTask(task, { status: 'running', startedAt: now(), progress: 5, step: '准备中' });
  try {
    const result = await runner({
      progress: (p, step) => updateTask(task, { progress: Math.max(0, Math.min(99, Math.round(p))), step: step || task.step })
    });
    if (result && result.ok === false) {
      updateTask(task, { status: 'failed', error: result.error || '生成失败', finishedAt: now() });
    } else {
      updateTask(task, { status: 'done', progress: 100, step: '完成', result: result || {}, finishedAt: now() });
      if (task.credits) addLedger(-task.credits, task.tool + ' · ' + task.title, task.id);
    }
  } catch (e) {
    updateTask(task, { status: 'failed', error: String((e && e.message) || e), finishedAt: now() });
  }
}

export const queueStats = () => ({ queued: queue.length, running, concurrency: concurrency() });

