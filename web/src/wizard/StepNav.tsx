/**
 * 左侧 6 步流程导航。
 */
import type { ApiProject, StepId } from '../api'

export const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: 'frames', label: '抽帧看片', hint: '抽取关键帧，理解剧情' },
  { id: 'localize', label: '风格本土化', hint: '转绘风格 + 地区文化调研' },
  { id: 'script', label: '剧本', hint: '草拟剧本 → 确认' },
  { id: 'shotlist', label: '分镜表', hint: '镜头字段 → 确认' },
  { id: 'assets', label: '资产', hint: '人物/道具/场景 + 变体' },
  { id: 'generate', label: '出图出片', hint: '分镜图 + 视频' },
]

export function StepNav({
  project,
  current,
  onSelect,
}: {
  project: ApiProject | null
  current: StepId
  onSelect: (id: StepId) => void
}) {
  return (
    <nav className="rd-nav">
      <div className="rd-nav__title">转绘流程</div>
      <ol className="rd-nav__list">
        {STEPS.map((s, i) => {
          const st = project?.pipeline.steps[s.id]
          const status = st?.status ?? 'pending'
          const gate = st?.gate
          const isCurrent = current === s.id
          return (
            <li key={s.id}>
              <button
                className={`rd-nav__item${isCurrent ? ' is-current' : ''} is-${status}`}
                onClick={() => onSelect(s.id)}
                title={s.hint}
              >
                <span className="rd-nav__idx">{i + 1}</span>
                <span className="rd-nav__body">
                  <span className="rd-nav__label">{s.label}</span>
                  <span className="rd-nav__hint">{s.hint}</span>
                </span>
                {gate && gate.asked && !gate.answered ? <span className="rd-nav__gate" title="待用户确认">!</span> : null}
                <span className={`rd-nav__dot is-${status}`} />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
