import { useMemo, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import { parseCsv, fingerprintRow } from '../lib/csv'
import { formatBytes, cx } from '../lib/util'
import type { ReviewStatus, VaultNode } from '../lib/types'

/**
 * A .csv as a read-only grid with a review column.
 *
 * The file is never written. Status and comment are the only editable things
 * on screen and they live in the vault's metadata, so the table on disk stays
 * exactly as it was imported.
 */

/** Past this, a single render would stall the tab; the rest is still on disk. */
const MAX_ROWS = 5000

type Filter = 'all' | 'todo' | 'done' | 'declined'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To review' },
  { id: 'done', label: 'Done' },
  { id: 'declined', label: 'Declined' },
]

export default function TableView({ node }: { node: VaultNode }) {
  const store = useStore()
  const state = useVault()
  const [filter, setFilter] = useState<Filter>('all')

  const text = store.body(node.id)
  const table = useMemo(() => parseCsv(text), [text])

  // Marks for this file only, by row, plus the fingerprint each was made against.
  const marks = useMemo(() => {
    const by = new Map<number, { status: ReviewStatus | null; comment: string; fingerprint: string }>()
    for (const r of state.reviews) {
      if (r.tableId === node.id) by.set(r.row, { status: r.status, comment: r.comment, fingerprint: r.fingerprint })
    }
    return by
  }, [state.reviews, node.id])

  const prints = useMemo(() => table.rows.map(fingerprintRow), [table])

  const reviewed = useMemo(
    () => table.rows.reduce((n, _r, i) => (marks.get(i)?.status ? n + 1 : n), 0),
    [table, marks],
  )

  const visible = useMemo(() => {
    const all = table.rows.map((cells, i) => ({ cells, i }))
    if (filter === 'all') return all
    return all.filter(({ i }) => {
      const status = marks.get(i)?.status ?? null
      return filter === 'todo' ? status === null : status === filter
    })
  }, [table, marks, filter])

  const shown = visible.slice(0, MAX_ROWS)

  function mark(row: number, status: ReviewStatus) {
    const current = marks.get(row)?.status ?? null
    // Pressing the status a row already has clears it, so a mistake is undoable
    // without a third button.
    store.setReview(node.id, row, prints[row], { status: current === status ? null : status })
  }

  function comment(row: number, value: string) {
    if ((marks.get(row)?.comment ?? '') === value) return
    store.setReview(node.id, row, prints[row], { comment: value })
  }

  if (!table.columns.length) {
    return (
      <div className="table-view">
        <header className="table-head"><h2>{node.name}</h2></header>
        <p className="panel-empty">This file has no readable rows.</p>
      </div>
    )
  }

  return (
    <div className="table-view">
      <header className="table-head">
        <div className="table-title">
          <h2>{node.name}</h2>
          <span className="table-meta">
            {table.rows.length} row{table.rows.length === 1 ? '' : 's'} · {table.columns.length} columns
            {node.size ? ` · ${formatBytes(node.size)}` : ''} · read-only
          </span>
        </div>

        <div className="table-progress" title={`${reviewed} of ${table.rows.length} rows marked`}>
          <div className="table-bar">
            <span style={{ width: `${table.rows.length ? (reviewed / table.rows.length) * 100 : 0}%` }} />
          </div>
          <span className="table-count">{reviewed}/{table.rows.length}</span>
        </div>

        <div className="table-filters" role="group" aria-label="Filter rows">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              className={cx('table-filter', filter === f.id && 'on')}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {!shown.length ? (
        <p className="panel-empty">No rows match this filter.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-n" scope="col">#</th>
                <th className="col-status" scope="col">Status</th>
                <th className="col-comment" scope="col">Comment</th>
                {table.columns.map((name, i) => (
                  <th key={i} scope="col" title={name}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ cells, i }) => {
                const m = marks.get(i)
                const drifted = m && m.fingerprint !== prints[i]
                return (
                  <tr key={i} className={cx(m?.status && `is-${m.status}`)}>
                    <th className="col-n" scope="row">{i + 1}</th>

                    <td className="col-status">
                      <div className="status-set">
                        <button
                          type="button"
                          className={cx('status-btn done', m?.status === 'done' && 'on')}
                          aria-pressed={m?.status === 'done'}
                          onClick={() => mark(i, 'done')}
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          className={cx('status-btn declined', m?.status === 'declined' && 'on')}
                          aria-pressed={m?.status === 'declined'}
                          onClick={() => mark(i, 'declined')}
                        >
                          Declined
                        </button>
                      </div>
                      {drifted && (
                        <span className="row-drift" title="This row has changed since it was marked.">
                          changed
                        </span>
                      )}
                    </td>

                    <td className="col-comment">
                      {/* Uncontrolled: committing per keystroke would re-render
                          every cell in the grid. `key` resets it if the row moves. */}
                      <input
                        key={`${i}:${m?.comment ?? ''}`}
                        type="text"
                        className="row-comment"
                        defaultValue={m?.comment ?? ''}
                        placeholder="Reason…"
                        aria-label={`Comment for row ${i + 1}`}
                        onBlur={e => comment(i, e.target.value.trim())}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') {
                            e.currentTarget.value = m?.comment ?? ''
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    </td>

                    {cells.map((cell, c) => (
                      <td key={c} title={cell || undefined}>
                        <span className="cell">{cell}</span>
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {visible.length > shown.length && (
            <p className="panel-empty">
              Showing the first {MAX_ROWS.toLocaleString()} of {visible.length.toLocaleString()} matching rows.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
