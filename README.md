# Tianshu-ReDraw · 转绘短剧工厂

天枢（Tianshu）插件：把**转绘短剧的分镜镜头**写入一块可平移缩放的**无限画布**。
每个镜头是一个画布节点，节点内以 iframe 渲染真实的分镜卡 HTML；画布在浏览器中打开。

> 画布内核为 [React Flow](https://github.com/xyflow/xyflow)（`@xyflow/react`，MIT）。

## 安装

插件通过天枢「插件中心 → 社区插件 → 从其他来源安装」安装，支持两种方式：

| 方式 | 操作 |
|---|---|
| **Git URL** | 填本仓库地址（可选分支/标签）→「读取清单并审阅」→ 确认安装 |
| **本地路径** | 填本仓库根目录的**绝对路径** → 审阅 → 安装 |

> **要求**：仓库根目录就是插件根（`tianshu.plugin.json` 在根目录）。
> 安装后需**新建会话**才生效。

## 使用

在对话里让天枢做分镜，或直接调用工具：

1. `redraw_open` — 启动/复用本地画布服务，返回浏览器 URL（用浏览器打开）。
2. `redraw_upsert_shot` — 新增或更新镜头节点（`html` 或 `html_path`，可选 `title` / `aspect`；对已有 `id` 可省略 html，仅改标题/位置/尺寸）。
3. `redraw_get_state` — 读取镜头节点、连线、当前选中项与画布 URL。
4. `redraw_arrange` — 删除/复制镜头、镜头间连线或取消连线。

> **分镜卡必须自包含**：画布 CSP 会拦截外链（CDN、字体、图片）和相对路径，资源请内联。

### 画布操作

空格/中键拖拽平移 · Ctrl+滚轮缩放 · 普通滚轮平移 · 顶栏适应视图 · 右下角缩略图与缩放控件 ·
节点右键菜单（重命名/复制/删除）· 左侧镜头列表点击定位。

## 项目数据

存于工作区内，可版本化：

```
<cwd>/.tianshu-redraw/
├── project.json          画布模型（镜头/连线/视口）
└── shots/<id>.html       每个镜头的分镜卡 HTML
```

## 开发

```bash
npm install
npm run verify   # typecheck + build + test
```

- **技术栈**：TypeScript（Node 侧 + React 侧），esbuild 打包。
- **构建产物 `dist/` 必须提交进仓库**：天枢安装插件时只跑
  `npm install --ignore-scripts --omit=dev`，**不会执行构建脚本**，因此
  `dist/`（`entry` 指向 `dist/index.js`）必须随仓库分发。CI 会用
  `git diff --exit-code -- dist` 校验产物与源码一致。
- **Node 侧是单文件 bundle**：`src/server.ts` 是模块级单例，多文件会产生重复单例。

### 目录

```
src/             Node 侧（入口/工具/本地服务/项目模型/导出）→ dist/index.js
web/             画布前端（React + React Flow）→ dist/web/canvas.js
dist/            构建产物（提交进仓库）
test/            契约 / 项目 / 服务测试（node:test，跑构建产物）
scripts/         build.mjs、extract-release-notes.mjs
release/         每个版本的发布详情文档（release-<版本>.md）
```

## 许可

Apache License 2.0（见 [LICENSE](LICENSE)）。
