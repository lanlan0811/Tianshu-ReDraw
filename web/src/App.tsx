/**
 * 转绘短剧工厂 · 画布应用（流程向导式）。
 * 左侧 6 步导航 + 主区当前步骤 + 底部状态条。深黑主题。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { postPipeline, type StepId } from './api'
import { useProject } from './wizard/useProject'
import { StepNav } from './wizard/StepNav'
import { StatusBar } from './wizard/StatusBar'
import { TopBar } from './TopBar'
import { FramesStep } from './steps/FramesStep'
import { LocalizeStep } from './steps/LocalizeStep'
import { ScriptStep } from './steps/ScriptStep'
import { ShotlistStep } from './steps/ShotlistStep'
import { AssetsStep } from './steps/AssetsStep'
import { GenerateStep } from './steps/GenerateStep'

const ws = new URLSearchParams(location.search).get('ws') ?? ''
const canvasUrl = location.href

export default function App() {
  const { project, error, reload } = useProject(ws)
  const [current, setCurrent] = useState<StepId>('frames')
  const syncedOnce = useRef(false)

  // 首次拿到项目后，跟随服务端的 currentStep（之后由用户点击主导）
  useEffect(() => {
    if (!syncedOnce.current && project?.pipeline.currentStep) {
      syncedOnce.current = true
      setCurrent(project.pipeline.currentStep)
    }
  }, [project?.pipeline.currentStep])

  const select = useCallback((id: StepId) => {
    setCurrent(id)
    void postPipeline(ws, 'set_step', { step: id })
  }, [])

  if (!ws) return <div className="rd-fatal">缺少工作区参数（?ws=…）。请从插件返回的画布链接打开。</div>

  return (
    <div className="rd-app">
      <TopBar ws={ws} title={project?.meta.title ?? '未命名短剧'} onRefresh={reload} />
      <div className="rd-body">
        <StepNav project={project} current={current} onSelect={select} />
        <main className="rd-main">
          {error && <div className="rd-banner rd-banner--error">加载失败：{error}</div>}
          {project?.issue && <div className="rd-banner rd-banner--warn">{project.issue}</div>}
          {current === 'frames' && <FramesStep ws={ws} project={project} />}
          {current === 'localize' && <LocalizeStep project={project} />}
          {current === 'script' && <ScriptStep ws={ws} project={project} reload={reload} />}
          {current === 'shotlist' && <ShotlistStep ws={ws} project={project} reload={reload} />}
          {current === 'assets' && <AssetsStep ws={ws} project={project} />}
          {current === 'generate' && <GenerateStep ws={ws} project={project} />}
        </main>
      </div>
      <StatusBar project={project} url={canvasUrl} />
    </div>
  )
}
