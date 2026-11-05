/**
 * 构建脚本：esbuild 打包 Node 侧、Web 侧、抽帧 worker、vendor 子进程宿主，产物写入 dist/。
 *
 * 为什么产物要提交：天枢安装插件时只跑 `npm install --ignore-scripts --omit=dev`，
 * **永不执行构建脚本**，因此 dist/ 必须随仓库分发。
 *
 * 为什么 Node 侧是单文件：src/server.ts 是模块级单例；若拆成多文件，
 * 入口会内联自己的副本，测试 import 时会看到第二个独立单例。
 *
 * ffmpeg.wasm 核心（单线程，~31MB wasm）从 node_modules 复制进 dist/ffmpeg/，离线可用。
 * 注意：不再整目录 rm dist/，否则会删掉已提交的 ffmpeg 资源。
 */
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const distWeb = resolve(dist, 'web')
const distFfmpeg = resolve(dist, 'ffmpeg')

// 只清理构建产物，保留 dist/ffmpeg/（提交进仓库的 wasm 资源）
rmSync(resolve(dist, 'index.js'), { force: true })
rmSync(resolve(dist, 'vendor-host.js'), { force: true })
rmSync(distWeb, { recursive: true, force: true })
mkdirSync(distWeb, { recursive: true })
mkdirSync(distFfmpeg, { recursive: true })

// (a) Node 侧：src/index.ts -> dist/index.js（单文件 ESM bundle，零运行时依赖）
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
})

// (a2) vendor 子进程宿主：src/vendor/child-host.ts -> dist/vendor-host.js
await build({
  absWorkingDir: root,
  entryPoints: ['src/vendor/child-host.ts'],
  outfile: 'dist/vendor-host.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
})

// (b) Web 侧：web/src/main.tsx -> dist/web/canvas.js（+ canvas.css）
await build({
  absWorkingDir: root,
  entryPoints: ['web/src/main.tsx'],
  outfile: 'dist/web/canvas.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'css' },
  logLevel: 'info',
})

// (b2) 抽帧 worker：web/src/frames/worker.ts -> dist/web/frames-worker.js（ESM worker）
await build({
  absWorkingDir: root,
  entryPoints: ['web/src/frames/worker.ts'],
  outfile: 'dist/web/frames-worker.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
})

// (c) 复制 HTML 外壳
copyFileSync(resolve(root, 'web/index.html'), resolve(distWeb, 'index.html'))

// (d) 复制 ffmpeg 单线程核心（离线可用）
const coreSrc = resolve(root, 'node_modules/@ffmpeg/core/dist/esm')
if (existsSync(coreSrc)) {
  copyFileSync(resolve(coreSrc, 'ffmpeg-core.js'), resolve(distFfmpeg, 'ffmpeg-core.js'))
  copyFileSync(resolve(coreSrc, 'ffmpeg-core.wasm'), resolve(distFfmpeg, 'ffmpeg-core.wasm'))
} else {
  console.error('build: 缺少 @ffmpeg/core（请先 npm install）')
  process.exit(1)
}

// 断言关键产物存在
for (const f of [
  'index.js',
  'vendor-host.js',
  'web/index.html',
  'web/canvas.js',
  'web/canvas.css',
  'web/frames-worker.js',
  'ffmpeg/ffmpeg-core.js',
  'ffmpeg/ffmpeg-core.wasm',
]) {
  if (!existsSync(resolve(dist, f))) {
    console.error(`build: 缺少产物 dist/${f}`)
    process.exit(1)
  }
}
console.log('build: 完成 -> dist/{index.js,vendor-host.js,web/**,ffmpeg/**}')
