# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。发布说明详见 `release/` 目录。

## v0.2.0

**端到端转绘短剧工厂**：从画布骨架升级为完整 6 步流水线。

- **六步流水线**：抽帧看片 → 风格本土化 → 剧本 → 分镜表 → 资产 → 分镜图 → 视频。
- **流程向导式画布**（深黑主题）：左侧 6 步导航（含状态点与门控徽标）、主区步骤视图、底部任务/门控状态条。
- **工具按步骤分组**：28 个 `redraw_*` 工具（替换 v0.1 的 4 个）。
- **供应商适配器**：复用 Toonflow 供应商格式（`vendors/*.ts`），**子进程隔离执行**（`node --permission`），只取图像/视频适配。
- **抽帧**：浏览器内 ffmpeg.wasm（单线程核心，离线可用，随仓库分发）。
- **生成编排**：任务模型（start/status/cancel）、并发闸门、结果落盘与 MediaRef。
- **流程门控**：`promptContext` 在 turnStart 注入 `<tianshu-redraw-state>` 状态块 + SKILL.md 硬约束。
- **数据迁移**：`project.json` v1 → v2 自动迁移并备份。
- **风格库**：内置日系/国风/欧美卡通/韩系条漫/电影写实/3D 渲染，支持工作区自定义。

### 破坏性变更

- 移除 v0.1 的 `redraw_upsert_shot` / `redraw_arrange`；项目文件升级为 v2（自动迁移）。

## v0.1.0

首个版本：以 React Flow 无限画布承载转绘短剧分镜的天枢 TPI 插件。

- 深黑画布 + 本地服务 + 浏览器打开。
- 4 个工具：`redraw_open` / `redraw_upsert_shot` / `redraw_get_state` / `redraw_arrange`。
