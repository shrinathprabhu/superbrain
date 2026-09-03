import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useEditorEnv } from './env'
import { assetClass } from '../lib/util'
import { EXTERNAL } from '../lib/markdown'

/**
 * Renders `![alt](path)` where `path` is vault-relative. `src` in the node keeps
 * the authored path so serialising back to markdown is lossless.
 */
export default function MediaView({ node, selected }: NodeViewProps) {
  const env = useEditorEnv()
  const src = String(node.attrs.src ?? '')
  const alt = String(node.attrs.alt ?? '')
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    if (!src) { setUrl(null); return }
    if (EXTERNAL.test(src)) { setUrl(src); setMissing(false); return }
    const hit = env.resolve(src)
    if (!hit) { setUrl(null); setMissing(true); return }
    void env.assetUrl(hit.id).then(u => {
      if (!live) return
      setUrl(u)
      setMissing(!u)
    })
    return () => { live = false }
  }, [src, env])

  const hit = EXTERNAL.test(src) ? null : env.resolve(src)
  const kind = assetClass(hit?.mime, hit?.name ?? src)
  const cls = `media-host${selected ? ' selected' : ''}`

  if (missing || !url) {
    return (
      <NodeViewWrapper className={cls} data-drag-handle>
        <div className="asset-missing" contentEditable={false}>
          <strong>{alt || src.split('/').pop()}</strong>
          <span>{hit ? 'Bytes not loaded in this session' : 'File not found in this vault'}</span>
          <code>{src}</code>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className={cls} data-drag-handle>
      {kind === 'video' ? (
        <video src={url} controls />
      ) : kind === 'audio' ? (
        <audio src={url} controls />
      ) : kind === 'pdf' ? (
        <iframe src={url} title={alt || src} className="pdf-embed" />
      ) : (
        <img src={url} alt={alt} title={String(node.attrs.title ?? '')} />
      )}
      {alt && <span className="media-caption">{alt}</span>}
    </NodeViewWrapper>
  )
}
