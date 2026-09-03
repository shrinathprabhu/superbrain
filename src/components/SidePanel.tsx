import { useMemo, useState } from 'react'
import { useLinkGraph, useStore, useVault } from '../store/vault'
import { cx, titleOf } from '../lib/util'
import { excerpt, headings } from '../lib/markdown'
import { tldr } from '../lib/tldr'

type Tab = 'comments' | 'links' | 'outline' | 'tldr'

export default function SidePanel({ noteId, onOpen }: { noteId: string; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('comments')
  const state = useVault()
  const mine = state.comments.filter(c => c.noteId === noteId)
  const links = useLinkGraph()
  const incoming = links.incoming.get(noteId)?.length ?? 0

  return (
    <aside className="side-panel">
      <div className="panel-tabs" role="tablist">
        {(['comments', 'links', 'outline', 'tldr'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={cx('panel-tab', tab === t && 'on')}
            onClick={() => setTab(t)}
          >
            {t === 'comments' ? `Comments${mine.length ? ` (${mine.length})` : ''}`
              : t === 'links' ? `Links${incoming ? ` (${incoming})` : ''}`
              : t === 'outline' ? 'Outline'
              : 'TL;DR'}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'comments' && <Comments noteId={noteId} />}
        {tab === 'links' && <Links noteId={noteId} onOpen={onOpen} />}
        {tab === 'outline' && <Outline noteId={noteId} />}
        {tab === 'tldr' && <Tldr noteId={noteId} />}
      </div>
    </aside>
  )
}

function Comments({ noteId }: { noteId: string }) {
  const store = useStore()
  const state = useVault()
  const [editing, setEditing] = useState<string | null>(null)
  const comments = state.comments
    .filter(c => c.noteId === noteId)
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.createdAt - a.createdAt)

  if (!comments.length) {
    return (
      <p className="panel-empty">
        No comments yet. Select text in the note and hit <kbd>⌘⇧M</kbd> (or the 💬 button) to leave one.
      </p>
    )
  }

  return (
    <ul className="comment-list">
      {comments.map(c => (
        <li key={c.id} className={cx('comment', c.resolved && 'resolved')}>
          <blockquote className="comment-quote">{c.quote}</blockquote>
          {editing === c.id ? (
            <textarea
              className="comment-edit"
              defaultValue={c.body}
              autoFocus
              onBlur={e => { store.updateComment(c.id, { body: e.currentTarget.value }); setEditing(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <p className="comment-body" onDoubleClick={() => setEditing(c.id)}>{c.body}</p>
          )}
          <div className="comment-actions">
            <time>{new Date(c.createdAt).toLocaleString()}</time>
            <button type="button" onClick={() => store.updateComment(c.id, { resolved: !c.resolved })}>
              {c.resolved ? 'Reopen' : 'Resolve'}
            </button>
            <button type="button" onClick={() => setEditing(c.id)}>Edit</button>
            <button type="button" className="danger" onClick={() => store.removeComment(c.id)}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Links({ noteId, onOpen }: { noteId: string; onOpen: (id: string) => void }) {
  const store = useStore()
  const graph = useLinkGraph()
  const state = useVault()

  const incoming = graph.incoming.get(noteId) ?? []
  const outgoing = graph.outgoing.get(noteId) ?? []
  const label = (id: string) => {
    const n = store.node(id)
    return n ? (n.kind === 'note' ? titleOf(n.name) : n.name) : 'Unknown'
  }

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const ref of incoming) {
      const list = map.get(ref.fromId) ?? []
      list.push(contextFor(store.body(ref.fromId), ref.link.start))
      map.set(ref.fromId, list)
    }
    return [...map.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, state.rev])

  return (
    <div className="links-panel">
      <h3>Linked from ({incoming.length})</h3>
      {!grouped.length && <p className="panel-empty">Nothing links here yet.</p>}
      <ul className="link-list">
        {grouped.map(([fromId, contexts]) => (
          <li key={fromId}>
            <button type="button" className="link-title" onClick={() => onOpen(fromId)}>{label(fromId)}</button>
            {contexts.map((c, i) => <p key={i} className="link-context">…{c}…</p>)}
          </li>
        ))}
      </ul>

      <h3>Links out ({outgoing.length})</h3>
      <ul className="link-list">
        {outgoing.map((ref, i) => (
          <li key={i}>
            {ref.toId ? (
              <button type="button" className="link-title" onClick={() => onOpen(ref.toId!)}>{label(ref.toId)}</button>
            ) : (
              <span className="link-title broken" title="This link does not resolve to anything in this vault">
                {ref.missing} <em>(unresolved)</em>
              </span>
            )}
          </li>
        ))}
        {!outgoing.length && <p className="panel-empty">This note doesn’t link anywhere yet.</p>}
      </ul>
    </div>
  )
}

function contextFor(md: string, at: number, span = 70): string {
  const from = Math.max(0, at - span)
  return md.slice(from, at + span).replace(/\s+/g, ' ').trim()
}

function Outline({ noteId }: { noteId: string }) {
  const store = useStore()
  const state = useVault()
  const items = useMemo(
    () => headings(store.body(noteId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId, state.rev],
  )

  if (!items.length) {
    return (
      <p className="panel-empty">
        No headings in this note.<br />{excerpt(store.body(noteId), 120)}
      </p>
    )
  }

  /**
   * The parsed list and the rendered headings are both in document order and
   * both skip fenced code, so the nth entry is the nth heading element.
   */
  const jumpTo = (index: number) => {
    const rendered = document.querySelectorAll<HTMLElement>(
      '.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6',
    )
    const target = rendered[index]
    if (!target) return

    // Smooth scrolling is an animation: it does nothing when motion is turned
    // down, which would leave the click doing nothing at all.
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })

    // Driven directly rather than through a class: the heading belongs to
    // ProseMirror, which is free to re-render the node and drop our class.
    if (!smooth) return
    target.animate(
      [
        { backgroundColor: 'var(--accent-soft)', boxShadow: '0 0 0 5px var(--accent-soft)' },
        { backgroundColor: 'var(--accent-soft)', boxShadow: '0 0 0 5px var(--accent-soft)', offset: 0.55 },
        { backgroundColor: 'transparent', boxShadow: '0 0 0 5px transparent' },
      ],
      { duration: 1100, easing: 'ease-out' },
    )
  }

  const min = Math.min(...items.map(h => h.level))

  return (
    <ul className="outline">
      {items.map((h, i) => (
        <li key={i}>
          <button
            type="button"
            className={cx('outline-link', `h${h.level}`)}
            style={{ paddingLeft: (h.level - min) * 12 }}
            title={h.text}
            onClick={() => jumpTo(i)}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * A summary produced on the spot from the note's own sentences — no model
 * involved, so it works offline and never sends the note anywhere. See
 * lib/tldr.ts for how sentences are ranked.
 */
function Tldr({ noteId }: { noteId: string }) {
  const store = useStore()
  const state = useVault()
  const [limit, setLimit] = useState(5)
  const result = useMemo(
    () => tldr(store.body(noteId), limit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId, limit, state.rev],
  )

  if (!result.points.length) {
    return <p className="panel-empty">Not enough prose in this note to summarise yet.</p>
  }

  const complete = result.considered <= limit

  return (
    <div className="tldr">
      <div className="tldr-bar">
        <span>
          {complete
            ? `The whole note, ${result.words} words`
            : `${result.points.length} of ${result.considered} sentences · ${result.words} words`}
        </span>
        <span className="tldr-steps">
          <button
            type="button"
            className="icon-btn"
            title="Fewer points"
            disabled={limit <= 3}
            onClick={() => setLimit(l => Math.max(3, l - 2))}
          >−</button>
          <button
            type="button"
            className="icon-btn"
            title="More points"
            disabled={complete || limit >= 11}
            onClick={() => setLimit(l => Math.min(11, l + 2))}
          >+</button>
        </span>
      </div>
      <ul className="tldr-list">
        {result.points.map((point, i) => (
          <li key={i}>
            {point.section && <span className="tldr-section">{point.section}</span>}
            <p>{point.text}</p>
          </li>
        ))}
      </ul>
      <p className="tldr-note">
        Picked from the note's own sentences by word frequency and structure. Nothing is
        generated, and nothing leaves this device.
      </p>
    </div>
  )
}
