/**
 * 步骤 2 · 风格与本土化。
 */
import type { ApiProject } from '../api'

export function LocalizeStep({ project }: { project: ApiProject | null }) {
  if (!project) return <div className="rd-step">加载中…</div>
  const loc = project.localization
  const style = project.style
  const c = loc.report?.checklist

  return (
    <div className="rd-step">
      <header className="rd-step__head">
        <h2>2 · 风格与本土化</h2>
        <p className="rd-step__desc">确定转绘风格（动漫/日系/欧美/国风…）与目标地区文化要素。由天枢在对话中确定并写入。</p>
      </header>

      <div className="rd-card">
        <div className="rd-card__label">转绘风格</div>
        {style.styleId ? (
          <>
            <div className="rd-kv">
              <span>风格 ID</span>
              <b>{style.styleId}</b>
            </div>
            <div className="rd-kv">
              <span>提示词片段</span>
              <b className="rd-muted">{style.promptFragment}</b>
            </div>
          </>
        ) : (
          <div className="rd-muted">尚未锁定风格。让天枢调用 redraw_style_list / redraw_style_set。</div>
        )}
      </div>

      <div className="rd-card">
        <div className="rd-card__label">本土化（地区：{loc.region || '未设置'}）</div>
        {c ? (
          <div className="rd-checklist">
            <Row k="服饰" v={c.costume} />
            <Row k="建筑" v={c.architecture} />
            <Row k="节日习俗" v={c.festival} />
            <Row k="禁忌" v={c.taboos} />
            <Row k="色彩偏好" v={c.colorPreference} />
            {c.notes ? <Row k="备注" v={c.notes} /> : null}
          </div>
        ) : (
          <div className="rd-muted">尚未生成结构化本土化报告。</div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="rd-checklist__row">
      <span className="rd-checklist__k">{k}</span>
      <span className="rd-checklist__v">{v || '—'}</span>
    </div>
  )
}
