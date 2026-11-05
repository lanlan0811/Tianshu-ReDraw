# Tianshu-ReDraw · 转绘短剧工厂

天枢（Tianshu）插件：把**真人短剧/视频**转绘成目标风格的**端到端流水线**——
抽帧看片 → 风格本土化 → 剧本 → 分镜表 → 资产 → 分镜图 → 视频。画布在浏览器中打开（本地服务）。

> 画布前端为 React Flow / 深黑主题（本地服务 + 浏览器打开）。
> 抽帧用浏览器内 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)（单线程核心，离线可用）。

## 六步流水线

| 步骤 | 产出 | 工具 |
|---|---|---|
| 1 抽帧看片 | 关键帧 + 宫格总览图 | `redraw_frames_ingest` / `redraw_frames_extract` / `redraw_frames_list` |
| 2 风格本土化 | 风格锁定 + 结构化文化报告 | `redraw_style_*` / `redraw_localize_*` |
| 3 剧本 | 分集剧本（草稿→确认） | `redraw_script_*` |
| 4 分镜表 | 标准全套字段镜头表（草稿→确认） | `redraw_shotlist_*` |
| 5 资产 | 人物/道具/场景 + 衍生变体（文字→图） | `redraw_assets_*` |
| 6 出图出片 | 分镜图（单帧/首尾帧/宫格）+ 视频段 | `redraw_boards_*` / `redraw_video_*` |

## 安装

天枢「插件中心 → 社区插件 → 从其他来源安装」：

| 方式 | 操作 |
|---|---|
| **Git URL** | 填本仓库地址（可选分支/标签）→「读取清单并审阅」→ 确认安装 |
| **本地路径** | 填本仓库根目录的**绝对路径** → 审阅 → 安装 |

> 仓库根即插件根（`tianshu.plugin.json` 在根目录）。安装后需**新建会话**才生效。

## 供应商适配（图像/视频生成）

生成走**工作区适配文件**（Toonflow AI 供应商格式）。把 `<id>.ts` 放到
`<工作区>/.tianshu-redraw/vendors/`，内容含：

- `vendor`：`id / version / name / inputs / inputValues / models`（`models` 里声明 image / video 模型及其能力）
- `imageRequest(config, model) → Promise<string>`：返回有头 base64（`data:image/png;base64,...`）
- `videoRequest(config, model) → Promise<string>`：返回有头 base64

配置（密钥/启用/信任）写入 `<工作区>/.tianshu-redraw/config.json`：

```json
{
  "version": 1,
  "active": {
    "image": { "vendorId": "myvendor", "modelName": "my-image-model" },
    "video": { "vendorId": "myvendor", "modelName": "my-video-model" }
  },
  "vendors": { "myvendor": { "trusted": true, "inputValues": { "apiKey": "sk-...", "baseUrl": "https://..." } } }
}
```

> **安全**：适配代码在**子进程**中执行（`node --permission`，文件系统受限、网络放行）。
> 未在配置里标记 `trusted: true` 的 vendor **不会被执行**。
> 密钥存工作区 `config.json`；若工作区是 git 仓库，建议把 `.tianshu-redraw/` 加入 `.gitignore`。

## 抽帧（浏览器 ffmpeg.wasm）

- 视频由天枢复制进工作区，本地服务以 **HTTP Range** 流式提供。
- 抽帧在**画布浏览器内**执行（单线程 ffmpeg.wasm 核心，**无需 SharedArrayBuffer**）。
- 核心（`ffmpeg-core.js` + `ffmpeg-core.wasm`，约 31MB）**提交进仓库**，离线可用。
- 无视频时可只给**纯文本剧情**，跳过抽帧。

## 项目数据

```
<工作区>/.tianshu-redraw/
├── project.json          单一项目文件（v2）
├── config.json           供应商/模型/密钥/偏好
├── vendors/*.ts          供应商适配文件
├── frames/               抽帧（+ _contact/ 宫格总览）
├── assets/<id>/          资产图（基础 + 变体）
├── boards/<shotId>/      分镜图
└── videos/<shotId>/      视频段（逐段，不拼接）
```

## 开发

```bash
npm install
npm run verify   # typecheck + build + test
node scripts/verify-web.mjs   # 真实浏览器端到端
```

- **技术栈**：TypeScript（Node + React），esbuild 打包。
- **构建产物 `dist/` 必须提交进仓库**：天枢安装只跑 `npm install --ignore-scripts --omit=dev`，
  **不执行构建脚本**。`dist/ffmpeg/` 为离线抽帧核心，随仓库分发。
- **Node 侧是单文件 bundle**（`src/server.ts` 为模块级单例）；`dist/vendor-host.js` 是 vendor 子进程入口。
- 依赖 Node ≥ 24（`module.stripTypeScriptTypes` 去类型，`node:sqlite`）。

### 目录

```
src/                  Node 侧 → dist/index.js（+ dist/vendor-host.js）
  vendor/             供应商执行器（子进程隔离）
  generate/           图像/视频生成编排
  styles/             内置风格库
web/                  画布前端 → dist/web/canvas.js（+ frames-worker.js）
dist/                 构建产物（提交进仓库）
test/                 契约/项目/vendor/任务/服务/lifecycle 测试
scripts/              build.mjs、verify-web.mjs、shot-preview.mjs
release/              发布详情文档
```

## 许可

Apache License 2.0（见 [LICENSE](LICENSE)）。
ffmpeg.wasm 核心遵循其自身许可（LGPL/GPL），见 `@ffmpeg/core` 的许可说明。
