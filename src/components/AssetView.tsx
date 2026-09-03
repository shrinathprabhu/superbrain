import { useRef } from 'react'
import { useAssetUrl, useStore, useVault } from '../store/vault'
import { assetClass, formatBytes, ACCEPT_MEDIA_ATTR } from '../lib/util'
import type { VaultNode } from '../lib/types'

export default function AssetView({ node }: { node: VaultNode }) {
  const store = useStore()
  const state = useVault()
  const url = useAssetUrl(node.id)
  const input = useRef<HTMLInputElement>(null)
  const kind = assetClass(node.mime, node.name)

  return (
    <div className="asset-view">
      <header className="asset-head">
        <h2>{node.name}</h2>
        <span className="asset-meta">
          {node.mime ?? 'unknown type'}
          {node.size ? ` · ${formatBytes(node.size)}` : ''}
          {state.info?.assetsPersist ? '' : ' · not stored in the browser'}
        </span>
      </header>

      {url ? (
        <div className="asset-frame">
          {kind === 'image' && <img src={url} alt={node.name} />}
          {kind === 'video' && <video src={url} controls />}
          {kind === 'audio' && <audio src={url} controls />}
          {kind === 'pdf' && <iframe src={url} title={node.name} />}
          {kind === 'file' && (
            <p className="panel-empty">
              No preview for this file type. <a href={url} download={node.name}>Download it</a> instead.
            </p>
          )}
        </div>
      ) : (
        <div className="asset-relink">
          <p>
            The bytes for this file aren’t loaded. Browser storage deliberately holds notes only,
            so binaries need re-attaching after a reload.
          </p>
          <button type="button" className="primary" onClick={() => input.current?.click()}>
            Re-link “{node.name}”…
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept={ACCEPT_MEDIA_ATTR}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void store.relinkAsset(node.id, file)
            }}
          />
        </div>
      )}
    </div>
  )
}
