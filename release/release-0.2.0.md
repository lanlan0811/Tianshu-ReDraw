# 转绘短剧工厂 v0.2.0

从画布骨架升级为**端到端 6 步转绘流水线**。

## 六步流水线

1. **抽帧看片** —— 本地视频或纯文本剧情；浏览器内 ffmpeg.wasm 固定间隔抽帧，输出关键帧 + 宫格总览图。
2. **风格与本土化** —— 内置风格库（日系/国风/欧美卡通/韩系条漫/电影写实/3D 渲染，可自定义）+ 结构化文化调研报告。
3. **剧本** —— 分集剧本草稿 → 用户确认。
4. **分镜表** —— 标准全套字段（镜号/时长/景别/运镜/场景/人物/道具/画面/对白/旁白/情绪）→ 用户确认。
5. **资产** —— 人物/道具/场景三类，各含文字设定 + 提示词 + 衍生变体；先文字后生图，变体用基础图作参考。
6. **出图出片** —— 分镜图（单帧/首尾帧/宫格；宫格支持多镜总览与单镜分格）+ 逐段视频生成（不拼接）。

## 亮点

- **流程向导式深黑画布**：左侧 6 步导航（状态点 + 门控徽标）、主区步骤视图、底部任务/门控状态条。
- **供应商适配器**：复用 Toonflow 供应商格式（`<工作区>/.tianshu-redraw/vendors/*.ts`），**子进程隔离执行**
  （`node --permission`：文件系统受限、网络放行），未标记 `trusted` 的 vendor 不执行。
- **抽帧离线可用**：ffmpeg.wasm 单线程核心（约 31MB）随仓库分发，无需 SharedArrayBuffer。
- **长任务不阻塞**：生成图/视频走任务模型，工具立即返回 `jobId`，`redraw_job_status` 轮询。
- **流程门控**：`promptContext` 每轮注入 `<tianshu-redraw-state>` 状态块；SKILL.md 硬顺序 + 禁止清单 + ask-and-stop。
- **自动迁移**：v0.1 的 `project.json` 自动迁移到 v2 并备份。

## 工具（28 个，按步骤）

通用：`redraw_open` `redraw_get_state` `redraw_config_get` `redraw_config_set` `redraw_vendor_list`
`redraw_vendor_validate` `redraw_style_list` `redraw_style_set` `redraw_add_edge`
1：`redraw_frames_ingest` `redraw_frames_extract` `redraw_frames_list`
2：`redraw_localize_set` `redraw_localize_get`
3：`redraw_script_upsert` `redraw_script_get` `redraw_script_approve`
4：`redraw_shotlist_upsert` `redraw_shotlist_get` `redraw_shotlist_approve`
5：`redraw_assets_upsert` `redraw_assets_list` `redraw_assets_generate`
6：`redraw_boards_plan` `redraw_boards_generate` `redraw_video_generate` `redraw_job_status` `redraw_job_cancel`

## 破坏性变更

- 移除 v0.1 的 `redraw_upsert_shot` / `redraw_arrange`。
- `project.json` 升级为 v2（首次写入前自动备份为 `project.json.v1-*`）。

## 已知限制

- 工具只返回**文件路径**，模型无法直接查看图片像素。
- 子进程隔离限制文件系统，但**不限制网络**（适配器必须联网）。
- `zipImage` / `mergeImages` / `jsonwebtoken`（仅 HS256）为占位实现。
- 抽帧需用户打开画布（浏览器内执行）。
- 依赖 Node ≥ 24。

## 安装

天枢「插件中心 → 社区插件 → 从其他来源安装」，填本仓库 Git URL 或本地绝对路径。安装后**新建会话**生效。
