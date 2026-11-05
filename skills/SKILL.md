---
name: tianshu-redraw
description: 用无限画布承载转绘短剧的分镜与镜头。当用户要做短剧转绘、分镜设计、镜头编排、AI 视频分镜、或提到「转绘」「短剧工厂」「分镜画布」时使用。
triggers:
  - 转绘
  - 短剧
  - 分镜
  - 镜头
  - redraw
  - storyboard
---

# 转绘短剧工厂（tianshu-redraw）

把转绘短剧的**分镜镜头**放到一块可平移缩放的**无限画布**上。画布在浏览器中打开（本地服务），
每个镜头是一个画布节点，节点内以 iframe 渲染真实的分镜卡 HTML。

## 执行顺序（严格按序，不得跳步）

> **顺序是硬约束**：① 先把画布链接给用户 → ② 再写入分镜镜头 → ③ 最后自查编排。

**第 1 步 · `redraw_open`**：启动/复用画布服务，拿到画布 URL。
把 URL **单独一行**发给用户，让他用浏览器打开。

**第 2 步 · 写入分镜**：为每个镜头写一张分镜卡 HTML，用 `redraw_upsert_shot` 每镜一次。

**第 3 步 · 编排与自查**：`redraw_get_state` 看镜头列表；用 `redraw_arrange`（link）串出镜头顺序。

### 禁止（违反即为流程错误）

- 在把画布 URL 发给用户之前，就调用 `redraw_upsert_shot` 写镜头。
- 在工作区里另建 `shots/`、`storyboard/` 等文件夹存分镜——分镜只存放在 `.tianshu-redraw/shots/`。

## 分镜卡写法

- **必须自包含**：外链（CDN、字体、图片）和相对路径都会被画布 CSP 拦截，加载不到。
  样式写进 `<style>`，图片用 `data:` URI 或 CSS/SVG 绘制。
- 竖屏短剧用 `aspect: "portrait"`（9:16，默认）；横屏用 `landscape`。
- 建议每张分镜卡包含：镜号、场景/景别、画面描述、台词/旁白、镜头运动、时长。
- 直接把完整 HTML 传给 `redraw_upsert_shot` 的 `html` 参数（不要先落盘再用 `html_path`）。

## 编排与交付

- **改镜头**：`redraw_upsert_shot` 传已存在的 `id` 即为更新；省略 `html` 只改标题/位置/尺寸/画幅。
- **编排**：`redraw_arrange`，`action` 取 remove / duplicate / link / unlink；
  `link` 表达镜头顺序（第1镜 → 第2镜）。
- **选中反馈**：用户在画布上点选镜头后，`redraw_get_state` 从「当前选中」段读回。

## 约定

- 镜头按**逻辑分辨率**渲染（portrait 405×720 / landscape 720×405 / square 540×540）。
- 画布操作：空格/中键拖拽平移；Ctrl+滚轮缩放；普通滚轮平移。
- 分镜卡在沙箱 iframe 中渲染（`sandbox="allow-scripts"`，无同源权限）。
- 项目数据存于 `<cwd>/.tianshu-redraw/`（project.json + shots/*.html），可版本化。
- 安装/启用插件后需**新建会话**才生效。

## 工具

| 工具 | 用途 | 何时用 |
|---|---|---|
| `redraw_open` | 启动/复用本地画布服务，返回浏览器 URL | **第一步，永远先调用** |
| `redraw_upsert_shot` | 新增镜头，或更新已有镜头（内容 / 标题 / 位置 / 尺寸） | 已 `redraw_open` 且已生成分镜后；重命名、移动也用它 |
| `redraw_get_state` | 读取镜头列表、连线、用户当前选中项、画布 URL | 需要查看/确认，或用户选中镜头后据此修改 |
| `redraw_arrange` | 删除 / 复制镜头、连线 / 取消连线（`action` 选择） | 编排镜头顺序、表达分镜流程时 |
