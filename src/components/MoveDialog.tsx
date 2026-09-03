import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import { buildIndex, isDescendant } from '../lib/paths'
import { cx, titleOf } from '../lib/util'

/** Keyboard- and touch-friendly alternative to dragging a node in the tree. */
export default function MoveDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const store = useStore()
  const state = useVault()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const node = store.node(nodeId)

  useEffect(() => { inputRef.current?.focus() }, [])

  const targets = useMemo(() => {
    const tree = buildIndex(state.nodes)
    const folders = state.nodes.filter(
      n => n.kind === 'folder' && n.id !== nodeId && !isDescendant(tree, n.id, nodeId),
    )
    const rows = [
      { id: null as string | null, label: state.info?.label ?? 'Vault root', path: '/' },
      ...folders.map(f => ({ id: f.id, label: f.name, path: store.pathFor(f.id) })),
    ].filter(r => r.id !== (node?.parentId ?? null))
    const q = query.trim().toLowerCase()
    return q ? rows.filter(r => `${r.label} ${r.path}`.toLowerCase().includes(q)) : rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev, query, nodeId])

  useEffect(() => { setIndex(0) }, [query])
  if (!node) return null

  const choose = (i: number) => {
    const target = targets[i]
    if (target === undefined) return
    void store.move(nodeId, target.id)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Move to folder">
        <input
          ref={inputRef}
          className="switcher-input"
          placeholder={`Move “${node.kind === 'note' ? titleOf(node.name) : node.name}” to…`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, targets.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); choose(index) }
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
        />
        <ul className="switcher-results">
          {targets.map((t, i) => (
            <li key={t.id ?? '__root__'}>
              <button
                type="button"
                className={cx('switcher-item', i === index && 'active')}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="switcher-title">{t.label}</span>
                <span className="switcher-path">{t.path}</span>
              </button>
            </li>
          ))}
          {!targets.length && <li className="switcher-empty">No folder matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  )
}
