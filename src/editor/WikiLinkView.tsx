import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEditorEnv } from './env'
import { useEffect, useState } from 'react'
import { assetClass, titleOf } from '../lib/util'

export default function WikiLinkView({ node }: NodeViewProps) {
  const env = useEditorEnv()
  const target = String(node.attrs.target ?? '')
  const alias = node.attrs.alias as string | null
  const embed = Boolean(node.attrs.embed)
  const hit = env.resolve(target)

  if (!hit) {
    return (
      <NodeViewWrapper as="span" className="wikilink-host">
        <button
          type="button"
          className="wikilink broken"
          title={`"${target}" does not exist yet. Click to create it.`}
          onClick={() => env.createMissing(target)}
          contentEditable={false}
        >
          {alias || target}
        </button>
      </NodeViewWrapper>
    )
  }

  if (embed && hit.kind === 'asset') {
    return (
      <NodeViewWrapper as="span" className="embed-host">
        <EmbeddedAsset id={hit.id} name={hit.name} mime={hit.mime} />
      </NodeViewWrapper>
    )
  }

  if (embed && hit.kind === 'note') {
    return (
      <NodeViewWrapper as="span" className="embed-host">
        <div className="note-embed" contentEditable={false}>
          <button type="button" className="note-embed-title" onClick={() => env.open(hit.id)}>
            {titleOf(hit.name)}
          </button>
          <p className="note-embed-body">{env.excerptOf(hit.id) || 'Empty note'}</p>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="span" className="wikilink-host">
      <button
        type="button"
        className="wikilink"
        title={target}
        onClick={() => env.open(hit.id)}
        contentEditable={false}
      >
        {alias || (hit.kind === 'note' ? titleOf(hit.name) : hit.name)}
      </button>
    </NodeViewWrapper>
  )
}

function EmbeddedAsset({ id, name, mime }: { id: string; name: string; mime?: string }) {
  const env = useEditorEnv()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void env.assetUrl(id).then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [id, env])

  const kind = assetClass(mime, name)
  if (!url) return <div className="asset-missing" contentEditable={false}>Bytes for “{name}” aren’t loaded. <em>Re-link the file to see it.</em></div>
  if (kind === 'image') return <img src={url} alt={name} contentEditable={false} />
  if (kind === 'video') return <video src={url} controls contentEditable={false} />
  if (kind === 'audio') return <audio src={url} controls contentEditable={false} />
  if (kind === 'pdf') return <iframe src={url} title={name} className="pdf-embed" contentEditable={false} />
  return <a href={url} download={name} contentEditable={false}>{name}</a>
}
