import { api, esc } from '../lib.js';

export async function render() {
  const d = await api('/api/tutorial');
  const list = d.list || [];
  return [
    '<div class="page-head">',
    '  <div><h1>使用教程</h1><p>从 5 分钟上手到小说改编成片的完整路径</p></div>',
    '</div>',
    '<div class="grid g2">' + list.map((g, i) => [
      '<div class="card">',
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">',
      '<span class="chip">' + (i + 1) + '</span><h3 style="margin:0">' + esc(g.title) + '</h3></div>',
      '<ol style="margin:0;padding-left:20px;color:var(--muted);font-size:12.8px;line-height:1.9">',
      (g.steps || []).map((s) => '<li>' + esc(s) + '</li>').join(''),
      '</ol></div>',
    ].join('')).join('') + '</div>',
    '<div class="section-title">进阶链路</div>',
    '<div class="grid g3">',
    [['/script', '剧本创作', '一句话故事 → 分集剧本 → 剧集项目'],
     ['/novel', '小说改编', '导入原文 → 人物与分集 → 改编为剧本'],
     ['/projects', '剧集项目', '批量生成分镜图与分镜视频'],
     ['/canvas', '自由画布', '节点式自由创作，可分享'],
     ['/workflow', '工作流', '把多个节点串成一条流水线'],
     ['/director', '3D 导演台', '摆机位与演员，一键出图'],
     ['/translate', '视频翻译', '换语言配音与字幕'],
     ['/redraw', '视频重绘', '整段素材换风格'],
     ['/ad-drama', '广告短剧', '卖点文案 → 分镜 → 成片']]
      .map((x) => '<a class="card hover" href="#' + x[0] + '" style="text-decoration:none"><h3>' + x[1] + '</h3><p>' + x[2] + '</p></a>').join(''),
    '</div>',
    '<div class="section-title">本地引擎说明</div>',
    '<div class="card"><p style="line-height:1.9">图像由本地光栅引擎程序化绘制（不依赖外部模型）；视频用 ffmpeg 做运镜、转场与合成；配音走 Windows SAPI，音乐与音效用合成器实时渲染。全站不联网、无额度限制、无订阅与支付入口。</p></div>',
  ].join('');
}
