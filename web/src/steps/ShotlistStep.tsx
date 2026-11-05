/**
 * 步骤 4 · 分镜表（草拟 → 用户确认）。表格视图展示标准全套字段。
 */
import { postPipeline, type ApiProject } from '../api'

export function ShotlistStep({ ws, project, reload }: { ws: string; project: ApiProject | null; reload: () => void }) {
  if (!project) return <div className="rd-step">加载中…</div>
  const shots = project.shots
  const gate = project.pipeline.steps.shotlist.gate

  const approve = () => {
    void postPipeline(ws, 'answer_gate', { step: 'shotlist', answer: 'approved' }).then(reload)
  }

  return (
    <div className="rd-step">
      <header className="rd-step__head">
        <h2>4 · 分镜表</h2>
        <p className="rd-step__desc">标准字段：镜号/时长/景别/运镜/场景/人物/道具/画面/对白/旁白/情绪。共 {shots.length} 个镜头。</p>
      </header>

      {gate?.asked && !gate.answered && (
        <div className="rd-gate">
          <div className="rd-gate__q">{gate.question ?? '分镜表已草拟，等待确认'}</div>
          <button className="rd-btn rd-btn--primary" onClick={approve}>
            批准分镜表
          </button>
        </div>
      )}

      {shots.length === 0 ? (
        <div className="rd-card rd-card--empty">尚无分镜表。让天枢调用 redraw_shotlist_upsert 写入。</div>
      ) : (
        <div className="rd-table-wrap">
          <table className="rd-table">
            <thead>
              <tr>
                <th>#</th>
                <th>时长</th>
                <th>景别</th>
                <th>运镜</th>
                <th>场景</th>
                <th>人物</th>
                <th>道具</th>
                <th>画面</th>
                <th>对白/旁白</th>
                <th>情绪</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((s) => (
                <tr key={s.id}>
                  <td>{s.index + 1}</td>
                  <td>{s.durationSec}s</td>
                  <td>{s.shotSize || '—'}</td>
                  <td>{s.cameraMove || '—'}</td>
                  <td>{s.scene || '—'}</td>
                  <td>{s.characters.join('、') || '—'}</td>
                  <td>{s.props.join('、') || '—'}</td>
                  <td className="rd-td-desc">{s.description}</td>
                  <td>{[s.dialogue, s.voiceover].filter(Boolean).join(' / ') || '—'}</td>
                  <td>{s.emotion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
