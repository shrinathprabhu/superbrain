import { useStore, useVault } from '../store/vault'
import { assetClass, formatBytes, titleOf } from '../lib/util'
import { excerpt } from '../lib/markdown'
import type { VaultNode } from '../lib/types'

const ICONS: Record<string, string> = {
  folder: '🗀', note: '📄', image: '🖼', video: '🎬', audio: '🎵', pdf: '📕', file: '📎',
}

function iconFor(node: VaultNode): string {
  if (node.kind === 'folder') return ICONS.folder
  if (node.kind === 'note') return ICONS.note
  return ICONS[assetClass(node.mime, node.name)] ?? ICONS.file
}

/** What a folder route shows: an index of what is inside it. */
export default function FolderView({ folderId, onOpen }: {
  folderId: string | null
  onOpen: (id: string) => void
}) {
  const store = useStore()
  const state = useVault()
  const folder = folderId ? store.node(folderId) : null
  const children = store.children(folderId)

  return (
    <div className="folder-view">
      <header className="folder-head">
        <h2>{folder ? folder.name : state.info?.label}</h2>
        <span className="folder-meta">
          {children.length} item{children.length === 1 ? '' : 's'}
        </span>
        <div className="folder-actions">
          <button type="button" className="ghost small" onClick={() => { void store.createNote(folderId) }}>
            New note
          </button>
          <button type="button" className="ghost small" onClick={() => { void store.createFolder(folderId) }}>
            New folder
          </button>
        </div>
      </header>

      {!children.length ? (
        <p className="panel-empty">This folder is empty. Create a note, or drop files in.</p>
      ) : (
        <ul className="folder-list">
          {children.map(child => (
            <li key={child.id}>
              <button type="button" className="folder-entry" onClick={() => onOpen(child.id)}>
                <span className="folder-entry-icon">{iconFor(child)}</span>
                <span className="folder-entry-body">
                  <span className="folder-entry-name">
                    {child.kind === 'note' ? titleOf(child.name) : child.name}
                  </span>
                  <span className="folder-entry-sub">
                    {child.kind === 'note'
                      ? excerpt(store.body(child.id), 90) || 'Empty note'
                      : child.kind === 'folder'
                        ? `${store.children(child.id).length} items`
                        : `${child.mime ?? 'file'}${child.size ? ` · ${formatBytes(child.size)}` : ''}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
