/**
 * 步骤 6 · 出图出片：分镜图（单帧/首尾帧/宫格）+ 视频段（逐段，不拼接）。
 */
import { mediaUrl, type ApiProject, type BoardItem } from '../api'

export function GenerateStep({ ws, project }: { ws: string; project: ApiProject | null }) {
  if (!project) return <div className="rd-step">加载中…</div>
  const prefs = project.pipeline.globalPrefs
  const boards = project.boards
  const videos = project.videos

  const boardsByShot = new Map<string, BoardItem[]>()
  for (const b of boards) {
    const arr = boardsByShot.get(b.shotId) ?? []
    arr.push(b)
    boardsByShot.set(b.shotId, arr)
  }

  return (
    <div className="rd-step">
      <header className="rd-step__head">
        <h2>6 · 出图出片</h2>
        <p className="rd-step__desc">
          分镜图偏好：{prefs.boardType ?? '未设定'}
          {prefs.gridMode ? ` / ${prefs.gridMode}` : ''}｜视频：{prefs.videoModel?.modelName ?? '未设定'}
          {prefs.videoSeconds ? ` · ${prefs.videoSeconds}s` : ''}。逐段生成，不拼接。
        </p>
      </header>

      <section className="rd-gen-section">
        <h3>
          分镜图 <span className="rd-muted">（{boards.length}）</span>
        </h3>
        {boards.length === 0 ? (
          <div className="rd-card rd-card--empty">尚无分镜图。让天枢调用 redraw_boards_generate。</div>
        ) : (
          project.shots.map((s) => {
            const list = boardsByShot.get(s.id)
            if (!list?.length) return null
            return (
              <div key={s.id} className="rd-shot-boards">
                <div className="rd-shot-boards__title">
                  #{s.index + 1} {s.shotSize || ''} {s.description.slice(0, 40)}
                </div>
                <div className="rd-board-row">
                  {list.map((b) => (
                    <BoardThumb key={b.id} ws={ws} board={b} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </section>

      <section className="rd-gen-section">
        <h3>
          视频段 <span className="rd-muted">（{videos.length}）</span>
        </h3>
        {videos.length === 0 ? (
          <div className="rd-card rd-card--empty">尚无视频段。让天枢调用 redraw_video_generate。</div>
        ) : (
          <div className="rd-video-list">
            {videos.map((v) => (
              <div key={v.id} className="rd-video-item">
                <div className="rd-video-item__head">
                  <span className="rd-tag is-ready">{v.durationSec}s</span>
                  <span className="rd-muted">
                    {v.modelName} · {v.resolution}
                  </span>
                </div>
                {v.output ? (
                  <video src={mediaUrl(ws, v.output.path)} controls preload="metadata" />
                ) : (
                  <div className="rd-asset__placeholder">生成中…</div>
                )}
                <div className="rd-muted rd-video-item__prompt" title={v.prompt}>
                  {v.prompt}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function BoardThumb({ ws, board }: { ws: string; board: BoardItem }) {
  const label = board.kind === 'grid' ? `宫格/${board.gridMode ?? ''}` : board.kind === 'firstLast' ? '首尾帧' : '单帧'
  return (
    <figure className="rd-board">
      <div className="rd-board__imgs">
        {board.image && <img src={mediaUrl(ws, board.image.path)} alt={label} loading="lazy" />}
        {board.panels?.map((p) => p.image && <img key={p.index} src={mediaUrl(ws, p.image.path)} alt={`panel ${p.index}`} loading="lazy" />)}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}
