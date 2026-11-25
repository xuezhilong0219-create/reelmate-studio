import fs from 'node:fs';
import path from 'node:path';
import { db } from '../server/db.mjs';
import { hashSeed } from '../server/util.mjs';

/* ============ 可插拔 LLM（OpenAI 兼容）============ */

export function llmConfig() {
  const s = db().settings.llm || {};
  return { baseUrl: (s.baseUrl || '').replace(/\/+$/, ''), apiKey: s.apiKey || '', model: s.model || '', temperature: Number(s.temperature) || 0.8 };
}

export const llmEnabled = () => { const c = llmConfig(); return !!(c.baseUrl && c.model); };

export async function chat(messages, opts = {}) {
  const c = llmConfig();
  if (!c.baseUrl || !c.model) return null;
  const url = c.baseUrl + '/chat/completions';
  const body = JSON.stringify({
    model: opts.model || c.model,
    messages,
    temperature: opts.temperature ?? c.temperature,
    max_tokens: opts.maxTokens || 3000,
    stream: false
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: 'Bearer ' + c.apiKey } : {}) },
      body
    });
    if (!res.ok) return null;
    const j = await res.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return typeof txt === 'string' ? txt : null;
  } catch { return null; }
}

export async function chatJSON(messages, opts = {}) {
  const txt = await chat(messages, opts);
  if (!txt) return null;
  try {
    const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(txt);
    return JSON.parse(m ? m[0] : txt);
  } catch { return null; }
}

/* ============ 本地生成引擎 ============ */

const SURNAMES = ['林','沈','苏','顾','陆','江','许','温','裴','萧','段','谢','傅','宋','程','唐','秦','楚','叶','柳','燕','白','尹','商','晏'];
const GIVEN_F = ['晚','棠','昭','宁','禾','序','星','澜','逾','白','栀','眠','舟','意','知','微','清','欢','婵','月','秀','岚','禾','笙'];
const GIVEN_M = ['砚','玄','彻','行','渡','知','琰','珩','言','岐','野','朔','旸','亭','越','川','阔','昀','昀','枭','峥','牧'];
const IDENTITY_F = ['s市刑警队法医','古琴修复师','独立纪录片导演','律所合伙人','茶馆老板','旧书店店主','外科主治医师','人工智能研究员','非遗绣娘','航空工程师','心理咨询师','平面设计师','夜班调酒师','文物鉴定师'];
const IDENTITY_M = ['破案率百分百的刑警','AI 创业公司 CTO','老城区的修表匠','投行并购顾问','夜班电台主播','拳馆教练','刑事辩护律师','无人机测绘队长','古建筑修复师','急诊科医生','游戏主策','私人侦探'];
const TRAITS = ['冷静克制，情绪极少外露','嘴上刻薄，行动上比谁都软','过度理性，把感情当变量','看起来无害，其实每一步都在算','温柔到近乎纵容，却有一道不能碰的旧伤','少年气未褪，关键时刻从不退','自控力极强，唯独对一个人失守','热烈直白，把喜欢写在脸上','习惯独处，被人靠近会本能后退','胜负欲写在骨子里，输不起也护得紧'];
const SECRETS = ['三年前那场事故里，他/她并不是被救的人，而是报警的人','一直保存着对方当年写但没寄出的信','正在查的案子，嫌疑人是自己的家人','身份是假的，档案被重新做过','替人顶过一次罪，案底还在','病了很久，没告诉任何人','早就知道对方喜欢自己，一直装作不知道','上一段关系留下的孩子，对方还不知道'];
const GOALS = ['查清三年前的真相','把公司从破产边缘拉回来','拿回被夺走的名字','完成父亲没做完的事','找到失踪的妹妹','证明自己不是凶手','守住一个即将被拆掉的老街区','把一部戏拍完'];
const GENRES = {
  都市: { palette: '钢青', looks: ['teal','cool','warm'], loc: ['写字楼顶层','深夜便利店','老城区巷口','地铁末班车','江边天桥','出租屋'] },
  古装: { palette: '暖褐', looks: ['vintage','warm','highcontrast'], loc: ['长阶宫门','旧书院','雨里回廊','灯下书房','城外驿站','兵器库'] },
  悬疑: { palette: '灰阶', looks: ['noir','cool','highcontrast'], loc: ['封闭解剖室','停电的档案室','旧厂房','无人值守的监控室','雨夜停车场','废弃医院'] },
  甜宠: { palette: '晨曦', looks: ['warm','soft','dreamy'], loc: ['楼下花店','共享厨房','公司茶水间','阳台上','宠物医院','深夜食堂'] },
  科幻: { palette: '午夜蓝', looks: ['cool','teal','punch'], loc: ['轨道电梯站','数据中心','无人工厂','废弃观测站','记忆备份室','沙尘中的穹顶'] },
  玄幻: { palette: '赛博紫', looks: ['punch','highcontrast','vintage'], loc: ['断崖剑冢','祭坛','云海之上','古战场','禁地入口','浮空城'] },
  职场: { palette: '雪原', looks: ['cool','soft','highcontrast'], loc: ['会议室','加班工位','客户现场','电梯间','天台抽烟区','地下车库'] },
  校园: { palette: '幽绿', looks: ['soft','warm','dreamy'], loc: ['晚自习教室','操场看台','图书馆顶楼','校门口小吃街','化学实验室','毕业照的台阶'] },
  家庭: { palette: '薄雾', looks: ['warm','vintage','soft'], loc: ['老房子厨房','医院走廊','年夜饭餐桌','阳台','墓园','长途汽车站'] },
  犯罪: { palette: '暗红', looks: ['noir','punch','highcontrast'], loc: ['码头仓库','赌场后巷','审讯室','废弃码头','高速服务区','烂尾楼'] },
};
const GENRE_KEYS = Object.keys(GENRES);

const SHOTS = ['特写','近景','中景','全景','大远景','过肩','俯拍','仰拍','手持跟拍','镜面反射'];
const MOODS_ZH = ['压抑','克制','暗涌','明亮','迟疑','决绝','温柔','锋利','疲惫','期待'];
const TIMES = ['清晨','上午','午后','黄昏','入夜','深夜','凌晨'];

function rndOf(seed) { let s = (seed >>> 0) || 13; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const pickOne = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
function pickN(arr, n, r) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  return out;
}

export function detectGenre(text) {
  const t = String(text || '');
  const rules = [
    [/古装|宫廷|王爷|江湖|剑|修仙|王朝|皇帝|将军|侠/, '古装'],
    [/悬疑|案件|凶手|尸体|推理|侦探|密室|命案/, '悬疑'],
    [/甜|恋爱|心动|宠|初恋|告白/, '甜宠'],
    [/科幻|AI|赛博|星际|未来|机器人|太空/, '科幻'],
    [/玄幻|灵力|宗门|大陆|魔王|神族/, '玄幻'],
    [/职场|公司|升职|老板|项目|甲方|融资/, '职场'],
    [/校园|高中|大学|同桌|考场|毕业/, '校园'],
    [/家庭|父母|妈妈|父亲|离婚|养老|孩子/, '家庭'],
    [/犯罪|黑帮|走私|枪|走私|帮派|卧底/, '犯罪'],
  ];
  for (const [re, g] of rules) if (re.test(t)) return g;
  return '都市';
}

export function makeCharacters(seed, genre, count = 4, hintNames = []) {
  const r = rndOf(seed);
  const out = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const isF = i % 2 === 0;
    let name = hintNames[i];
    if (!name) {
      let tries = 0;
      do { name = pickOne(SURNAMES, r) + pickOne(isF ? GIVEN_F : GIVEN_M, r); tries++; } while (used.has(name) && tries < 30);
    }
    used.add(name);
    out.push({
      id: 'ch_' + i,
      name,
      gender: isF ? '女' : '男',
      age: 22 + Math.floor(r() * 16),
      identity: pickOne(isF ? IDENTITY_F : IDENTITY_M, r),
      trait: pickOne(TRAITS, r),
      goal: pickOne(GOALS, r),
      secret: pickOne(SECRETS, r),
      look: ['短发，穿深色外套，左手腕有一道旧疤','长发及腰，总是戴着一条细银链','寸头，眉眼锋利，笑起来却很干净','戴细框眼镜，白衬衫袖口永远卷到手肘','常年一件洗旧的卫衣，指甲修得极短','身形很高，习惯把手插在兜里'][Math.floor(r() * 6)],
      relation: ['主角','对手','盟友','引路人'][i % 4],
      genre
    });
  }
  return out;
}

const BEATS = ['开场钩子','日常被打破','第一次交锋','线索浮现','误判与代价','反转揭示','代价摊开','最终对峙','余韵'];

function sceneDialog(a, b, place, r, beat) {
  const lines = [
    ['你还记得三年前那天吗？', '记得。记得每一秒。'],
    ['我不需要你替我决定。', '那你告诉我，我还能怎么选。'],
    ['这件事到此为止。', '止不了。你已经把我拖进来了。'],
    ['你为什么帮我？', '因为我不想再看你一个人扛。'],
    ['证据是假的。', '那真的在哪？你心里清楚。'],
    ['你变了。', '我只是终于不装了。'],
    ['我信你。', '别信我。'],
    ['这次换我护着你。', '你护不住。你自己都快撑不住了。'],
  ];
  const pair = lines[Math.floor(r() * lines.length)];
  return [
    { role: a, text: pair[0] },
    { role: b, text: pair[1] },
  ];
}

/** 生成完整剧本（多集 + 分场 + 台词 + 分镜）。本地确定性生成，可选 LLM 增强 */
export function makeScript(opts = {}) {
  const { idea = '', title = '', genre = null, episodes: epCount = 3, scenesPerEp = 4, style = '短剧' } = opts;
  const g = genre || detectGenre(idea || title);
  const cfg = GENRES[g] || GENRES['都市'];
  const seed = hashSeed([idea, title, g, epCount, style].join('|'));
  const r = rndOf(seed);
  const chars = makeCharacters(seed, g, 4);
  const finalTitle = title || ([pickOne(['雨夜','长夜','旧信','归途','暗涌','第二次','无人接听','最后一班'], r), pickOne(['霓虹','回声','证词','夏天','告白','信号','列车','雪'], r)].join(''));

  const eps = [];
  for (let e = 0; e < epCount; e++) {
    const scenes = [];
    for (let s = 0; s < scenesPerEp; s++) {
      const beat = BEATS[(e * scenesPerEp + s) % BEATS.length];
      const place = pickOne(cfg.loc, r);
      const time = pickOne(TIMES, r);
      const a = chars[Math.floor(r() * chars.length)].name;
      let b = chars[Math.floor(r() * chars.length)].name;
      if (b === a) b = chars[(chars.findIndex((c) => c.name === a) + 1) % chars.length].name;
      const dialog = sceneDialog(a, b, place, r, beat);
      const action = [
        a + '推门进来，雨水顺着伞骨往下滴，目光先落在' + place + '角落的那个身影上。',
        b + '没有回头，只是把手里的东西往桌上一推：一份被翻旧的资料。',
        '两个人隔着' + (2 + Math.floor(r() * 5)) + '步的距离站着，谁都没有先动。',
        a + '伸手去拿，被' + b + '按住手腕。空气停了两秒。',
        '窗外' + time + '的光线压下来，把' + place + '切成明暗两半。'
      ][Math.floor(r() * 5)];
      const shots = [];
      const nShot = 3 + Math.floor(r() * 2);
      for (let k = 0; k < nShot; k++) {
        shots.push({
          no: k + 1,
          size: pickOne(SHOTS, r),
          duration: 2 + Math.floor(r() * 4),
          motion: pickOne(['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'tilt-up', 'dolly', 'handheld', 'static'], r),
          look: pickOne(cfg.looks, r),
          mood: pickOne(MOODS_ZH, r),
          prompt: [place, time, pickOne(['冷光','暖光','侧逆光','顶光'], r), pickOne(['雨','雾','尘','无风'], r), pickOne(['中景人物剪影','大面积留白','贴脸特写','俯视构图'], r)].join('，'),
          caption: k === 0 ? beat : '',
        });
      }
      scenes.push({
        no: s + 1, beat, place, time,
        heading: (s + 1) + '. ' + (['内景', '外景'][Math.floor(r() * 2)]) + ' · ' + place + ' · ' + time,
        action,
        dialog,
        mood: pickOne(MOODS_ZH, r),
        shots,
      });
    }
    eps.push({
      no: e + 1,
      title: '第' + (e + 1) + '集 · ' + pickOne(['裂缝','旧账','回声','底线','失手','对峙','余温','出口'], r),
      logline: pickOne([
        '一个不该出现的人，把所有旧的账重新翻了出来。',
        '他们以为已经过去的事，在' + pickOne(cfg.loc, r) + '重新开始。',
        '越靠近真相，越像在把自己往悬崖边推。',
        '有人第一次说了真话，代价是失去另一个人。'
      ], r),
      hook: pickOne(['门开了，站在外面的人不该在这里。', '手机亮起，是一条三年前的未读消息。', '他伸手去接，却听见了另一把声音。', '所有的灯在同一秒熄灭。'], r),
      scenes
    });
  }

  return {
    title: finalTitle,
    genre: g,
    style,
    logline: pickOne([
      '两个人各自握着一半真相，谁先松手谁就输。',
      '她回来只为了一件事：把名字从那份文件上划掉。',
      '他查了三年，最后发现要找的人一直在身边。',
      '一场意外的重逢，把两个人重新按回同一个伤口。'
    ], r),
    characters: chars,
    palette: cfg.palette,
    episodes: eps,
    meta: { generatedBy: llmEnabled() ? 'llm+local' : 'local', seed }
  };
}

/* 把本地剧本转成纯文本（导出用） */
export function scriptToText(script) {
  const L2 = [];
  L2.push('《' + script.title + '》');
  L2.push('题材：' + script.genre + '　类型：' + (script.style || '短剧'));
  L2.push('一句话故事：' + (script.logline || ''));
  L2.push('');
  L2.push('【人物】');
  for (const c of script.characters || []) {
    L2.push('- ' + c.name + '（' + c.gender + '，' + c.age + '）' + c.identity + '；' + c.trait + '；目标：' + c.goal + '；秘密：' + c.secret);
  }
  L2.push('');
  for (const ep of script.episodes || []) {
    L2.push('=== ' + ep.title + ' ===');
    L2.push('梗概：' + ep.logline);
    for (const sc of ep.scenes || []) {
      L2.push('');
      L2.push(sc.heading);
      L2.push('　' + sc.action);
      for (const d of sc.dialog || []) L2.push('　　' + d.role + '：' + d.text);
      L2.push('　　情绪：' + sc.mood + '　镜头数：' + (sc.shots || []).length);
    }
    L2.push('');
  }
  return L2.join('\n');
}

/* 小说分析：世界观 / 角色卡 / 章节大纲 / 剧集大纲 */
export function analyzeNovel(text, opts = {}) {
  const { title = '未命名小说' } = opts;
  const body = String(text || '');
  const seed = hashSeed(body.slice(0, 4000) + title);
  const r = rndOf(seed);
  const g = detectGenre(body);
  const cfg = GENRES[g] || GENRES['都市'];
  const chars = makeCharacters(seed, g, 5);
  const chapterCount = Math.max(3, Math.min(30, Math.round(body.length / 1200) || 6));
  const chapters = [];
  for (let i = 0; i < chapterCount; i++) {
    chapters.push({
      no: i + 1,
      title: '第' + (i + 1) + '章 · ' + pickOne(['初见','裂痕','旧信','雨夜','试探','失约','回声','底线','归途','余烬'], r),
      summary: pickOne([
        '主角第一次正面撞上那件被所有人回避的旧事。',
        '一段被刻意删掉的记忆浮出水面，但没有证据。',
        '两个人达成了一个谁都不信的同盟。',
        '代价第一次被摊开算清楚。',
        '有人选择了沉默，另一个人选择了背叛。'
      ], r),
      key: pickOne(['线索','关系转折','情绪高点','伏笔','反转'], r)
    });
  }
  const epCount = Math.max(3, Math.min(12, Math.round(chapterCount / 2)));
  const episodes = [];
  for (let i = 0; i < epCount; i++) {
    episodes.push({
      no: i + 1,
      title: '第' + (i + 1) + '集 · ' + pickOne(['落点','暗线','裂缝','逆流','临界的夜','最后一句话'], r),
      summary: pickOne(['把主线推到不可回头的位置。','让两个角色的目标第一次正面冲突。','用一个物证串起前三章的伏笔。','把配角的动机翻出来。'], r),
      chapters: [i * 2 + 1, Math.min(chapterCount, i * 2 + 2)].filter((n) => n <= chapterCount)
    });
  }
  return {
    title, genre: g, palette: cfg.palette,
    worldview: {
      era: pickOne(['现代都市','架空古代','近未来','民国','边境小城'], r),
      rules: pickOne(['所有交易都要有见证人','记忆可以被备份，但不能被删除','血脉决定阶层','技术垄断了一切'], r),
      conflict: pickOne(['旧秩序与新利益的正面撞击','真相被系统性掩盖','两个家族的世仇','资源短缺下的道德崩塌'], r),
      tone: pickOne(['冷峻克制','热烈直白','阴郁潮湿','明亮带刺'], r)
    },
    characters: chars,
    chapters, episodes, seed
  };
}

export { GENRES, GENRE_KEYS };

