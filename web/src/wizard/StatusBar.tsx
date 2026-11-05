/**
 * 底部状态条：当前步骤、活跃任务进度、门控提醒、画布 URL。
 */
import type { ApiProject } from '../api'

export function StatusBar({ project, url }: { project: ApiProject | null; url: string }) {
  const jobs = project?.jobs ?? []
  const gate = project?.gate
  return (
    <footer className="rd-status">
      <span className="rd-status__step">步骤：{project?.pipeline.currentStep ?? '—'}</span>
      {gate && (
        <span className="rd-status__gate" title={gate.question}>
          待确认：{gate.step}
        </span>
      )}
      <span className="rd-status__jobs">
        {jobs.length === 0
          ? '无进行中任务'
          : jobs.map((j) => (
              <span key={j.id} className="rd-status__job" title={j.error ?? j.message}>
                {j.kind} {Math.round(j.progress * 100)}%
                <span className="rd-status__bar">
                  <i style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </span>
              </span>
            ))}
      </span>
      <span className="rd-status__url" title={url}>
        {url}
      </span>
    </footer>
  )
}
