# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。发布说明详见 `release/` 目录。

## v0.1.0

首个版本：以 React Flow 无限画布承载转绘短剧分镜的天枢 TPI 插件。

- **画布框架**：本地服务（127.0.0.1）+ 浏览器打开；深黑主题，暖橙强调色。
- **工具**：`redraw_open` / `redraw_upsert_shot` / `redraw_get_state` / `redraw_arrange`。
- **镜头节点**：分镜卡以沙箱 iframe 渲染，支持竖屏 / 横屏 / 方形画幅。
- **编排**：镜头复制、删除、连线（表达分镜顺序）。
- **数据**：存于工作区 `.tianshu-redraw/`（project.json + shots/*.html），可版本化。
