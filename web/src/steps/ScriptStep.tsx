/**
 * 步骤 3 · 剧本（草拟 → 用户确认）。
 */
import { postPipeline, type ApiProject } from '../api'

interface Episode {
  id: string
  index: number
  title: string
  logline: string
  synopsis: string
  scenes: { id: string; index: number; slug: string; location: string; timeOfDay: string; summary: string; beats: string[] }[]
  status: string
}

export function ScriptStep({ ws, project, reload }: { ws: string; project: ApiProject | null; reload: () => void }) {
  if (!project) return <div className="rd-step">加载中…</div>
  const episodes = project.script.episodes as unknown as Episode[]
  const gate = project.pipeline.steps.script.gate

  const approve = () => {
    void postPipeline(ws, 'answer_gate', { step: 'script', answer: 'approved' }).then(reload)
  }

  return (
    <div className="rd-step">
      <header className="rd-step__head">
        <h2>3 · 剧本</h2>
        <p className="rd-step__desc">先草稿，再确认。状态：{project.script.status}（修订 {project.script.revisions} 次）。</p>
      </header>

      {gate?.asked && !gate.answered && (
        <div className="rd-gate">
          <div className="rd-gate__q">{gate.question ?? '剧本已草拟，等待确认'}</div>
          <div className="rd-gate__hint">可在对话中提出修改；确认后点此批准。</div>
          <button className="rd-btn rd-btn--primary" onClick={approve}>
            批准剧本
          </button>
        </div>
      )}

      {episodes.length === 0 ? (
        <div className="rd-card rd-card--empty">尚无剧本。让天枢调用 redraw_script_upsert 写入草稿。</div>
      ) : (
        episodes.map((ep) => (
          <div key={ep.id} className="rd-card">
            <div className="rd-card__label">
              第 {ep.index + 1} 集《{ep.title}》 · {ep.status}
            </div>
            {ep.logline && <p className="rd-logline">{ep.logline}</p>}
            {ep.synopsis && <p className="rd-muted">{ep.synopsis}</p>}
            <ul className="rd-scenes">
              {ep.scenes.map((s) => (
                <li key={s.id}>
                  <span className="rd-scene__slug">{s.slug || s.location || `场 ${s.index + 1}`}</span>
                  <span className="rd-muted"> {s.timeOfDay}</span>
                  <div className="rd-scene__sum">{s.summary}</div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
