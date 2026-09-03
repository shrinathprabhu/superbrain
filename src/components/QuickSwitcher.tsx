import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import { cx, titleOf } from '../lib/util'
import { excerpt } from '../lib/markdown'

export default function QuickSwitcher({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const store = useStore()
  const state = useVault()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const notes = state.nodes.filter(n => n.kind !== 'folder' && !n.deletedAt)
    const scored = notes.map(n => {
      const label = n.kind === 'note' ? titleOf(n.name) : n.name
      const path = store.pathFor(n.id)
      const body = n.kind === 'note' ? store.body(n.id) : ''
      if (!q) return { n, label, path, score: 1000 - n.updatedAt / 1e12, snippet: '' }
      const inLabel = label.toLowerCase().indexOf(q)
      const inPath = path.toLowerCase().indexOf(q)
      const inBody = body.toLowerCase().indexOf(q)
      if (inLabel === -1 && inPath === -1 && inBody === -1) return null
      const score = inLabel !== -1 ? inLabel : inPath !== -1 ? 100 + inPath : 1000 + inBody
      const snippet = inLabel === -1 && inBody !== -1
        ? body.slice(Math.max(0, inBody - 40), inBody + 60).replace(/\s+/g, ' ').trim()
        : ''
      return { n, label, path, score, snippet }
    }).filter(Boolean) as { n: typeof notes[number]; label: string; path: string; score: number; snippet: string }[]
    return scored.sort((a, b) => a.score - b.score).slice(0, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, state.rev])

  useEffect(() => { setIndex(0) }, [query])

  const choose = (i: number) => {
    const hit = results[i]
    if (!hit) return
    onOpen(hit.n.id)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Quick switcher">
        <input
          ref={inputRef}
          className="switcher-input"
          placeholder="Jump to a note, or search inside notes…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); choose(index) }
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
        />
        <ul className="switcher-results">
          {results.map((r, i) => (
            <li key={r.n.id}>
              <button
                type="button"
                className={cx('switcher-item', i === index && 'active')}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="switcher-title">{r.label}</span>
                <span className="switcher-path">{r.path}</span>
                {r.snippet && <span className="switcher-snippet">…{r.snippet}…</span>}
                {!r.snippet && r.n.kind === 'note' && (
                  <span className="switcher-snippet dim">{excerpt(store.body(r.n.id), 80)}</span>
                )}
              </button>
            </li>
          ))}
          {!results.length && <li className="switcher-empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  )
}
