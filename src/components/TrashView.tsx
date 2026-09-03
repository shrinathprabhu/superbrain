import { useState } from 'react'
import { useStore, useVault } from '../store/vault'
import ConfirmDialog, { type ConfirmRequest } from './ConfirmDialog'
import { assetClass, titleOf } from '../lib/util'
import type { VaultNode } from '../lib/types'

const ICONS: Record<string, string> = {
  folder: '🗀', note: '📄', image: '🖼', video: '🎬', audio: '🎵', pdf: '📕', file: '📎',
}

function iconFor(node: VaultNode): string {
  if (node.kind === 'folder') return ICONS.folder
  if (node.kind === 'note') return ICONS.note
  return ICONS[assetClass(node.mime, node.name)] ?? ICONS.file
}

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * What was deleted, and the way back.
 *
 * Only the top of each deleted branch is listed: deleting a folder trashes
 * everything inside it, and showing all of that would bury the one row you
 * actually want to put back.
 */
export default function TrashView({ onOpen }: { onOpen: (id: string) => void }) {
  const store = useStore()
  const state = useVault()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const all = store.trashed()
  const roots = all.filter(n => !n.parentId || !store.node(n.parentId)?.deletedAt)

  const countUnder = (id: string) => all.filter(n => {
    let cursor = n.parentId ? store.node(n.parentId) : null
    while (cursor) {
      if (cursor.id === id) return true
      cursor = cursor.parentId ? store.node(cursor.parentId) : null
    }
    return false
  }).length

  return (
    <div className="folder-view trash-view">
      <header className="folder-head">
        <h2>Trash</h2>
        <span className="folder-meta">
          {roots.length ? `${roots.length} item${roots.length === 1 ? '' : 's'}` : 'Empty'}
        </span>
        {roots.length > 0 && (
          <div className="folder-actions">
            <button
              type="button"
              className="ghost small danger-text"
              onClick={() => setConfirm({
                title: 'Empty the trash?',
                body: 'Everything here is deleted for good. This one cannot be undone.',
                details: [`${all.length} item${all.length === 1 ? '' : 's'} in total`],
                confirmLabel: 'Delete everything',
                tone: 'danger',
                onConfirm: () => { void store.emptyTrash() },
              })}
            >
              Empty trash
            </button>
          </div>
        )}
      </header>

      {!roots.length ? (
        <p className="panel-empty">
          Nothing has been deleted. Anything you remove lands here first, so you can put it
          back.
        </p>
      ) : (
        <ul className="folder-list">
          {roots.map(node => {
            const inside = node.kind === 'folder' ? countUnder(node.id) : 0
            return (
              <li key={node.id}>
                <span className="folder-entry trash-entry">
                  <span className="folder-entry-icon">{iconFor(node)}</span>
                  <span className="folder-entry-body">
                    <span className="folder-entry-name">
                      {node.kind === 'note' ? titleOf(node.name) : node.name}
                    </span>
                    <span className="folder-entry-sub">
                      Deleted {ago(node.deletedAt ?? 0)}
                      {inside ? ` · ${inside} item${inside === 1 ? '' : 's'} inside` : ''}
                    </span>
                  </span>
                  <span className="trash-actions">
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => {
                        void store.restore(node.id).then(() => {
                          if (node.kind === 'note') onOpen(node.id)
                        })
                      }}
                    >
                      Put back
                    </button>
                    <button
                      type="button"
                      className="ghost small danger-text"
                      onClick={() => setConfirm({
                        title: `Delete “${node.name}” for good?`,
                        body: 'This one cannot be undone.',
                        details: inside ? [`${inside} item${inside === 1 ? '' : 's'} inside`] : undefined,
                        confirmLabel: 'Delete for good',
                        tone: 'danger',
                        onConfirm: () => { void store.purge(node.id) },
                      })}
                    >
                      Delete for good
                    </button>
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      <p className="trash-note">
        {state.info?.mode === 'fs'
          ? 'Deleted files are parked inside the .superbrain folder, so your working folder stays clean while the bytes are still there.'
          : 'Deleted notes stay in this browser until you empty the trash.'}
      </p>
    </div>
  )
}
