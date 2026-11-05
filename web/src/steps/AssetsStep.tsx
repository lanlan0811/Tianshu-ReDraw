/**
 * 步骤 5 · 资产（人物/道具/场景 + 衍生变体）。
 * 先文字设定 + 提示词，再生成资产图；变体以基础图作参考。
 */
import { mediaUrl, type ApiProject, type AssetItem, type AssetKind } from '../api'

const GROUPS: { kind: AssetKind; label: string }[] = [
  { kind: 'character', label: '人物' },
  { kind: 'prop', label: '道具' },
  { kind: 'scene', label: '场景' },
]

export function AssetsStep({ ws, project }: { ws: string; project: ApiProject | null }) {
  if (!project) return <div className="rd-step">加载中…</div>
  const assets = project.assets

  return (
    <div className="rd-step">
      <header className="rd-step__head">
        <h2>5 · 资产</h2>
        <p className="rd-step__desc">人物/道具/场景三类，各含基础设定与衍生变体。先文字后生图；变体用基础图作参考保证一致。</p>
      </header>

      {assets.length === 0 ? (
        <div className="rd-card rd-card--empty">尚无资产。让天枢调用 redraw_assets_upsert 写入设定与提示词。</div>
      ) : (
        <div className="rd-asset-groups">
          {GROUPS.map((g) => {
            const items = assets.filter((a) => a.kind === g.kind)
            return (
              <section key={g.kind} className="rd-asset-group">
                <h3>
                  {g.label} <span className="rd-muted">（{items.length}）</span>
                </h3>
                {items.length === 0 ? (
                  <div className="rd-muted">（无）</div>
                ) : (
                  <div className="rd-asset-list">
                    {items.map((a) => (
                      <AssetCard key={a.id} ws={ws} asset={a} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AssetCard({ ws, asset }: { ws: string; asset: AssetItem }) {
  return (
    <article className="rd-asset">
      <div className="rd-asset__media">
        {asset.baseImage ? (
          <img src={mediaUrl(ws, asset.baseImage.path)} alt={asset.name} loading="lazy" />
        ) : (
          <div className="rd-asset__placeholder">待生成基础图</div>
        )}
      </div>
      <div className="rd-asset__body">
        <div className="rd-asset__name">
          {asset.name} <span className={`rd-tag is-${asset.status}`}>{asset.status}</span>
        </div>
        {asset.spec && <div className="rd-muted rd-asset__spec">{asset.spec}</div>}
        {asset.prompt && <div className="rd-asset__prompt" title={asset.prompt}>{asset.prompt}</div>}
        {asset.variants.length > 0 && (
          <div className="rd-variants">
            {asset.variants.map((v) => (
              <div key={v.id} className="rd-variant" title={v.prompt}>
                {v.image ? <img src={mediaUrl(ws, v.image.path)} alt={v.name} loading="lazy" /> : <span className="rd-variant__ph" />}
                <span className="rd-variant__name">{v.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
