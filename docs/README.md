# 剧作工坊 · ReelMate Studio（本地版）

reelmate.cn（万兴剧厂）全部创作能力的**本地自建实现**：零第三方依赖、不联网、无额度、无订阅、无支付入口。
所有画面、音乐、配音、视频全部由本机引擎程序化生成（Node 光栅引擎 + ffmpeg + Windows SAPI）。

---

## 1. 快速开始

```bash
cd D:\DSHpj\Rea\reelmate\studio
npm start          # 等价于 node server/index.mjs
```

浏览器打开 <http://127.0.0.1:8848/> 。

| 项 | 值 |
| --- | --- |
| 端口 | `8848`（`PORT` 环境变量可改） |
| 依赖 | Node ≥ 20、ffmpeg（需在 PATH） |
| 数据 | `data/db.json`（原子写 + 30ms 防抖） |
| 媒体 | `data/media/{image,video,audio,upload}` |
| 付费 | `unlimited: true`，额度只做可视化，不阻塞任何操作 |

首次启动会自动建库、播种演示数据（项目 / 小说 / 画布 / 工作流 / 导演台场景）。

---

## 2. 目录结构

```
studio/
├── server/
│   ├── index.mjs         HTTP 服务、静态资源、SPA 回退
│   ├── db.mjs            JSON 存储（原子写 + 防抖）
│   ├── route.mjs         极简路由（含 :param）
│   ├── queue.mjs         任务队列（进度 / 取消 / 并发 2）
│   ├── util.mjs          响应封装、ID、时间
│   └── routes/
│       ├── tools.mjs     19 个 AI 工具 + 设置/模型/额度/任务
│       ├── assets.mjs    资产库与文件夹
│       ├── content.mjs   项目/剧集/分镜/剧本/小说/市场
│       ├── canvas.mjs    画布/工作流/导演台/影视/广告/翻译/重绘
│       ├── post.mjs      图片后期 14 项能力（裁剪/扩图/宫格/多角度/全景/切图…）
│       ├── editor.mjs    时间线剪辑台（多轨工程、素材池、导出）
│       ├── vpost.mjs     视频后期 6 项（冻帧/截帧/音频分离/深度/拉片/重拍）
│       ├── sheet.mjs     素材表（审阅状态 / 责任人 / 批量打包下载 ZIP）
│       ├── ingest.mjs    剧本与分镜单导入 + AI 智能提取资产
│       ├── works.mjs     创作者中心（三步发布 / 作品库 / 合同 / 收益与提现）
│       ├── film.mjs      影视项目（任务表 / 资产库 / 成员 / 制作空间 / 导出）
│       ├── taskboard.mjs 任务表格视图（字段管理 / 保存视图 / 模板库 / 子任务 / 审核 / 导出）
│       ├── team.mjs      团队/成员/分组/权限/邀请/积分
│       └── extra.mjs     知识库/提示词/合作/活动/教程
├── engine/
│   ├── raster.mjs        画布、绘图基元、噪声、渐变、字体栅格化
│   ├── image.mjs         场景合成（天空/城市/人物/光效/标题）
│   ├── audio.mjs         合成器（音乐/音效）+ SAPI 语音
│   ├── video.mjs         分镜渲染、运镜、转场、拼接
│   ├── effects.mjs       14 种视频特效 + 12 种图像风格 + 超分/续写/对口型
│   ├── erase.mjs         字幕带检测 + 三模式擦除 + 水印去除
│   ├── post.mjs          图片后期引擎（解码/裁剪/外扩/宫格/多视角/全景/线稿/调色/打光/表情）
│   ├── stage.mjs         3D 导演台（透视投影 + 人体简笔 + HUD）
│   ├── timeline.mjs      时间线渲染（裁切/变速/黑场填充/多轨混音）
│   ├── nodes.mjs         表格渲染 + 3D 世界全景（画布节点专用）
│   ├── vpost.mjs         视频后期引擎（冻帧/联系表/音频分离/深度/拉片/片段重拍）
│   ├── office.mjs        零依赖读取 docx / xlsx / csv / txt / md
│   ├── zip.mjs           零依赖 ZIP 打包（素材批量下载）
│   ├── llm.mjs           本地文本生成（剧本/大纲/分集/文案）
│   └── ffmpeg.mjs        ffmpeg 调用与探测
└── web/
    ├── index.html
    └── src/
        ├── app.js         路由表与外壳
        ├── lib.js         请求、弹窗、抽屉、Toast、轮询
        ├── tools-spec.js  19 个工具的表单定义（单一事实源）
        ├── styles.css
        ├── components/
        │   └── review.js   结果审核抽屉（素材预览 / 批注 / 提交通过驳回 / 进入画布）
        └── pages/         32 个页面模块（含 works / film / tasks 表格视图 / import / sheet / vpost）
```

---

## 3. 功能对照表（reelmate.cn → 本项目）

### 3.1 工具箱（19 个：官方 17 张工具卡 + 字幕擦除 + 水印去除）

| # | 官方工具 | 本项目路由 | 实现要点 |
| --- | --- | --- | --- |
| 1 | 文生视频 | `#/tools/text-to-video` | 场景合成 → 分镜渲染 → 拼接过场 → 自动配乐 |
| 2 | 图生视频 | `#/tools/image-to-video` | 图片 + 运镜（推/拉/摇/移/环绕/手持） |
| 3 | 参考生视频 | `#/tools/reference-to-video` | 1–4 张参考图各出一镜，再拼接 |
| 4 | Agent 灵感成片 | `#/agent` | 一句话 → 大纲 → 分镜 → 成片 |
| 5 | 视频超清 | `#/tools/video-upscale` | lanczos 放大 + 轻度锐化 + 降噪 |
| 6 | 视频续写 | `#/tools/video-extend` | 取尾帧生成延伸镜头并接回 |
| 7 | 视频编辑 | `#/tools/video-edit` | 裁剪/变速/翻转/旋转/画幅/字幕/静音 |
| 8 | 视频参考 | `#/tools/video-refer` | 解析参考片运镜并复刻到新画面 |
| 9 | 视频对口型 | `#/tools/lip-sync` | 音频驱动口型 + 波形可视化 |
| 10 | 文生图 | `#/tools/text-to-image` | 1–8 张，风格/尺寸/标题/副标题 |
| 11 | 参考生图 | `#/tools/image-to-image` | 12 种风格预设，1–4 张 |
| 12 | 文生音乐 | `#/tools/text-to-music` | 合成器出旋律 + 和弦 + 鼓组 |
| 13 | 文生音效 | `#/tools/text-to-sound` | 噪声整形 / 扫频 / 冲击音 |
| 14 | 文生语音 | `#/tools/text-to-speech` | Windows SAPI 多音色 + 语速 |
| 15 | 视频配乐 | `#/tools/auto-bgm` | 按片长自动铺乐 + 淡入淡出 |
| 16 | 局部重绘 | `#/tools/brush-repaint` | 百分比框选 + 羽化蒙版合成 |
| 17 | AI 视频特效 | `#/tools/video-effects` | 14 种预设（故障/VHS/辉光/胶片/抖动/镜像…） |
| 18 | 字幕擦除 | `#/tools/subtitle-erase` | 基础 / 强去 OCR（自动检测字幕行）/ 固定区域；镜像填补·边缘插值·模糊·纯色 |
| 19 | 水印去除 | `#/tools/watermark-remove` | 四角定位 + 尺寸/留白可调 + 三种填补 |

### 3.2 平台功能

| 官方 | 本项目 | 说明 |
| --- | --- | --- |
| /home 工作台 | `#/` | 概览、最近素材、快捷入口 |
| /assets 资产库 | `#/assets` | 图片/视频/音频；四类分类（角色/场景/道具/IP 模板）、3 级文件夹、多选批量（设分类/导入项目/存团队库/移动/删除）、子图与历史版本 |
| /script-manage、/script-view | `#/script` | 一句话 → 分集剧本 → 一键转剧集项目 |
| /novel-market、/novel-to-script | `#/novel`、`#/market` | 小说导入、章节分析、人物抽取、大纲、转剧本 |
| /series-manage、/episode-list | `#/projects`、`#/projects/:id` | 项目按类型分 tab（短剧/工作流/画布/重绘/翻译/广告）；分镜横向时间线或竖向九宫格；批量生成分镜图与视频；AI 智能提取资产 |
| 上传剧本 / 分镜单 | `#/import` | xls/xlsx/csv/doc/docx/txt/md 解析 → 预览 → 一键建项目与分镜（详见 3.8） |
| 素材表 material_table | `#/sheet` | 责任人、审阅状态、备注、批量指定/改状态/保存主体/打包 ZIP 下载（详见 3.7） |
| /canvas-projects | `#/canvas` | 节点画布（12 种节点：文本/分镜/图片/视频/音频/合成/资产/分组/3D导演台/3D世界/表格/上传），单独执行、可分享 |
| /agent/editor 时间线 | `#/editor` | 多轨剪辑台：素材池 → V2/V1/A1/A2 轨道 → 拖放/入出点/变速/音量/分割 → 导出成片 |
| /workflow-canvas | `#/workflow` | 多节点串成流水线，一键跑完整条链，结果回写节点 |
| 3D 导演台 | `#/director` | 机位/焦距/演员走位 → 透视出图 |
| /video-translate | `#/translate` | 换语言配音 + 字幕烧录 |
| /video-redraw | `#/redraw` | 整段素材换风格重绘 |
| /ad-drama | `#/ad-drama` | 卖点文案 → 多镜头广告成片 |
| /creator-center | `#/works` | 作品发布、点赞、数据总览 |
| /partner-center | `#/partner` | 可接工单、接单记录 |
| /activities | `#/activities` | 长期活动、报名 |
| /team、/team/dashboard、/project-members | `#/team` | 成员、分组与权限矩阵、统计（创作消耗/项目参与/资产成本/成员参与）、团队角色·场景·道具库、积分流水、排行、邀请 |
| /task | `#/tasks` | 全部任务、进度、取消、结果下载 |
| /user_knowledge | `#/knowledge` | 世界观/设定/素材知识条目 |
| 提示词库 | `#/prompts` | 提示词增删、一键套用 |
| /tutorial | `#/tutorial` | 上手路径 |
| /setting | `#/settings` | 存储、字体、音色、并发 |
| /drama-workflow | `#/drama` | 短剧工作流：六步链路看板 + 按项目统计集数/分镜/出图/成片进度 |
| /mcp-cli | `#/mcp` | MCP 服务配置、CLI 命令速查、全量接口清单（可搜索分组） |
| /user-center、/profile、/user-settings | `#/account` | 账号中心：资料、存储与额度流水、引擎参数、关于 |
| /pricing（付费） | — | **已移除**，全站无额度限制 |

### 3.3 图片后期（官方 `imagePost.*` 14 项 → `#/post`）

| # | 官方能力 | 本项目接口 | 参数 | 实现要点 |
| --- | --- | --- | --- | --- |
| 1 | crop 裁剪 | `POST /api/post/crop` | `ratio` `zoom` `focus` | 9 种画幅 + 1–4× 缩放 + 5 个取景焦点 |
| 2 | outpaint 扩图 | `POST /api/post/outpaint` | `pad` 5–100% `blend` | 镜像采样铺满外区 → 分离式滑动均值模糊 → 羽化接缝 |
| 3 | splitGrid 宫格切分 | `POST /api/post/grid-split` | `count` 4/9/16/25 或 `cols`×`rows`，`indices` 选格 | 按 1-based 序号挑格，最多 40 张 |
| 4 | multiAngle 多角度 | `POST /api/post/multi-angle` | `views`（9 视角/all/front3/side/back3/top）`azimuth` `elevation` `distance` | 圆柱投影 + tan 映射 |
| 5 | panorama / 720°全景 | `POST /api/post/panorama` | `turns` 1–2 `elevation` | 等距全景输出，宽 = 原宽 × turns |
| 6 | storyGrid 剧情推演 | `POST /api/post/story-grid` | `prompt` `cols` `rows` `style` | 逐格生图再拼贴 + 细分隔线，无需源素材 |
| 7 | frameLineArt 抽帧转线稿 | `POST /api/post/line-art` | `at`（last 或秒数）`mode` | edgedetect + negate + 对比增强 |
| 8 | palette 调色板 | `POST /api/post/palette` | — | 0xF0 分桶取 8 主色，去重后出色卡条 |
| 9 | annotate 标注 | `POST /api/post/annotate` | `boxes` `arrow` `title` `color` | 百分比坐标框选，文字走 ffmpeg drawtext（中文可读） |
| 10 | lighting 打光 | `POST /api/post/relight` | `mode`（6 种）`strength` `from` | 亮度→双色 tint 映射 + 暗角 + 轮廓光 Sobel |
| 11 | fps_duration_unify 统一 | `POST /api/post/unify-video` | `width` `height` `fps` `seconds` | 缩放+补边+fps+补时，有音轨自动 apad/atrim |
| 12 | eraserPen 消除笔 | `POST /api/post/eraser` | `regions` 百分比框 | 边界向内均值扩散（最多 90 轮） |
| 13 | fourView / twelveView | `POST /api/post/view-grid` | `count` 4 或 12 | 4 视图或 12 视图拼成联系表 |
| 14 | ultraClear 超清 | `POST /api/post/image-upscale` | `scale` 1.2–4 `sharpen` | lanczos + unsharp |

### 3.4 时间线剪辑台（官方 `/agent/editor` → `#/editor`）

| 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- |
| 新建 / 打开工程 | `GET·POST /api/editor`、`GET /api/editor/:id` | 工程存 `db.editors`：宽高、fps、轨道、片段、导出历史 |
| 左侧素材池 | `GET /api/editor/materials` | 聚合分镜视频/分镜图 + 资产库音视频，按集分组；点一下即追加到时间线 |
| 多轨（官方 trackLimit） | 固定 V2 / V1 / A1 / A2 | 视频轨 2 条、音频轨 2 条 |
| trim_restrictions 拖选时长 | `clips[].in` / `out` | 右侧属性面板精确到 0.1 秒 |
| split 分割 | 播放头位置切两段 | 左段保留 `in→cut`，右段 `cut→out` |
| speedChange 变速 | `clips[].speed` 0.25–4 | 视频 `setpts`，音频自动串联 `atempo`（>2 或 <0.5 分级） |
| volume 音量 | `clips[].volume` 0–2 | 每段独立音量，混音时 `amix` |
| export 导出 | `POST /api/editor/:id/export` | 逐段裁切 → 黑场补缝 → concat → 多轨混音（`apad` 保时长）→ 入资产库 |
| export_task_history | `editors[].exports`（最多 20 条） | 每次导出留档，可回看 |

### 3.5 画布节点（官方 `canvas.nodeMenu` 12 种 → `#/canvas`）

| # | 官方节点 | 本项目 | 执行行为 |
| --- | --- | --- | --- |
| 1 | text 文本 | `type: 'text'` | 作为提示词源，供下游读取 |
| 2 | script 分镜 | `type: 'script'` | 场景 + 景别 + 台词 → 生成分镜板（带标题/台词/景别标） |
| 3 | image 图片 | `type: 'image'` | 提示词 + 风格 → 出图 |
| 4 | video 视频 | `type: 'video'` | 出图后加运镜渲染成镜头 |
| 5 | audio 音频 | `type: 'audio'` | 提示词 → 合成音乐 |
| 6 | clip 视频合成 | `type: 'clip'` | 取上游全部视频/图片，图片先转 3 秒镜头，再按转场拼接 |
| 7 | asset 资产 | `type: 'asset'` | 从资产库挑一个素材直接引用（图片/视频/音频均可） |
| 8 | group 分组 | `type: 'group'` | 纯视觉分组框，可改名改色，不参与执行 |
| 9 | director 3D导演台 | `type: 'director'` | 引用一个导演台工程渲染当前机位；未选工程则用节点内置默认场景 |
| 10 | threeDWorld 3D世界 | `type: 'threeDWorld'` | 全景图（或提示词生成底图）→ 360°/720° 圆柱投影全景 |
| 11 | table 表格 | `type: 'table'` | 自定义表格文本（`|`/Tab/逗号分列）→ 出分镜单图，标题占顶部色带 |
| 12 | upload 上传 | `type: 'upload'` | 侧栏选本地文件上传成资产，节点直接引用，执行即透传 |

### 3.6 视频后期（官方 `canvas.videoPost` 6 项 → `#/vpost`）

| # | 官方能力 | 本项目接口 | 参数 | 实现要点 |
| --- | --- | --- | --- | --- |
| 1 | freezeFrameExtend 冻帧延长 | `POST /api/vpost/freeze-extend` | `seconds` 0.5–15 `at` | `tpad stop_mode=clone` 定格；有音轨 `apad` 补静音 |
| 2 | toolCapture 截帧 | `POST /api/vpost/frame-capture` | `count` 1–12 `at` | 单帧导出；多帧按 (i+0.5)/count 均匀取帧，`xstack` 拼联系表 |
| 3 | audioSeparate 音频提取 | `POST /api/vpost/audio-separate` | `mode` track/vocal/bgm/none | 人声/背景声用双声道 `pan` 加减分离；none 出无声 mp4 |
| 4 | depthCapture 深度动捕 | `POST /api/vpost/depth-capture` | `at` `color` | 灰度 + 大半径模糊 + 对比增强；`pseudocolor turbo` 出伪彩 |
| 5 | videoParse 视频拉片 | `POST /api/vpost/video-parse` | — | `select gt(scene,0.32)` 检测切点 → 逐段估景别 → 联系表 + 拉片表 |
| 6 | localRepaint 片段重拍 | `POST /api/vpost/local-repaint` | `start` `end` `prompt` `motion` | 前后段原片保留，中段重新生成，concat 拼回 |

### 3.7 素材表（官方 `material_table` → `#/sheet`）

官方素材表把资产当「可审阅的拍摄清单」用，本项目逐列对齐：

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | role / setting / implement 三列 | `GET /api/sheet` | 按 `cat` 取 `meta.role` / `meta.setting` / `meta.implement`，没填则回落素材名 |
| 2 | remark 备注 | `POST /api/sheet/:id` | 行内直接编辑，失焦即存 |
| 3 | assignee 责任人 | `POST /api/sheet/:id`、`/batch {action:'assignee'}` | 单行下拉选人；批量指定同名 |
| 4 | review_status 审阅状态 | `/batch {action:'review',review}` | `not_reviewed` 未审阅 / `pass` 通过 / `fail` 不通过 |
| 5 | batch_save_subject 批量保存主体 | `/batch {action:'subject'}` | 按分类把素材名写回 `meta.role|setting|implement` 并打 `subject` 标；全已保存时回官方同义文案 |
| 6 | batch_delete 批量删除 | `/batch {action:'delete'}` | 连磁盘文件一起清 |
| 7 | batch_download 批量下载 | `POST /api/sheet/download` | 零依赖 ZIP 打包（`engine/zip.mjs`），中文名 UTF-8 标志位，>400MB 拒绝 |
| 8 | 统计（未审阅/通过/不通过） | `GET /api/sheet/stats` | 顶部 6 张 KPI 卡 |

### 3.8 剧本导入与 AI 提取资产（官方 `series_manage.workflow_project.*` + `overview.auto_extract` → `#/import`）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | upload_title 上传剧本 | `POST /api/ingest/upload` | 支持 `.txt .md .docx .doc .csv .tsv`；`.docx/.xlsx` 用 `engine/office.mjs` 零依赖解压解析 |
| 2 | tab_storyboard 上传分镜单 | 同上 | 表头含「镜号 / 景别 / 画面描述 / 台词」即按列建分镜（≤400 条） |
| 3 | tab_paste 粘贴文本 | `POST /api/ingest/create` | 按「第 N 集」切集、空行切场，`内景/外景 · X` 取场景名，`名字：台词` 拆对白 |
| 4 | tab_library 从剧本库选择 | `GET /api/scripts` | 库里挑一部直接带进导入页 |
| 5 | create_now 立即创作 | `POST /api/ingest/create` | 一次建好项目 + 剧集 + 场景/分镜，跳到项目详情 |
| 6 | auto_extract AI 智能提取资产 | `GET /api/projects/:id/extract/preview`、`POST /api/projects/:id/extract` | 从剧本/分镜里拆角色·场景·道具 → 逐项出参考图（角色 768×1024，场景/道具 1024×576）→ 写入资产库并打分类标 |

### 3.9 创作者中心（官方 `creatorCenter.json` → `#/works`）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | stepImport 导入剧本 | `POST /api/works/parse` | 只收 `.docx/.txt/.doc`、≤10M；解析标题 / 分类 / 创作类型 / 简介 / 集数 / 角色 / 大纲 / 世界观 / 正文分块；另有 `GET /api/works/template` 下载空白模版 |
| 2 | stepConfirm 确认剧本信息 | 前端第二步 | 大纲 / 世界观 / 人物小传 / 分集正文都可直接改，分集编号重复会拦下 |
| 3 | stepConfig 信息配置 | `POST /api/works`、`POST /api/works/:id` | 分类 / 创作类型 / 封面 / 试读集数 / 定价（100–50000，100 元整数倍）/ 折扣 / 版权认证附件 |
| 4 | 作品库与状态 | `GET /api/works`、`POST /api/works/:id/status` | 7 种状态（草稿 / 审核中 / 已上架 / 已售出 / 已下架 / 驳回 / 全部），按状态 / 分类 / 关键词筛选 |
| 5 | downloadContract 下载合同 | `POST /api/works/:id/contract` | 本地生成《剧本著作财产权转让协议》txt（含价款、平台服务费 10%、预估到手价） |
| 6 | earningsPage 收益管理 | `GET /api/creator/earnings`、`POST /api/creator/withdraw` | 累计 / 本月 / 待结算 / 可提现 + 收益明细与提现明细；售出作品自动记一笔待结算 |

### 3.10 影视项目（官方 `film.json` → `#/film`、`#/film/:id`）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | 项目列表与封面 | `GET/POST /api/film`、`POST /api/film/:id/cover` | 电影 / 剧集 / 短片 / 纪录片四类，封面图上传，空态「好故事一定有市场！」 |
| 2 | 三 tab：项目 / 资产库 / 团队 | `GET /api/film/:id` | 资产库支持文件夹（最多 3 级）、从全局资产库导入、本地上传 |
| 3 | 任务表 | `POST /api/film/:id/tasks`、`POST /api/film/:id/task/:tid` | 7 个字段（任务名 / 镜号 / 内容 / 负责人 / 状态 / 截止 / 备注），状态 待开始·进行中·待审核·已完成·已驳回 |
| 4 | importExcel 导入任务 | `POST /api/film/:id/tasks/import` | 仅 `.xlsx`、≤100M、最多 1000 行；表头按「任务名称 / 镜号 / 描述 / 负责人 / 状态 / 截止 / 备注」定位 |
| 5 | 导出 | `POST /api/film/:id/export` | `result` 打包所有已完成任务为 ZIP；`table` 导出任务表 TSV；都记进导出记录 |
| 6 | produce 制作空间 | `POST /api/film/:id/produce` | 新建无限画布并挂到项目下，点进去直达 `#/canvas` |
| 7 | 统计 | `GET /api/film/:id/stats` | 任务完成率、按状态 / 按人 / 按类型分布、资产与成员计数 |

### 3.11 画布协同与任务绑定（官方 `canvas.collab.*` + `canvas.*` 任务族 → `#/canvas`）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | 协作者与在线状态 | `POST /api/canvas/:id/collab`、`POST /api/canvas/:id/presence` | 开关协同、最多 20 位协作者；点「协同」按心跳（60 秒内）算「在线 N 人：…」 |
| 2 | 节点锁 | `POST /api/canvas/:id/lock` | 锁定选中节点，别人改会提示「节点已被 X 锁定」；可解锁 |
| 3 | bindTask 关联任务 | `GET /api/canvas/:id/tasks`、`POST /api/canvas/:id/task` | 下拉列出全部影视任务，绑定后画布顶栏显示「当前绑定：项目 · 任务」 |
| 4 | submit 提交结果版本 | `POST /api/canvas/:id/submit` | 每次提交记一个版本（产出节点快照），并回写绑定的影视任务，提交记录可查 |
|
### 3.12 剧本拆分镜三步（官方 `home.tutorial` step4–6 → 项目详情「AI 拆分镜」）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | 剧本拆分镜 | `GET /api/episodes/:id/split/preview`、`POST /api/episodes/:id/split` | 按场景动作句切镜，自动配景别（全景/中景/近景/特写）与运镜（推近/拉远/横向摇移/跟随/固定），预览确认后写入分镜 |
| 2 | 匹配本集资产 | `GET/POST /api/episodes/:id/cast` | 列出本集角色 / 场景 / 道具，标出「本集出现 / 未提及」，勾选后确认出镜主体 |
| 3 | 拆解分镜脚本 | `POST /api/episodes/:id/breakdown` | 为每条分镜生成提示词（含场景、主体、景别、运镜），并回写 `prompt` |

### 3.13 任务表格视图与表情控制（官方 `task.json` + `canvas.expressionControl`）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | 表格视图 / 字段管理 | `GET /api/taskboard/meta`、`POST /api/taskboard/fields` | 9 个内置列（任务名/类型/状态/进度/审核/额度/耗时/创建时间/当前步骤）+ 最多 12 个自定义字段 |
| 2 | 保存视图 | `POST /api/taskboard/views` | 存筛选与列；重名覆盖；切视图后筛选状态跟着恢复 |
| 3 | 筛选 / 排序 / 搜索 | `GET /api/taskboard` | 状态、类型、审核、关键词、起止时间；点表头按创建时间/耗时/名称/状态/进度排序 |
| 4 | 子任务 | `POST /api/taskboard/:id/subtasks` | 每条任务最多 20 条子任务，可勾完成 / 删除 |
| 5 | 审核 | `POST /api/taskboard/:id/review` | 通过 / 驳回并记备注，表头显示审核列 |
| 6 | 导出与模板 | `GET /api/taskboard/export`、`GET /api/taskboard/template` | 导出当前筛选为 CSV（带 BOM，Excel 直接开）；模板表 TSV 下载 |
| 7 | expressionControl 表情控制 | `POST /api/post/expression` | 图片后期第 15 项：框选人脸后调自然/微笑/大笑/惊讶/愤怒/悲伤/冷峻，强度 0.2–2，纯像素网格变形 |

### 3.14 任务模板库与画布演示跟随（官方 `film.tasks.templates.*` + `canvas.collab` 演示/跟随）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | tabOfficial 官方模板 | `GET /api/taskboard/templates` | 内置 4 套：本周进行中 / 待审核交付 / 失败排查 / 全字段总览，各带筛选与列配置 |
| 2 | tabTeam 团队模板 | `POST /api/taskboard/templates` | 保存当前视图（筛选 + 显示字段）为团队模板；名称 ≤50 字、最多 30 个、同名覆盖 |
| 3 | applyContent 使用模板 | `POST /api/taskboard/templates`（应用在前端） | 应用后覆盖当前视图的原有内容（筛选条件与显示字段），与官方提示文案一致 |
| 4 | 删除团队模板 | `POST /api/taskboard/templates/:id/delete` | 弹窗内 × 直接删，删除后列表即时刷新 |
| 5 | 演示 | `POST /api/canvas/:id/presence` 带 `demo` | 协同弹窗「开始演示 / 停止演示」，演示中他人列表显示「演示中」徽标 |
| 6 | 跟随 | `POST /api/canvas/:id/presence` 带 `follow` + `nodeId` | 每 2 秒心跳上报选中节点；跟随者视口平滑滚到对方节点并高亮 1.5 秒，按钮切「退出跟随」 |
### 3.15 结果审核流（官方 `film.json tasks.review.*` → 影视项目「审核」/ 任务中心「审核」）

| # | 官方能力 | 本项目接口 | 说明 |
| --- | --- | --- | --- |
| 1 | 打开审核（cells.openReview） | `GET /api/film/:id/task/:tid/review` | 抽屉里给出任务信息、版本、结果素材、历史批注、可关联画布 |
| 2 | 结果素材与预览 | 同上 `files[]` | 图片可「点击查看原图」「全屏」；视频带播放/暂停、静音/取消静音、全屏；音频带原生控件；空态「当前任务暂未提交结果素材」 |
| 3 | 上传结果素材 | `POST /api/film/:id/task/:tid/file` | multipart 多文件，存 `data/media/film/<filmId>/result/`，可逐条删除 |
| 4 | 历史批注 / 新增批注（commentsEditor / send） | 同上、`POST /api/film/:id/task/:tid/comment` | 默认显示 4 条，>4 出现「查看更多」；「展开 / 收起」切列表高度；单条 ≤500 字 |
| 5 | 提交审核（status.pendingReview） | `POST /api/film/:id/task/:tid/review` `{action:"submit"}` | 无素材时报「当前任务暂未提交结果素材」；提交后版本 +1、任务状态转「待审核」 |
| 6 | 通过 / 驳回 | 同上 `{action:"pass"}` / `{action:"fail", note}` | 通过 → 任务「已完成」，驳回 → 「已驳回」并记原因（≤300 字） |
| 7 | 进入画布（canvas.enter） | `POST /api/film/:id/task/:tid/canvas` | 任务可绑定本项目画布；审核抽屉「进入画布」跳 `#/canvas` 并自动打开该画布 |
| 8 | 任务中心同款审核（task.json） | `POST /api/taskboard/:id/comment`、`POST /api/taskboard/:id/review` | 任务表格每行「审核」打开同一抽屉；结果素材从任务 result 里自动收集；提交 → 待审核、通过/驳回写审核列 |

---

## 4. 使用路径（推荐）

1. **灵感到成片**：`#/agent` 输入一句话 → 等任务完成 → 结果进资产库。
2. **小说改编**：`#/novel` 新建并粘贴原文 → 「分析」抽人物与章节 → 「大纲」→「改编为剧本」→ 「转剧集项目」。
3. **剧集分镜**：`#/projects/:id` 里逐集加镜头 → 「批量生成分镜图」→「批量生成分镜视频」。
4. **流水线**：`#/workflow` 拖节点连线 → 点「运行」→ 每个节点出图并回写。
5. **导演台**：`#/director` 调机位与演员 →「拍摄」出图。
6. **后期**：`#/translate` 换语种、`#/redraw` 换风格、工具页做超清/续写/特效/配乐。
7. **去字幕 / 去水印**：`#/tools/subtitle-erase` 选视频 → 基础模式直接生成；或点「自动检测字幕区域」让引擎抽帧找字幕带再擦；`#/tools/watermark-remove` 选角落 + 尺寸即可。填补默认用**镜像填补**（取区域上方等高带翻转贴回），背景连贯无糊块。
8. **剪辑台**：`#/editor` 新建工程 → 左侧素材池点一下追加片段（自动接在该轨末尾）→ 右侧改入出点/变速/音量 → 点轨道空白定位播放头后「在播放头分割」→ 右上「导出成片」。导出成片自动进资产库，并记录到该工程的导出历史。
9. **图片后期**：`#/post` 左栏选能力 → 选源素材（剧情推演不用素材）→ 填参数 → 生成；右栏出多图网格，点任意结果即设为主预览。宫格切分填 `1,6,11` 这类序号挑格；多角度选「全部 9 视角 / 前三视角 / 侧面 / 背面 / 俯视」；标注每行写 `x,y,w,h,标签`（百分比）。
10. **视频后期**：`#/vpost` 选能力 → 选源视频 → 生成。**视频拉片**会额外出一张镜号/时间/时长/景别表（右栏底部）；**片段重拍**填起止秒 + 画面描述 + 运镜，前后保留原片只换中段。
11. **短剧工作流**：`#/drama` 看六步链路，按项目看集数/分镜/已出图/已成片与完成度，点「进入」直达项目详情。
12. **接进自己的工具链**：`#/mcp` 复制 MCP 客户端配置，或用「CLI 用法」里的 curl 直接调接口；「接口清单」页可搜索全部接口。
13. **账号与引擎**：`#/account` 改昵称邮箱、看存储位置与额度流水、调默认宽高/帧率/并发；需要接外部文本模型时在「引擎参数」里填 Base URL。
14. **导入剧本 / 分镜单**：`#/import` 上传 `docx/xlsx/csv/txt/md` 或粘贴正文 → 预览解析结果（字数/行数/预计集数/是否像剧本）→ 填项目名 → 「立即创作」一次建好项目、剧集与场景（分镜单则直接建分镜）。项目详情右上「AI 智能提取资产」会从剧本里拆出角色/场景/道具并逐张出参考图。
15. **素材表**：`#/sheet` 给素材派责任人、改审阅状态、写备注；勾多行可批量指定负责人 / 批量改状态 / 保存主体 / 打包 ZIP 下载。
16. **发布作品**：`#/works` →「发布新作品」→ 上传或粘贴剧本（可先下空白模版）→ 核对大纲/世界观/人物小传/正文 → 配分类、封面、试读集数、定价与折扣 → 发布；作品库里能改状态、下合同；「收益管理」看累计/待结算/可提现并发起提现。
17. **影视项目**：`#/film` 建项目（可传封面）→ 进项目：任务表手工加或用 Excel 导入 → 资产库建文件夹并导入素材 → 成员拉人 → 「制作」开无限画布 → 完成后「提交结果下载 / 任务表下载」。
18. **拆镜三步**：项目详情点某一集 →「AI 拆分镜」→ 第一步确认切镜结果 → 第二步勾本集出镜的角色/场景/道具 → 第三步生成提示词。
19. **任务表格视图**：`#/tasks` 点表头排序、筛状态/类型/审核/时间 →「字段管理」加自定义列 →「保存视图」存成常用筛选；每行可展开加子任务、直接改审核、看参数与结果，也能导出 CSV。
20. **表情控制**：`#/post` 选「表情控制」→ 选一张有人脸的图（资产库里自带「示例人脸 · 正面」可直接试）→ 挑表情与强度（人脸框可留空自动，或写 `x,y,w,h` 百分比）→ 生成。
21. **模板库**：`#/tasks` 先把筛选与列调好 → 点「模板」→ 下方输入名称「保存当前视图为团队模板」；「官方模板」里可直接套用「待审核交付 / 失败排查」等预设，套用会覆盖当前视图的筛选与字段。
22. **演示与跟随**：`#/canvas` 打开任一画布 → 右上「协同」→「开始演示」并选中一个节点；同画布其他人点在线成员右侧「跟随」，视口会跟着你的节点走，再点一次「退出跟随」停止。
23. **结果审核**：`#/film/fm_xxx` → 任务行点「审核」→「上传结果素材」传图/视频 →「提交审核」→ 再点「通过 / 驳回」；驳回可写原因，右侧「历史批注」边看边发；任务若绑了画布，点「进入画布」直接打开。

---

## 5. API 速查

全部接口在 `server/routes/*.mjs`，统一返回 `{ code, msg, data }`。

```bash
# 健康检查
curl http://127.0.0.1:8848/api/health          # => ffmpeg / llm / assets / tasks / unlimited

# 提交一个工具任务（异步，返回 task）
curl -X POST http://127.0.0.1:8848/api/tools/text-to-image \
  -H 'content-type: application/json' \
  -d '{"prompt":"雪夜宫廷，红灯笼映在青石板上","count":2}'

# 图片后期（14 项能力统一形态，:cap 见 README 3.3）
curl -X POST http://127.0.0.1:8848/api/post/multi-angle \
  -H 'content-type: application/json' \
  -d '{"assetId":"as_xxx","views":"all"}'
curl http://127.0.0.1:8848/api/post/caps        # 列出全部后期能力元数据

# 时间线剪辑台：建工程 → 塞片段 → 导出
curl -X POST http://127.0.0.1:8848/api/editor -H 'content-type: application/json' -d '{"title":"测试工程"}'
curl -X POST http://127.0.0.1:8848/api/editor/ed_xxx -H 'content-type: application/json' \
  -d '{"clips":[{"id":"c1","track":"V1","rel":"/media/video/shot_xxx.mp4","start":0,"in":0,"out":3,"speed":1,"volume":1}]}'
curl -X POST http://127.0.0.1:8848/api/editor/ed_xxx/export

# 素材表：批量打包下载 ZIP
curl -X POST http://127.0.0.1:8848/api/sheet/download \
  -H 'content-type: application/json' -d '{"ids":["as_xxx","as_yyy"]}'

# 导入剧本 / 分镜单 → 建项目 → AI 提取资产
curl -X POST http://127.0.0.1:8848/api/ingest/upload -F 'file=@script.docx'
curl -X POST http://127.0.0.1:8848/api/ingest/create \
  -H 'content-type: application/json' -d '{"title":"新剧","text":"第一集 …"}'
curl http://127.0.0.1:8848/api/projects/pj_xxx/extract/preview
curl -X POST http://127.0.0.1:8848/api/projects/pj_xxx/extract \
  -H 'content-type: application/json' -d '{"character":true,"scene":true,"prop":true}'

# 视频后期（6 项能力统一形态，:cap 见 README 3.6）
curl -X POST http://127.0.0.1:8848/api/vpost/video-parse \
  -H 'content-type: application/json' -d '{"assetId":"as_xxx"}'
curl -X POST http://127.0.0.1:8848/api/vpost/audio-separate \
  -H 'content-type: application/json' -d '{"assetId":"as_xxx","mode":"bgm"}'
curl http://127.0.0.1:8848/api/vpost/caps        # 列出全部视频后期能力元数据

# 创作者中心：解析剧本 → 发布 → 改状态 → 下合同 → 看收益
curl -X POST http://127.0.0.1:8848/api/works/parse -F 'file=@script.docx'
curl -X POST http://127.0.0.1:8848/api/works   -H 'content-type: application/json' -d '{"title":"深巷回声","cat":"悬疑推理","price":3000}'
curl -X POST http://127.0.0.1:8848/api/works/wk_xxx/status -H 'content-type: application/json' -d '{"status":"sold"}'
curl -X POST http://127.0.0.1:8848/api/works/wk_xxx/contract
curl http://127.0.0.1:8848/api/creator/earnings
curl http://127.0.0.1:8848/api/works/template -o 剧本模版.txt

# 影视项目：任务 / 导入 / 导出 / 统计
curl -X POST http://127.0.0.1:8848/api/film -H 'content-type: application/json' -d '{"title":"归途","kind":"film"}'
curl -X POST http://127.0.0.1:8848/api/film/fm_xxx/tasks/import -F 'file=@tasks.xlsx'
curl -X POST http://127.0.0.1:8848/api/film/fm_xxx/export -H 'content-type: application/json' -d '{"kind":"result"}'
curl http://127.0.0.1:8848/api/film/fm_xxx/stats

# 任务表格视图：保存视图 → 改审核 → 加子任务 → 导出 CSV
curl -X POST http://127.0.0.1:8848/api/taskboard/views -H 'content-type: application/json' -d '{"name":"失败任务","filter":{"status":"failed"}}'
curl -X POST http://127.0.0.1:8848/api/taskboard/task_xxx/review -H 'content-type: application/json' -d '{"result":"pass","note":"可用"}'
curl -X POST http://127.0.0.1:8848/api/taskboard/task_xxx/subtasks -H 'content-type: application/json' -d '{"add":"补一版调色"}'
curl "http://127.0.0.1:8848/api/taskboard/export?status=done" -o 任务表.csv

# 任务模板库（官方 4 套 + 团队模板）
curl http://127.0.0.1:8848/api/taskboard/templates
curl -X POST http://127.0.0.1:8848/api/taskboard/templates -H 'content-type: application/json' \
  -d '{"name":"待审核清单","filter":{"status":"done","review":"none"},"fields":["title","status","review"]}'

# 画布演示 / 跟随（每 2 秒心跳，nodeId 为当前选中节点）
curl -X POST http://127.0.0.1:8848/api/canvas/cv_xxx/presence -H 'content-type: application/json' \
  -d '{"user":"本地用户","demo":true,"nodeId":"n_a1"}'

# 结果审核（影视项目任务 / 任务中心任务）
curl http://127.0.0.1:8848/api/film/fm_xxx/task/ft_xxx/review
curl -F 'file=@frame.png' http://127.0.0.1:8848/api/film/fm_xxx/task/ft_xxx/file
curl -X POST http://127.0.0.1:8848/api/film/fm_xxx/task/ft_xxx/review -H 'content-type: application/json' -d '{"action":"submit"}'
curl -X POST http://127.0.0.1:8848/api/film/fm_xxx/task/ft_xxx/review -H 'content-type: application/json' -d '{"action":"pass","note":"可以了"}'
curl -X POST http://127.0.0.1:8848/api/film/fm_xxx/task/ft_xxx/comment -H 'content-type: application/json' -d '{"text":"镜头再快一点"}'
curl -X POST http://127.0.0.1:8848/api/taskboard/task_xxx/comment -H 'content-type: application/json' -d '{"text":"任务板批注"}'

# 拆镜三步 + 表情控制
curl http://127.0.0.1:8848/api/episodes/ep_xxx/split/preview
curl -X POST http://127.0.0.1:8848/api/episodes/ep_xxx/breakdown
curl -X POST http://127.0.0.1:8848/api/post/expression -H 'content-type: application/json' -d '{"assetId":"as_xxx","expr":"smile","strength":1}'

# 轮询任务
curl http://127.0.0.1:8848/api/tasks/<taskId>

# 全量接口
curl http://127.0.0.1:8848/api/health
```

任务状态机：`queued → running（progress/step）→ done | failed | cancelled`，并发上限 2，可 `POST /api/tasks/:id/cancel`。

---

## 6. 设计说明

- **零依赖**：只用 Node 内置模块，`npm install` 不需要跑，克隆即用。
- **无构建**：`web/` 是原生 ES Module，浏览器直出，改完刷新即生效。
- **引擎分层**：`raster`（像素）→ `image`（构图）→ `video`/`effects`（时间轴）→ `route`（编排），每层可单独调用。
- **任务化**：所有耗时操作都进队列，前端轮询进度，刷新页面不丢任务。
- **去付费**：`credits` 字段仅记账展示，永不阻塞；无登录墙、无会员墙。
- **可导出**：作品合同、素材包、任务表、影视提交结果都能一键落到本地文件，数据不被锁在库里。

---

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| 视频生成失败 | 检查 `ffmpeg -version` 是否可用；错误详情见任务 `error` 字段 |
| 中文变方块 | 确认 `C:\Windows\Fonts\msyh.ttc` 存在 |
| 语音不出声 | Windows SAPI 需有中文音色（Microsoft Huihui Desktop） |
| 端口被占 | `PORT=9000 npm start` |
| 想清空数据 | 停服后删 `data/db.json` 与 `data/media/*`，重启自动重建 |

---

## 8. 与官方的差异

- 官方走云端大模型；本项目走本地程序化引擎，画面为**风格化合成**而非真实模型出图。
- 官方有付费与额度；本项目全部开放。
- 官方 /tools 已下线（2026.11.26 焕新），本项目保留完整工具箱。
- 官方素材表下载走云端打包；本项目 `engine/zip.mjs` 本地流式打包，不依赖任何第三方库。
- 官方剧本导入靠云端解析；本项目 `engine/office.mjs` 自己解 docx/xlsx 的 OOXML，离线也能读。
- 官方「AI 智能提取资产」用大模型理解剧本；本项目用规则抽取（角色靠「名字：台词」、场景靠内景/外景标记、道具靠词表 + 量词佐证），出图走本地合成引擎。
- 官方图片后期（裁剪/扩图/多角度/720°全景/九宫格/剧情推演/打光等）需要算力计费；本项目 `#/post` 用本地像素运算与几何投影实现同样的 14 项，`credits` 只记账。
- 官方时间线编辑器（`/agent/editor`）依赖云端合成；本项目 `#/editor` 全程 ffmpeg 本地渲染，四条轨道，导出直接落盘到 `data/media/video`。
- 官方画布只有连线概念；本项目 12 种节点都可单独执行，clip 节点会真把上游片段拼成一条成片，table 节点出可读的分镜单图，threeDWorld 出 360°/720° 全景。
- 官方视频后期（冻帧/截帧/音频分离/深度/拉片/片段重拍）走云端算力；本项目 `#/vpost` 全部本地 ffmpeg 完成，拉片用场景检测切镜，片段重拍用前后段原片 + 中段重渲染拼接。
- 官方 `/mcp-cli` 是给企业客户对接用的说明页；本项目 `#/mcp` 直接把 182 条接口列成可搜索清单，并给出可复制的 MCP 配置与 curl 示例。
- 官方账号中心有订阅/发票/套餐；本项目 `#/account` 只保留资料、存储、引擎参数与流水记账，没有任何支付入口。
- 官方创作者中心发布要过平台审核与在线签约；本项目 `#/works` 保留三步发布、状态流转与合同生成，但全部本地落盘，没有真实交易与结算。
- 官方影视项目的任务表支持多视图/字段管理/团队模板与云端协同；本项目 `#/film` 用本地 JSON 存任务与视图，导出走本地 ZIP/TSV。
- 官方的剧本拆分镜与资产匹配由大模型完成；本项目按场景动作句切镜、按词表匹配出镜主体，提示词由模板拼装。
- 官方表情控制是生成式重绘；本项目是对人脸网格做像素级变形（`engine/post.mjs` 的 `expressionImage`），不依赖模型，秒级出图。
- 官方画布协同走 WebSocket 实时同步；本项目用 60 秒在线心跳 + 2 秒演示心跳的轮询实现「在线列表 / 演示 / 跟随 / 节点锁 / 版本化提交」，无长连接依赖；跟随靠上报选中节点（`nodeId`）让视口平滑跟上，而不是传输画面。
- 官方任务模板库存在云端账号下；本项目模板存 `data/db.json` 的 `taskBoard.templates`（最多 30 个），官方 4 套预设写在 `server/routes/taskboard.mjs` 的 `OFFICIAL_TPL` 里。
- 官方结果审核在云端做权限校验与版本化存储；本项目在 `server/routes/film.mjs` 里给每条任务挂 `review{status,version,submittedAt,reviewedAt,note}` + `files[]` + `comments[]`，素材落 `data/media/film/<filmId>/result/`，视频预览、批注、提交/通过/驳回、绑定画布全在本地完成。