import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MEDIA, uid } from '../server/db.mjs';
import { runFF } from './ffmpeg.mjs';
import { hashSeed } from '../server/util.mjs';

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
};

const MOODS = {
  epic: { root: 45, scale: 'minor', tempo: 84, bright: 0.55, drums: 0.55 },
  sad: { root: 48, scale: 'minor', tempo: 62, bright: 0.30, drums: 0.12 },
  happy: { root: 60, scale: 'major', tempo: 118, bright: 0.80, drums: 0.45 },
  tense: { root: 41, scale: 'phrygian', tempo: 96, bright: 0.40, drums: 0.60 },
  calm: { root: 55, scale: 'pentatonic', tempo: 70, bright: 0.45, drums: 0.08 },
  mysterious: { root: 43, scale: 'wholeTone', tempo: 74, bright: 0.35, drums: 0.25 },
  romantic: { root: 53, scale: 'major', tempo: 76, bright: 0.62, drums: 0.15 },
  action: { root: 40, scale: 'minorPent', tempo: 132, bright: 0.58, drums: 0.80 },
  horror: { root: 38, scale: 'phrygian', tempo: 58, bright: 0.22, drums: 0.30 },
  dream: { root: 57, scale: 'lydian', tempo: 66, bright: 0.70, drums: 0.10 },
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** 安全淡出：起始时间不得为负，时长自适应 */
function fadeOut(st, d) {
  const s = Math.max(0, Number(st) || 0);
  const dd = Math.max(0.01, Number(d) || 0.1);
  return 'afade=t=out:st=' + s.toFixed(3) + ':d=' + dd.toFixed(3);
}
function fadeIn(d) { return 'afade=t=in:st=0:d=' + Math.max(0.005, Number(d) || 0.01).toFixed(3); }

const rndOf = (seed) => { let s = (seed >>> 0) || 7; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

function pickMood(text) {
  const t = String(text || '');
  const rules = [
    [/悲伤|离别|哭|泪|失去|遗憾|孤独|sad|lonely|miss/i, 'sad'],
    [/恐怖|惊悚|阴森|鬼|血|黑暗|horror|scary|dark/i, 'horror'],
    [/紧张|悬疑|追|逃|危险|tense|suspense|chase/i, 'tense'],
    [/战斗|打斗|动作|爆|冲|action|fight|battle/i, 'action'],
    [/史诗|宏大|壮阔|hero|epic|grand/i, 'epic'],
    [/浪漫|爱情|心动|温柔|romance|love|tender/i, 'romantic'],
    [/梦|幻|飘|仙|dream|float|ether/i, 'dream'],
    [/神秘|谜|未知|mystery|unknown/i, 'mysterious'],
    [/开心|快乐|欢快|阳光|happy|joy|sunny/i, 'happy'],
    [/宁静|安静|治愈|清晨|calm|quiet|heal/i, 'calm'],
  ];
  for (const [re, mood] of rules) if (re.test(t)) return mood;
  const keys = Object.keys(MOODS);
  return keys[hashSeed(t) % keys.length];
}

export async function renderMusic(opts = {}) {
  const { prompt = '', duration = 30, mood = null, tempo = null, seedText = '' } = opts;
  const m = MOODS[mood] || MOODS[pickMood(prompt)];
  const scale = SCALES[m.scale] || SCALES.minor;
  const bpm = tempo || m.tempo;
  const rnd = rndOf(hashSeed((seedText || prompt) + '|music'));
  const root = m.root;
  const dur = Math.max(2, Number(duration) || 30);

  const degs = [0, 3, 4, 5, 2, 1];
  for (let i = degs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = degs[i]; degs[i] = degs[j]; degs[j] = t; }
  const chords = degs.slice(0, 4).map((d) => [0, 2, 4].map((k) => root + scale[(d + k) % scale.length] + 12 * Math.floor((d + k) / scale.length)));

  const inputs = [];
  const labels = [];
  let idx = 0;
  const chordDur = dur / chords.length;

  const fadeD = Math.max(0.05, Math.min(1.1, chordDur * 0.42));
  for (let ci = 0; ci < chords.length; ci++) {
    const notes = chords[ci];
    for (const n of notes) {
      const amp = (0.16 / notes.length) * (0.7 + rnd() * 0.4);
      inputs.push('-f', 'lavfi', '-t', chordDur.toFixed(3), '-i',
        'sine=frequency=' + mtof(n).toFixed(3) + ':sample_rate=44100,volume=' + amp.toFixed(3) + ',' + fadeIn(fadeD) + ',' + fadeOut(chordDur - fadeD, fadeD));
      labels.push('[' + idx + ':a]'); idx++;
      if (m.bright > 0.45) {
        inputs.push('-f', 'lavfi', '-t', chordDur.toFixed(3), '-i',
          'sine=frequency=' + (mtof(n) * 2).toFixed(3) + ':sample_rate=44100,volume=' + (amp * m.bright * 0.5).toFixed(3) + ',' + fadeIn(fadeD * 0.8) + ',' + fadeOut(chordDur - fadeD * 0.8, fadeD * 0.8));
        labels.push('[' + idx + ':a]'); idx++;
      }
    }
  }

  const arpCount = Math.min(120, Math.round((bpm / 60) * dur * 0.5));
  for (let i = 0; i < arpCount; i++) {
    const t0 = (i / arpCount) * dur;
    const ci = Math.min(chords.length - 1, Math.floor(t0 / chordDur));
    const chord = chords[ci];
    const n = chord[Math.floor(rnd() * chord.length)] + 12;
    const d = 0.35 + rnd() * 0.4;
    inputs.push('-f', 'lavfi', '-t', d.toFixed(2), '-i',
      'sine=frequency=' + mtof(n).toFixed(3) + ':sample_rate=44100,volume=' + (0.055 * m.bright).toFixed(3) + ',' + fadeIn(0.02) + ',' + fadeOut(d - 0.12, 0.12) + ',adelay=' + Math.round(t0 * 1000) + '|' + Math.round(t0 * 1000));
    labels.push('[' + idx + ':a]'); idx++;
  }

  if (m.drums > 0.2) {
    const beats = Math.min(90, Math.round((bpm / 60) * dur));
    for (let i = 0; i < beats; i++) {
      const t0 = i / (bpm / 60);
      const d = 0.18;
      inputs.push('-f', 'lavfi', '-t', d.toFixed(2), '-i',
        'sine=frequency=52:sample_rate=44100,volume=' + (0.22 * m.drums).toFixed(3) + ',' + fadeOut(0, d) + ',adelay=' + Math.round(t0 * 1000) + '|' + Math.round(t0 * 1000));
      labels.push('[' + idx + ':a]'); idx++;
    }
  }

  if (!idx) return { ok: false, error: 'no source' };

  const filter = labels.join('') + 'amix=inputs=' + idx + ':duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.9,atrim=0:' + dur.toFixed(2) + ',asetpts=N/SR/TB[out]';
  const id = uid('mus_');
  const outPath = path.join(MEDIA, 'audio', id + '.mp3');
  const args = ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '4', outPath];
  const r = await runFF(args, { timeout: 180000 });
  if (!r.ok) return { ok: false, error: 'ffmpeg failed', log: r.log.slice(-1500) };
  return { ok: true, id, file: outPath, rel: '/media/audio/' + id + '.mp3', duration: dur, mood: mood || pickMood(prompt), tempo: bpm };
}

export async function renderSfx(opts = {}) {
  const { prompt = '', duration = 4, category = null } = opts;
  const t = String(prompt || '');
  const cat = category || (
    /雨|rain/i.test(t) ? 'rain' :
    /风|wind/i.test(t) ? 'wind' :
    /雷|thunder/i.test(t) ? 'thunder' :
    /海|浪|wave|sea/i.test(t) ? 'wave' :
    /脚步|footstep/i.test(t) ? 'footstep' :
    /开门|door/i.test(t) ? 'door' :
    /汽车|车|car|traffic/i.test(t) ? 'traffic' :
    /火|fire|crackle/i.test(t) ? 'fire' :
    /爆炸|explosion|boom/i.test(t) ? 'boom' :
    /心跳|heart/i.test(t) ? 'heart' : 'ambient'
  );
  const dur = Math.max(0.5, Number(duration) || 4);
  const D = dur.toFixed(2);
  const fi = (d) => fadeIn(Math.min(d, dur * 0.35));
  const fo = (tailLen) => fadeOut(dur - Math.min(tailLen, dur * 0.5), Math.min(tailLen, dur * 0.5));
  const id = uid('sfx_');
  const outPath = path.join(MEDIA, 'audio', id + '.mp3');
  const recipes = {
    rain: 'anoisesrc=color=white:amplitude=0.5,highpass=f=900,lowpass=f=7000,volume=0.35,' + fi(0.5) + ',' + fo(0.6),
    wind: 'anoisesrc=color=brown:amplitude=0.6,lowpass=f=800,volume=0.5,tremolo=f=0.4:d=0.6,' + fi(0.8) + ',' + fo(0.8),
    thunder: 'anoisesrc=color=brown:amplitude=0.9,lowpass=f=260,volume=0.9,' + fi(0.05) + ',' + fo(0.5),
    wave: 'anoisesrc=color=pink:amplitude=0.55,lowpass=f=1600,volume=0.4,tremolo=f=0.28:d=0.8,' + fi(1) + ',' + fo(1),
    footstep: 'anoisesrc=color=brown:amplitude=0.7,lowpass=f=340,volume=0.7,tremolo=f=2.2:d=1,' + fi(0.02) + ',' + fo(0.1),
    door: 'anoisesrc=color=brown:amplitude=0.8,lowpass=f=500,volume=0.6,' + fi(0.02) + ',' + fo(0.4),
    traffic: 'anoisesrc=color=pink:amplitude=0.5,bandpass=f=420:width_type=h:w=280,volume=0.45,' + fi(0.6) + ',' + fo(0.7),
    fire: 'anoisesrc=color=white:amplitude=0.4,bandpass=f=1800:width_type=h:w=1200,volume=0.32,tremolo=f=6:d=0.8,' + fi(0.3) + ',' + fo(0.5),
    boom: 'anoisesrc=color=brown:amplitude=1,lowpass=f=160,volume=1.0,' + fi(0.01) + ',' + fo(0.2),
    heart: 'sine=frequency=58:sample_rate=44100,tremolo=f=1.3:d=1,volume=0.8,' + fo(0.4),
    ambient: 'anoisesrc=color=pink:amplitude=0.35,lowpass=f=2200,volume=0.3,' + fi(0.8) + ',' + fo(0.9),
  };
  const chain = recipes[cat] || recipes.ambient;
  const r = await runFF(['-y', '-f', 'lavfi', '-t', D, '-i', chain, '-c:a', 'libmp3lame', '-q:a', '5', outPath], { timeout: 60000 });
  if (!r.ok) return { ok: false, error: 'ffmpeg failed', log: r.log.slice(-1200) };
  return { ok: true, id, file: outPath, rel: '/media/audio/' + id + '.mp3', duration: dur, category: cat };
}

export async function renderSpeech(opts = {}) {
  const { text = '', voice = 'zh-CN', rate = 0, pitch = 0 } = opts;
  const id = uid('tts_');
  const wavPath = path.join(MEDIA, 'audio', id + '.wav');
  const mp3Path = path.join(MEDIA, 'audio', id + '.mp3');
  const clean = String(text || '').replace(/["`$]/g, ' ').trim();
  if (!clean) return { ok: false, error: 'empty text' };

  /* 本机只装了两套 SAPI 音色（Huihui / Zira），其余音色用基准音色 + 变调变速率派生 */
  const VOICE_DEF = {
    'zh-CN':        { base: 'Microsoft Huihui Desktop', pitch: 1.00, rate: 0 },
    'zh-CN-female': { base: 'Microsoft Huihui Desktop', pitch: 1.00, rate: 0 },
    'zh-CN-male':   { base: 'Microsoft Huihui Desktop', pitch: 0.86, rate: -1 },
    'zh-CN-soft':   { base: 'Microsoft Huihui Desktop', pitch: 1.05, rate: -2 },
    'zh-CN-news':   { base: 'Microsoft Huihui Desktop', pitch: 1.02, rate: 1 },
    'en-US':        { base: 'Microsoft Zira Desktop',   pitch: 1.00, rate: 0 },
    'en-US-female': { base: 'Microsoft Zira Desktop',   pitch: 1.00, rate: 0 },
    'en-US-male':   { base: 'Microsoft Zira Desktop',   pitch: 0.84, rate: -1 },
    'narrator':     { base: 'Microsoft Huihui Desktop', pitch: 0.90, rate: -3 },
    'child':        { base: 'Microsoft Huihui Desktop', pitch: 1.22, rate: 2 },
    'elder':        { base: 'Microsoft Huihui Desktop', pitch: 0.82, rate: -4 },
  };
  const vDef = VOICE_DEF[voice] || VOICE_DEF['zh-CN'];
  const voiceName = vDef.base;
  const wavEsc = wavPath.replace(/\\/g, '\\\\');

  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'try { $s.SelectVoice("' + voiceName + '") } catch {}',
    '$s.Rate = ' + Math.max(-10, Math.min(10, (Number(rate) || 0) + (vDef.rate || 0))),
    '$s.Volume = 100',
    '$s.SetOutputToWaveFile("' + wavEsc + '")',
    '$s.Speak([Console]::In.ReadToEnd())',
    '$s.Dispose()'
  ].join('; ');

  const ok = await new Promise((resolve) => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(wavPath) && fs.statSync(wavPath).size > 1000));
    proc.stdin.write(clean, 'utf8');
    proc.stdin.end();
  });

  if (!ok) {
    const dur = Math.max(1.2, Math.min(30, clean.length * 0.22));
    const r2 = await runFF(['-y', '-f', 'lavfi', '-t', dur.toFixed(2), '-i',
      'sine=frequency=180:sample_rate=44100,volume=0.06,tremolo=f=3.5:d=0.7,afade=t=in:st=0:d=0.05,afade=t=out:st=' + (dur - 0.2).toFixed(2) + ':d=0.2',
      '-c:a', 'libmp3lame', '-q:a', '5', mp3Path], { timeout: 60000 });
    if (!r2.ok) return { ok: false, error: 'tts unavailable' };
    return { ok: true, id, file: mp3Path, rel: '/media/audio/' + id + '.mp3', format: 'mp3', fallback: true, duration: dur };
  }

  /* 只有两套真音色，靠变调/变速派生出不同人物质感（asetrate 改音高，atempo 还原时长） */
  const pitchMul = Number(vDef.pitch) || 1;
  const convArgs = ['-y', '-i', wavPath];
  if (Math.abs(pitchMul - 1) > 0.01) {
    convArgs.push('-filter:a', 'asetrate=44100*' + pitchMul.toFixed(3) + ',aresample=44100,atempo=' + (1 / pitchMul).toFixed(4));
  }
  convArgs.push('-c:a', 'libmp3lame', '-q:a', '4', mp3Path);
  const conv = await runFF(convArgs);
  if (!conv.ok) return { ok: true, id, file: wavPath, rel: '/media/audio/' + id + '.wav', format: 'wav' };
  try { fs.unlinkSync(wavPath); } catch {}
  return { ok: true, id, file: mp3Path, rel: '/media/audio/' + id + '.mp3', format: 'mp3', voice: voiceName, voiceId: voice, pitch: pitchMul, gender: vDef.pitch < 0.95 ? 'male' : 'female' };
}

export { MOODS, SCALES, pickMood };
