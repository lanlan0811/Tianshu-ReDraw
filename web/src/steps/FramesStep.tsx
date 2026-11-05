/**
 * 步骤 1 · 抽帧看片。
 * 源：视频（本地已 ingest）或纯文本剧情。抽帧在浏览器内用 ffmpeg.wasm 执行。
 */
import { useState } from 'react'
import { mediaUrl, sourceVideoUrl, type ApiProject } from '../api'
import { runExtraction } from '../frames/extract'

export function FramesStep({ ws, project }: { ws: string; project: ApiProject | null }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!project) return <div className="rd-step">加载中…</div>

  const src = project.source
  const frames = project.frames.filter((f) => !f.path.includes('_contact'))
  const sheet = project.frames.find((f) => f.path.includes('_contact'))
  const interval = project.extractRequest?.intervalSec ?? 2

  const doExtract = async () => {
    setBusy(true)
    setError(null)
    try {
      await runExtraction(ws, interval, (p, m) => {
        if (p >= 0) setProgress(p)
        setMessage(m)
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rd-step">
      <header className="rd-step__head">
        <h2>1 · 抽帧看片</h2>
        <p className="rd-step__desc">理解视频/短剧剧情。视频由天枢复制进工作区；抽帧在浏览器内完成（ffmpeg.wasm，离线可用）。</p>
      </header>

      {src.mode === 'story' ? (
        <div className="rd-card">
          <div className="rd-card__label">素材：文本剧情</div>
          <pre className="rd-pre">{src.story || '（空）'}</pre>
        </div>
      ) : src.videoPath ? (
        <>
          <div className="rd-card">
            <div className="rd-card__label">素材：视频 {src.videoPath}</div>
            <video className="rd-video" src={sourceVideoUrl(ws)} controls preload="metadata" />
            <div className="rd-row">
              <span className="rd-muted">抽帧间隔：{interval}s（由天枢设定）</span>
              <button className="rd-btn rd-btn--primary" disabled={busy} onClick={() => void doExtract()}>
                {busy ? '抽帧中…' : '开始抽帧'}
              </button>
            </div>
            {busy && (
              <div className="rd-progress">
                <span className="rd-progress__bar">
                  <i style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
                <span className="rd-muted">{message}</span>
              </div>
            )}
            {error && <div className="rd-error">{error}</div>}
          </div>

          {sheet && (
            <div className="rd-card">
              <div className="rd-card__label">宫格总览图（{frames.length} 帧）</div>
              <img className="rd-sheet" src={mediaUrl(ws, sheet.path)} alt="宫格总览" />
            </div>
          )}

          {frames.length > 0 && (
            <div className="rd-card">
              <div className="rd-card__label">逐帧（{frames.length}）</div>
              <div className="rd-grid">
                {frames.map((f) => (
                  <figure key={f.id} className="rd-frame">
                    <img src={mediaUrl(ws, f.path)} alt={`帧 ${f.index}`} loading="lazy" />
                    <figcaption>
                      #{f.index} · {f.tSec.toFixed(1)}s
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rd-card rd-card--empty">尚无素材。请在对话中让天枢调用 redraw_frames_ingest 传入视频或文本剧情。</div>
      )}
    </div>
  )
}
