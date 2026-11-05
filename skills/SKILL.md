---
name: tianshu-redraw
description: 转绘短剧工厂。当用户要做短剧转绘、分镜设计、镜头编排、AI 视频分镜、把真人短剧转成动漫/其他地区风格、或提到「转绘」「短剧工厂」「分镜画布」时使用。
triggers:
  - 转绘
  - 短剧
  - 分镜
  - 镜头
  - 抽帧
  - redraw
  - storyboard
---

# 转绘短剧工厂（tianshu-redraw）

把**真人短剧/视频**转绘成**目标风格**（动漫/日系/欧美/国风…或指定地区）的端到端流水线：
抽帧看片 → 风格本土化 → 剧本 → 分镜表 → 资产 → 分镜图 → 视频。画布在浏览器中打开（本地服务）。

## 执行顺序（严格按序，不得跳步）

> **顺序是硬约束**。每一步做完、且门控（gate）得到用户确认后，才能进入下一步。
> `redraw_get_state` 会返回当前进度与未回答的门控；工具输出也会提示。

0. **`redraw_open`** —— 启动画布服务，把 URL **单独一行**发给用户，让其用浏览器打开。
1. **素材与抽帧** —— `redraw_frames_ingest`（本地视频路径 `video_path` 或纯文本 `story`）→ `redraw_frames_extract`（间隔秒）。
   **抽帧在浏览器内用 ffmpeg.wasm 执行**：必须让用户打开画布；随后轮询 `redraw_frames_list`。
2. **风格与本土化** —— `redraw_style_list` 看风格，与用户确认后 `redraw_style_set`；`redraw_localize_set` 写地区与结构化本土化报告。
3. **剧本** —— `redraw_script_upsert` 写草稿 → **停下问用户** → `redraw_script_approve`。
4. **分镜表** —— `redraw_shotlist_upsert` 写草稿（标准全套字段）→ **停下问用户** → `redraw_shotlist_approve`。
5. **资产** —— `redraw_assets_upsert` 先写**文字设定+提示词**（人物/道具/场景及变体）→ `redraw_assets_generate` 生成基础图 → 再生成变体（变体用基础图作参考）。
6. **出图出片** —— `redraw_boards_plan` 记录分镜图偏好；`redraw_boards_generate` 生成分镜图；`redraw_video_generate` 逐段生成视频。

### 禁止（违反即为流程错误）

- 在把画布 URL **单独一行**发给用户之前，开始任何写入。
- **跳步**：上一步未 done / 门控未确认，就进入下一步。
- 把资产图的生成**推迟**到分镜阶段——必须先文字设定+提示词，再生成图。
- **拼接**视频——每段独立输出，不合并。
- 在工作区另建数据目录（只用 `.tianshu-redraw/`）。
- 在 vendor 适配文件里 `import` 任何外部包（只能用模板声明的全局）。
- **声称你能「看到」图片**——工具只返回**文件路径**，你必须让用户查看，或引用路径。

### 必须停下问用户的节点（ask-and-stop）

1. 剧本草稿完成后：问是否批准或修改，**等回答**再 `redraw_script_approve`。
2. 分镜表草稿完成后：同上，`redraw_shotlist_approve` 前必须等回答。
3. 出分镜图前：**一次性问**分镜图类型（单帧/首尾帧/宫格）与宫格含义（多镜总览 / 单镜分格），记入偏好后沿用。
4. 出视频前：问**要写多少秒的提示词、用哪个视频模型**，**等回答**再 `redraw_video_generate`。

## 供应商与配置

图像/视频生成走**工作区适配文件**（Toonflow 格式）：

- 适配文件放 `<cwd>/.tianshu-redraw/vendors/<id>.ts`（结构见模板：`vendor` + `imageRequest` + `videoRequest`，返回有头 base64）。
- `redraw_vendor_list` 列出可用供应商与模型；`redraw_vendor_validate` 校验。
- `redraw_config_set` 配置：`image_vendor`/`image_model`、`video_vendor`/`video_model`、`vendor_id`+`input_values`（密钥）+`trusted=true`。
- 适配代码在**子进程**中执行（`node --permission`，文件系统受限、网络放行）；未标记 `trusted` 的 vendor 不会被执行。
- 密钥存工作区 `config.json`。若工作区是 git 仓库，建议把 `.tianshu-redraw/` 加入 `.gitignore`。

## 长任务（生成图/视频、抽帧）

工具**立即返回 jobId**，不会阻塞。用 `redraw_job_status` 轮询（可带 `job_id` 或列全部），
`redraw_job_cancel` 取消。完成后产出路径会写入项目，`redraw_assets_list` / `redraw_get_state` 可读。

## 约定

- 图片/视频以**工作区路径**返回，模型无法直接查看像素。
- 分镜表字段：镜号、时长、景别、运镜、场景、人物、道具、画面描述、对白、旁白、情绪。
- 资产三类：人物（character）/道具（prop）/场景（scene），各有基础设定与衍生变体。
- 视频逐段输出（不拼接），时长与模型由用户选定。
- 项目数据存于 `<cwd>/.tianshu-redraw/`（project.json + frames/ assets/ boards/ videos/ vendors/）。
- 安装/启用插件后需**新建会话**才生效。

## 工具（按步骤）

| 步骤 | 工具 |
|---|---|
| 通用 | `redraw_open`、`redraw_get_state`、`redraw_config_get`、`redraw_config_set`、`redraw_vendor_list`、`redraw_vendor_validate`、`redraw_style_list`、`redraw_style_set`、`redraw_add_edge` |
| 1 抽帧 | `redraw_frames_ingest`、`redraw_frames_extract`、`redraw_frames_list` |
| 2 本土化 | `redraw_localize_set`、`redraw_localize_get` |
| 3 剧本 | `redraw_script_upsert`、`redraw_script_get`、`redraw_script_approve` |
| 4 分镜表 | `redraw_shotlist_upsert`、`redraw_shotlist_get`、`redraw_shotlist_approve` |
| 5 资产 | `redraw_assets_upsert`、`redraw_assets_list`、`redraw_assets_generate` |
| 6 出图出片 | `redraw_boards_plan`、`redraw_boards_generate`、`redraw_video_generate`、`redraw_job_status`、`redraw_job_cancel` |
