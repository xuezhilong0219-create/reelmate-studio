
/**
 * 工具箱 17 个能力的元数据（对齐 reelmate.cn /tools 的卡片 + 自己的字段设计）
 * kind: image | video | music | sfx | speech | agent
 */
export const TOOLS = [
  {
    id: 'text-to-video', title: '文生视频', icon: '🎬', group: 'AI 视频', kind: 'video',
    desc: '主流高质量模型，风格、动作轻松产出',
    fields: [
      { name: 'prompt', type: 'textarea', label: '画面描述', required: true, ph: '例如：暴雨夜的霓虹街头，镜头缓慢推进，主角撑伞回望' },
      { name: 'count', type: 'number', label: '生成条数', value: 1, min: 1, max: 4 },
      { name: 'duration', type: 'number', label: '单条时长（秒）', value: 5, min: 2, max: 15 },
      { name: 'ratio', type: 'select', label: '画幅', options: [['16:9', '16:9 横屏'], ['9:16', '9:16 竖屏'], ['1:1', '1:1 方形'], ['4:3', '4:3']], value: '16:9' },
      { name: 'style', type: 'style' },
      { name: 'motion', type: 'select', label: '运镜', options: [['auto', '智能匹配'], ['zoom-in', '推近'], ['zoom-out', '拉远'], ['pan-left', '左摇'], ['pan-right', '右摇'], ['tilt-up', '上摇'], ['tilt-down', '下摇'], ['handheld', '手持'], ['crash', '急推']], value: 'auto' },
      { name: 'subtitle', type: 'switch', label: '烧录字幕' },
    ],
  },
  {
    id: 'image-to-video', title: '图生视频', icon: '🖼️', group: 'AI 视频', kind: 'video',
    desc: '一键让静态图动出电影感',
    fields: [
      { name: 'prompt', type: 'textarea', label: '动作 / 氛围描述', ph: '例如：人物缓缓回头，风吹动衣角' },
      { name: 'sourceAssetId', type: 'asset', label: '首帧图片', accept: 'image', required: true },
      { name: 'duration', type: 'number', label: '时长（秒）', value: 5, min: 2, max: 15 },
      { name: 'motion', type: 'select', label: '运镜', options: [['zoom-in', '推近'], ['zoom-out', '拉远'], ['pan-left', '左摇'], ['pan-right', '右摇'], ['tilt-up', '上摇'], ['tilt-down', '下摇'], ['handheld', '手持'], ['crash', '急推'], ['static', '静止']], value: 'zoom-in' },
      { name: 'look', type: 'select', label: '调色', options: [['none', '原色'], ['warm', '暖调'], ['cool', '冷调'], ['noir', '黑白'], ['teal', '青橙'], ['vintage', '复古'], ['punch', '高对比']], value: 'none' },
    ],
  },
  {
    id: 'reference-to-video', title: '参考生视频', icon: '🎞️', group: 'AI 视频', kind: 'video',
    desc: '多图参考，让画面自然动起来',
    fields: [
      { name: 'prompt', type: 'textarea', label: '画面描述', required: true, ph: '描述希望参考图组合出的镜头' },
      { name: 'sourceAssetIds', type: 'assets', label: '参考图（最多 3 张）', accept: 'image' },
      { name: 'duration', type: 'number', label: '时长（秒）', value: 5, min: 2, max: 12 },
      { name: 'motion', type: 'select', label: '运镜', options: [['pan-right', '右摇'], ['zoom-in', '推近'], ['handheld', '手持'], ['tilt-up', '上摇']], value: 'pan-right' },
    ],
  },
  {
    id: 'video-refer', title: '视频参考', icon: '🎥', group: 'AI 视频', kind: 'video',
    desc: '智能解析运镜与节奏，一键复刻电影级镜头',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '参考视频', accept: 'video', required: true },
      { name: 'prompt', type: 'textarea', label: '新内容描述', ph: '用参考视频的运镜节奏，重新演绎这段内容' },
      { name: 'look', type: 'select', label: '调色', options: [['none', '原色'], ['warm', '暖调'], ['cool', '冷调'], ['teal', '青橙'], ['noir', '黑白']], value: 'teal' },
      { name: 'speed', type: 'number', label: '速度倍率', value: 1, min: 0.5, max: 2, step: 0.1 },
    ],
  },
  {
    id: 'video-upscale', title: '视频超清', icon: '✨', group: 'AI 视频', kind: 'video',
    desc: 'AI 重建高清细节，影视工业级画质重塑',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '待超清视频', accept: 'video', required: true },
      { name: 'scale', type: 'select', label: '放大倍率', options: [['1.5', '1.5×'], ['2', '2×'], ['3', '3×'], ['4', '4×']], value: '2' },
      { name: 'denoise', type: 'select', label: '降噪强度', options: [['light', '轻度'], ['medium', '中度'], ['strong', '强']], value: 'medium' },
      { name: 'detail', type: 'switch', label: '细节锐化', value: true },
    ],
  },
  {
    id: 'video-extend', title: '视频续写', icon: '➡️', group: 'AI 视频', kind: 'video',
    desc: 'AI 延续创作灵感，让故事无限精彩延伸',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '原视频', accept: 'video', required: true },
      { name: 'prompt', type: 'textarea', label: '续写内容', ph: '接下来发生什么？' },
      { name: 'extend', type: 'number', label: '续写时长（秒）', value: 4, min: 2, max: 15 },
      { name: 'motion', type: 'select', label: '运镜', options: [['zoom-in', '推近'], ['pan-right', '右摇'], ['handheld', '手持'], ['tilt-up', '上摇']], value: 'zoom-in' },
    ],
  },
  {
    id: 'video-edit', title: '视频编辑', icon: '🛠️', group: 'AI 视频', kind: 'video',
    desc: '多模态智能编辑，自由修改视频内容',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '源视频', accept: 'video', required: true },
      { name: 'effect', type: 'select', label: '特效', options: [['none', '无'], ['glitch', '故障'], ['vhs', 'VHS 录像带'], ['bloom', '柔光'], ['oldfilm', '老电影'], ['shake', '手持抖动'], ['mirror', '镜像'], ['sketch', '素描'], ['thermal', '热成像'], ['negative', '负片'], ['dream', '梦幻'], ['blocky', '像素块'], ['cold', '冷色'], ['sharpen', '锐化']], value: 'none' },
      { name: 'look', type: 'select', label: '调色', options: [['none', '原色'], ['warm', '暖调'], ['cool', '冷调'], ['noir', '黑白'], ['teal', '青橙'], ['vintage', '复古'], ['punch', '高对比']], value: 'none' },
      { name: 'speed', type: 'number', label: '速度倍率', value: 1, min: 0.25, max: 3, step: 0.05 },
      { name: 'flip', type: 'select', label: '画面翻转', options: [['', '不翻转'], ['h', '水平'], ['v', '垂直'], ['hv', '水平+垂直']], value: '' },
      { name: 'crop', type: 'select', label: '重构图幅', options: [['', '保持原比例'], ['16:9', '16:9 横屏'], ['9:16', '9:16 竖屏'], ['1:1', '1:1 方形'], ['4:3', '4:3'], ['21:9', '21:9 宽银幕']], value: '' },
      { name: 'reverse', type: 'switch', label: '倒放（自动静音）' },
      { name: 'start', type: 'number', label: '起始秒（裁剪）', value: 0, min: 0, step: 0.1 },
      { name: 'end', type: 'number', label: '结束秒（留空=到片尾）', min: 0, step: 0.1 },
      { name: 'text', type: 'text', label: '叠加文字', ph: '可选，底部居中字幕/水印' },
      { name: 'mute', type: 'switch', label: '静音' },
    ],
  },
  {
    id: 'video-effects', title: 'AI 视频特效', icon: '🌠', group: 'AI 视频', kind: 'video',
    desc: '14 种影视级特效预设，一键套用到成片',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '源视频', accept: 'video', required: true },
      { name: 'effect', type: 'select', label: '特效', options: [['glitch', '故障 / Glitch'], ['vhs', 'VHS 录像带'], ['bloom', '辉光 / Bloom'], ['oldfilm', '老旧胶片'], ['shake', '手持抖动'], ['mirror', '镜面倒影'], ['sketch', '素描线稿'], ['thermal', '热成像'], ['negative', '负片'], ['dream', '柔焦梦境'], ['sharpen', '锐化增强'], ['blocky', '像素颗粒'], ['cold', '冷调纪实'], ['none', '原片']], value: 'glitch' },
      { name: 'strength', type: 'select', label: '强度', options: [['light', '轻'], ['normal', '标准'], ['strong', '强']], value: 'normal' },
      { name: 'speed', type: 'number', label: '速度倍率', value: 1, min: 0.5, max: 2, step: 0.1 },
      { name: 'text', type: 'text', label: '叠加片名（可选）', ph: '例如：长夜 第一集' },
    ],
  },
  {
    id: 'subtitle-erase', title: '字幕擦除', icon: '🩹', group: 'AI 视频', kind: 'video',
    desc: '基础 / 强去 OCR / 固定区域三种模式，抹掉原片硬字幕',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '源视频', accept: 'video', required: true },
      { name: 'mode', type: 'select', label: '擦除模式', options: [['basic', '基础模式（底部字幕带）'], ['ocr', '强去 OCR 模式（自动检测字幕行）'], ['fixed', '强去固定区域模式']], value: 'basic' },
      { name: 'eraseMode', type: 'select', label: '填补方式', options: [['patch', '镜像填补（推荐，纹理连贯）'], ['delogo', '边缘插值（窄字幕条）'], ['blur', '高斯模糊（大面积）'], ['fill', '纯色遮挡']], value: 'patch' },
      { name: 'strength', type: 'number', label: '强度（1-4）', value: 3, min: 1, max: 4 },
      { name: 'detect', type: 'detect', label: '字幕区域（%）' },
      { name: 'x', type: 'number', label: '区域 X（%）', value: 4, min: 0, max: 100 },
      { name: 'y', type: 'number', label: '区域 Y（%）', value: 74, min: 0, max: 100 },
      { name: 'w', type: 'number', label: '区域宽（%）', value: 92, min: 5, max: 100 },
      { name: 'h', type: 'number', label: '区域高（%）', value: 20, min: 4, max: 100 },
    ],
  },
  {
    id: 'watermark-remove', title: '水印去除', icon: '💧', group: 'AI 视频', kind: 'video',
    desc: '四角水印一键抹除，插值填补不糊画面',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '源视频', accept: 'video', required: true },
      { name: 'corner', type: 'select', label: '水印位置', options: [['br', '右下角'], ['bl', '左下角'], ['tr', '右上角'], ['tl', '左上角']], value: 'br' },
      { name: 'size', type: 'number', label: '覆盖尺寸（% 画面宽）', value: 18, min: 4, max: 45 },
      { name: 'pad', type: 'number', label: '距边缘留白（%）', value: 2, min: 0, max: 10 },
      { name: 'fill', type: 'select', label: '填补方式', options: [['delogo', '边缘插值（推荐）'], ['blur', '高斯模糊'], ['fill', '纯色遮挡']], value: 'delogo' },
    ],
  },
  {
    id: 'lip-sync', title: '视频对口型', icon: '👄', group: 'AI 视频', kind: 'video',
    desc: '视频对口型一键搞定，唇形贴合超自然',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '人物视频', accept: 'video', required: true },
      { name: 'audioAssetId', type: 'asset', label: '配音音频', accept: 'audio' },
      { name: 'text', type: 'textarea', label: '或直接输入台词（自动合成配音）', ph: '输入台词，本地 TTS 生成语音再对口型' },
      { name: 'voice', type: 'voice', label: '音色' },
    ],
  },
  {
    id: 'text-to-image', title: '文生图', icon: '🖌️', group: 'AI 图片', kind: 'image',
    desc: '直出 2K 影视级画质！文字设计一键直出',
    fields: [
      { name: 'prompt', type: 'textarea', label: '画面描述', required: true, ph: '例如：雪夜宫廷，红灯笼映在青石板上' },
      { name: 'title', type: 'text', label: '画面标题（可选，会写入图）' },
      { name: 'subtitle', type: 'text', label: '副标题（可选）' },
      { name: 'count', type: 'number', label: '生成张数', value: 2, min: 1, max: 6 },
      { name: 'ratio', type: 'select', label: '画幅', options: [['16:9', '16:9 横屏'], ['9:16', '9:16 竖屏'], ['1:1', '1:1 方形'], ['4:3', '4:3']], value: '16:9' },
      { name: 'style', type: 'style' },
      { name: 'palette', type: 'palette' },
      { name: 'scene', type: 'select', label: '场景构成', options: [['auto', '智能'], ['city', '城市'], ['nature', '自然'], ['interior', '室内'], ['abstract', '抽象']], value: 'auto' },
    ],
  },
  {
    id: 'image-to-image', title: '参考生图', icon: '🧬', group: 'AI 图片', kind: 'image',
    desc: '风格、人物、背景、姿势多种类型智能参考',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '参考图', accept: 'image', required: true },
      { name: 'prompt', type: 'textarea', label: '改造描述', ph: '希望变成什么样？' },
      { name: 'preset', type: 'select', label: '风格预设', options: [['anime', '动漫'], ['oil', '油画'], ['ink', '水墨'], ['cyber', '赛博'], ['vintage', '复古'], ['noir', '黑白'], ['dreamy', '梦幻'], ['warm', '暖光'], ['cool', '冷调'], ['pixel', '像素'], ['sketch', '素描'], ['poster', '海报']], value: 'anime' },
      { name: 'count', type: 'number', label: '生成张数', value: 1, min: 1, max: 4 },
    ],
  },
  {
    id: 'brush-repaint', title: '局部重绘', icon: '🩹', group: 'AI 图片', kind: 'image',
    desc: '框选区域重新生成，保留其余画面',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '底图', accept: 'image', required: true },
      { name: 'prompt', type: 'textarea', label: '重绘内容', required: true, ph: '框选区域要变成什么？' },
      { name: 'x', type: 'number', label: '区域 X（%）', value: 20, min: 0, max: 100 },
      { name: 'y', type: 'number', label: '区域 Y（%）', value: 20, min: 0, max: 100 },
      { name: 'w', type: 'number', label: '区域宽（%）', value: 50, min: 5, max: 100 },
      { name: 'h', type: 'number', label: '区域高（%）', value: 50, min: 5, max: 100 },
      { name: 'style', type: 'style' },
    ],
  },
  {
    id: 'text-to-music', title: '文生音乐', icon: '🎵', group: 'AI 音频', kind: 'music',
    desc: '文字情感一键生成，专属 BGM 量身定制',
    fields: [
      { name: 'prompt', type: 'textarea', label: '音乐描述', required: true, ph: '例如：忧郁的钢琴独奏，慢速，雨夜氛围' },
      { name: 'mood', type: 'select', label: '情绪', options: [['auto', '智能识别'], ['epic', '史诗'], ['sad', '忧伤'], ['happy', '欢快'], ['tense', '紧张'], ['calm', '平静'], ['mysterious', '神秘'], ['romantic', '浪漫'], ['action', '动作'], ['horror', '恐怖'], ['dream', '梦幻']], value: 'auto' },
      { name: 'duration', type: 'number', label: '时长（秒）', value: 30, min: 5, max: 180 },
      { name: 'tempo', type: 'number', label: 'BPM（0=自动）', value: 0, min: 0, max: 200 },
    ],
  },
  {
    id: 'text-to-sound', title: '文生音效', icon: '🔊', group: 'AI 音频', kind: 'sfx',
    desc: '生成沉浸式逼真音效',
    fields: [
      { name: 'prompt', type: 'textarea', label: '音效描述', required: true, ph: '例如：雨点打在铁皮屋顶上' },
      { name: 'category', type: 'select', label: '类别', options: [['auto', '智能识别'], ['rain', '雨'], ['wind', '风'], ['thunder', '雷'], ['wave', '海浪'], ['footstep', '脚步'], ['door', '开门'], ['traffic', '车流'], ['fire', '火'], ['boom', '爆炸'], ['heart', '心跳'], ['ambient', '环境底噪']], value: 'auto' },
      { name: 'duration', type: 'number', label: '时长（秒）', value: 4, min: 1, max: 30 },
    ],
  },
  {
    id: 'text-to-speech', title: '文生语音', icon: '🗣️', group: 'AI 音频', kind: 'speech',
    desc: '多风格逼真配音，让文字开口说话',
    fields: [
      { name: 'text', type: 'textarea', label: '台词 / 文案', required: true, ph: '粘贴要配音的文字' },
      { name: 'voice', type: 'voice', label: '音色' },
      { name: 'rate', type: 'number', label: '语速（-10 ~ 10）', value: 0, min: -10, max: 10 },
    ],
  },
  {
    id: 'auto-bgm', title: '视频配乐', icon: '🎼', group: 'AI 音频', kind: 'video',
    desc: '智能分析画面情绪，精准生成氛围音乐',
    fields: [
      { name: 'sourceAssetId', type: 'asset', label: '视频', accept: 'video', required: true },
      { name: 'mood', type: 'select', label: '情绪倾向', options: [['auto', '按画面自动'], ['epic', '史诗'], ['sad', '忧伤'], ['happy', '欢快'], ['tense', '紧张'], ['calm', '平静'], ['romantic', '浪漫'], ['dream', '梦幻']], value: 'auto' },
      { name: 'volume', type: 'number', label: '音乐音量（0.1~1）', value: 0.6, min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    id: 'agent-to-video', title: '灵感成片', icon: '🤖', group: 'AI 视频', kind: 'agent',
    desc: 'Agent 智能规划，从创意到完整短片',
    fields: [
      { name: 'idea', type: 'textarea', label: '一句话创意', required: true, ph: '例如：一个外卖员在暴雨夜送出最后一单，发现收件人是十年前的自己' },
      { name: 'title', type: 'text', label: '片名（可选）' },
      { name: 'shots', type: 'number', label: '镜头数', value: 4, min: 2, max: 8 },
      { name: 'duration', type: 'number', label: '单镜时长（秒）', value: 4, min: 2, max: 10 },
      { name: 'style', type: 'style' },
      { name: 'voiceover', type: 'switch', label: '生成旁白配音', value: true },
      { name: 'bgm', type: 'switch', label: '生成背景音乐', value: true },
    ],
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const GROUPS = ['AI 视频', 'AI 图片', 'AI 音频'];

export const STYLES = [
  ['cinematic', '电影感'], ['anime', '动漫'], ['ink', '水墨'], ['cyber', '赛博朋克'],
  ['warm', '暖调'], ['noir', '黑色电影'], ['retro', '复古'], ['clean', '干净商业'],
  ['horror', '惊悚'], ['romance', '浪漫'],
];
export const PALETTES = [
  '午夜蓝', '赛博紫', '幽绿', '暗红', '灰阶', '钢青', '暖褐', '深海', '晨曦', '雪原', '夜火', '薄雾',
];
export const RATIOS = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [960, 960],
  '4:3': [1024, 768],
};
export function sizeOf(ratio) { return RATIOS[ratio] || RATIOS['16:9']; }