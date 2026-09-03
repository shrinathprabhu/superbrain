import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTags, useVault } from '../store/vault'
import { childrenOf, descendantsOf } from '../lib/paths'
import { assetClass, cx, titleOf } from '../lib/util'
import type { VaultNode } from '../lib/types'
import MoveDialog from './MoveDialog'
import ConfirmDialog, { type ConfirmRequest } from './ConfirmDialog'

type DropSpot = { id: string | null; where: 'before' | 'after' | 'inside' }

const ICONS: Record<string, string> = {
  note: '📄', image: '🖼', video: '🎬', audio: '🎵', pdf: '📕', file: '📎',
}

/**
 * A drawn chevron rather than the ▸ character. The glyph rendered far smaller
 * than its font size suggested, and it shared a class with the file emoji, so
 * making it bigger made those bigger too.
 */
function Caret() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 L11 8 L6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function iconFor(node: VaultNode): React.ReactNode {
  if (node.kind === 'folder') return <Caret />
  if (node.kind === 'note') return ICONS.note
  return ICONS[assetClass(node.mime, node.name)] ?? ICONS.file
}

export default function FileTree({ filter, tag, onTag, onOpen, onExportHtml }: {
  filter: string
  tag: string | null
  onTag: (tag: string | null) => void
  /** Selecting goes through the app so unsaved edits get a say first. */
  onOpen: (id: string) => void
  onExportHtml: (id: string) => void
}) {
  const store = useStore()
  const state = useVault()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropSpot | null>(null)
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [menu])

  /** Spells out exactly what a delete takes with it before asking. */
  const askDelete = useCallback((id: string): ConfirmRequest | null => {
    const node = store.node(id)
    if (!node) return null
    const inside = node.kind === 'folder' ? descendantsOf(state.nodes, id) : []
    const counts = [
      ['note', inside.filter(n => n.kind === 'note').length],
      ['folder', inside.filter(n => n.kind === 'folder').length],
      ['file', inside.filter(n => n.kind === 'asset').length],
    ] as const
    return {
      title: `Delete “${node.name}”?`,
      body: node.kind === 'folder'
        ? 'The folder and everything inside it moves to the trash. You can put it back from there.'
        : 'It moves to the trash, so you can put it back from there.',
      details: node.kind === 'folder'
        ? (inside.length
            ? counts.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}${n === 1 ? '' : 's'}`)
            : ['The folder is empty.'])
        : undefined,
      confirmLabel: 'Move to trash',
      tone: 'danger',
      onConfirm: () => { void store.remove(id) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev, store])

  const tags = useTags()
  const tagged = tag ? new Set(tags.find(t => t.tag === tag)?.ids ?? []) : null
  const [showAllTags, setShowAllTags] = useState(false)
  const TAG_PREVIEW = 8

  const query = filter.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!query) return null
    const matched = new Set<string>()
    for (const n of state.nodes) {
      if (n.deletedAt) continue
      const label = n.kind === 'note' ? titleOf(n.name) : n.name
      const hit = label.toLowerCase().includes(query) ||
        (n.kind === 'note' && store.body(n.id).toLowerCase().includes(query))
      if (!hit) continue
      matched.add(n.id)
      let p = n.parentId
      while (p) { matched.add(p); p = state.nodes.find(x => x.id === p)?.parentId ?? null }
    }
    return matched
  }, [query, state.rev, state.nodes, store])

  const handleDrop = useCallback((spot: DropSpot) => {
    if (!dragging) return
    setDrop(null)
    setDragging(null)
    if (spot.id === dragging) return
    if (spot.where === 'inside') {
      void store.move(dragging, spot.id)
    } else {
      const target = spot.id ? store.node(spot.id) : null
      const parentId = target?.parentId ?? null
      if (spot.where === 'before') void store.move(dragging, parentId, spot.id)
      else {
        const siblings = childrenOf(state.nodes, parentId).filter(n => n.id !== dragging)
        const i = siblings.findIndex(n => n.id === spot.id)
        void store.move(dragging, parentId, siblings[i + 1]?.id ?? null)
      }
    }
  }, [dragging, store, state.nodes])

  /** A folder survives a tag filter if anything beneath it carries the tag. */
  const keepsTag = (id: string): boolean => {
    if (!tagged) return true
    if (tagged.has(id)) return true
    return descendantsOf(state.nodes, id).some(n => tagged.has(n.id))
  }

  const rows = (parentId: string | null, depth: number): React.ReactNode[] =>
    store.children(parentId).flatMap(node => {
      if (visible && !visible.has(node.id)) return []
      if (tagged && !keepsTag(node.id)) return []
      const expanded = state.expanded.has(node.id) || Boolean(query)
      const isActive = state.activeId === node.id
      // Folders are routable too, so selecting one is what opens its index;
      // the click also toggles the branch the way a tree is expected to.
      const activate = () => {
        onOpen(node.id)
        if (node.kind === 'folder') store.toggleFolder(node.id)
      }
      const row = (
        <li key={node.id} role="none">
          <div
            role="treeitem"
            tabIndex={0}
            aria-selected={isActive}
            aria-level={depth + 1}
            aria-expanded={node.kind === 'folder' ? expanded : undefined}
            className={cx(
              'tree-row',
              isActive && 'active',
              dragging === node.id && 'dragging',
              drop?.id === node.id && `drop-${drop.where}`,
            )}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable={renaming !== node.id}
            onKeyDown={e => {
              if (renaming === node.id) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
              else if (e.key === 'F2') { e.preventDefault(); setRenaming(node.id) }
              else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                setConfirm(askDelete(node.id))
              } else if (e.key === 'ArrowRight' && node.kind === 'folder' && !expanded) {
                e.preventDefault(); store.toggleFolder(node.id)
              } else if (e.key === 'ArrowLeft' && node.kind === 'folder' && expanded) {
                e.preventDefault(); store.toggleFolder(node.id)
              }
            }}
            onDragStart={e => { setDragging(node.id); e.dataTransfer.effectAllowed = 'move' }}
            onDragEnd={() => { setDragging(null); setDrop(null) }}
            onDragOver={e => {
              if (!dragging || dragging === node.id) return
              e.preventDefault()
              // Without this the container's handler retargets the drop to root.
              e.stopPropagation()
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const y = e.clientY - box.top
              const where: DropSpot['where'] =
                node.kind === 'folder'
                  ? (y < box.height * 0.25 ? 'before' : y > box.height * 0.75 ? 'after' : 'inside')
                  : (y < box.height / 2 ? 'before' : 'after')
              setDrop({ id: node.id, where })
            }}
            onDragLeave={() => setDrop(d => (d?.id === node.id ? null : d))}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); if (drop) handleDrop(drop) }}
            onContextMenu={e => { e.preventDefault(); setMenu({ id: node.id, x: e.clientX, y: e.clientY }) }}
            onClick={activate}
          >
            <span
              className={cx(
                'tree-icon',
                node.kind === 'folder' && 'caret',
                node.kind === 'folder' && expanded && 'open',
              )}
            >{iconFor(node)}</span>
            {renaming === node.id ? (
              <RenameInput
                initial={node.kind === 'note' ? titleOf(node.name) : node.name}
                onCancel={() => setRenaming(null)}
                onCommit={name => { setRenaming(null); void store.rename(node.id, name) }}
              />
            ) : (
              <span className="tree-label">{node.kind === 'note' ? titleOf(node.name) : node.name}</span>
            )}
            {node.kind === 'asset' && !store.hasAssetBytes(node.id) && (
              <span className="tree-badge" title="Bytes not stored in the browser. Re-link the file to view it.">detached</span>
            )}
            <button
              type="button"
              className="tree-more"
              title="More actions"
              aria-label={`Actions for ${node.name}`}
              onClick={e => {
                e.stopPropagation()
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ id: node.id, x: box.right, y: box.bottom + 2 })
              }}
            >⋯</button>
          </div>
          {node.kind === 'folder' && expanded && (
            <ul role="group" className="tree-children">{rows(node.id, depth + 1)}</ul>
          )}
        </li>
      )
      return [row]
    })

  return (
    <div
      className="tree"
      onDragOver={e => { if (dragging) { e.preventDefault(); setDrop({ id: null, where: 'inside' }) } }}
      onDrop={e => { e.preventDefault(); if (drop) handleDrop(drop) }}
      onContextMenu={e => {
        if (e.target === e.currentTarget) { e.preventDefault(); setMenu({ id: null, x: e.clientX, y: e.clientY }) }
      }}
    >
      {tags.length > 0 && (
        <div className="tag-bar">
          {tag && (
            <button type="button" className="tag-chip on" onClick={() => onTag(null)}>
              #{tag} <span aria-hidden="true">×</span>
            </button>
          )}
          {!tag && (showAllTags ? tags : tags.slice(0, TAG_PREVIEW)).map(entry => (
            <button
              key={entry.tag}
              type="button"
              className="tag-chip"
              title={`${entry.ids.length} note${entry.ids.length === 1 ? '' : 's'}`}
              onClick={() => onTag(entry.tag)}
            >
              #{entry.tag}<span className="tag-count">{entry.ids.length}</span>
            </button>
          ))}
          {!tag && tags.length > TAG_PREVIEW && (
            <button
              type="button"
              className="tag-chip more"
              onClick={() => setShowAllTags(v => !v)}
            >
              {showAllTags ? 'Show fewer' : `+${tags.length - TAG_PREVIEW} more`}
            </button>
          )}
        </div>
      )}
      <ul role="tree" aria-label="Notes" className={cx('tree-root', drop?.id === null && 'drop-inside')}>
        {rows(null, 0)}
      </ul>
      {!state.nodes.length && <p className="tree-empty">Nothing here yet. Drop a folder of markdown files, or create a note.</p>}
      {moving && <MoveDialog nodeId={moving} onClose={() => setMoving(null)} />}
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      {menu && (
        <TreeMenu
          id={menu.id}
          x={menu.x}
          y={menu.y}
          onRename={id => setRenaming(id)}
          onMove={id => setMoving(id)}
          onDelete={id => setConfirm(askDelete(id))}
          onExportHtml={onExportHtml}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function RenameInput({ initial, onCommit, onCancel }: {
  initial: string; onCommit: (v: string) => void; onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])
  return (
    <input
      ref={ref}
      className="tree-rename"
      defaultValue={initial}
      onClick={e => e.stopPropagation()}
      onBlur={e => onCommit(e.currentTarget.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(e.currentTarget.value) }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
    />
  )
}

function TreeMenu({ id, x, y, onRename, onMove, onDelete, onExportHtml, onClose }: {
  id: string | null; x: number; y: number
  onRename: (id: string) => void
  onMove: (id: string) => void
  onDelete: (id: string) => void
  onExportHtml: (id: string) => void
  onClose: () => void
}) {
  const store = useStore()
  const node = id ? store.node(id) : null
  const parentForNew = node ? (node.kind === 'folder' ? node.id : node.parentId) : null

  const item = (label: string, run: () => void, danger = false) => (
    <button type="button" className={cx('menu-item', danger && 'danger')} onClick={() => { run(); onClose() }}>
      {label}
    </button>
  )

  return (
    <div className="menu" style={{ left: Math.min(x, window.innerWidth - 220), top: y }} onClick={e => e.stopPropagation()}>
      {item('New note', () => { void store.createNote(parentForNew) })}
      {item('New folder', () => { void store.createFolder(parentForNew) })}
      {node && <div className="menu-sep" />}
      {node && item('Rename', () => onRename(node.id))}
      {node && item('Move to…', () => onMove(node.id))}
      {node && node.kind === 'note' && item('Save as HTML…', () => onExportHtml(node.id))}
      {node && node.kind !== 'folder' && item('Duplicate', () => {
        void store.createNote(node.parentId, `${titleOf(node.name)} copy`, store.body(node.id))
      })}
      {node && <div className="menu-sep" />}
      {node && item(`Delete ${node.kind}…`, () => onDelete(node.id), true)}
    </div>
  )
}
