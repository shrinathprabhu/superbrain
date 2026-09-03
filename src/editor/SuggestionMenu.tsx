import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SuggestionController } from './suggestions'
import { cx } from '../lib/util'

export default function SuggestionMenu({ controller }: { controller: SuggestionController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [index, setIndexState] = useState(0)
  // The key handler runs outside React's render, so it reads the index from a
  // ref rather than from state it cannot see synchronously.
  const indexRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  const setIndex = (next: number) => {
    indexRef.current = next
    setIndexState(next)
  }

  useEffect(() => { setIndex(0) }, [state?.query, state?.items.length])

  useEffect(() => {
    controller.keydown = (event: KeyboardEvent) => {
      const snapshot = controller.getSnapshot()
      const items = snapshot?.items ?? []
      if (!items.length) return false
      if (event.key === 'ArrowDown') { setIndex((indexRef.current + 1) % items.length); return true }
      if (event.key === 'ArrowUp') { setIndex((indexRef.current - 1 + items.length) % items.length); return true }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[Math.min(indexRef.current, items.length - 1)]
        if (item) snapshot?.select(item)
        return true
      }
      return false
    }
    return () => { controller.keydown = null }
  }, [controller])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!state || !state.items.length || !state.rect) return null
  const { rect } = state
  const top = rect.bottom + 6
  const flip = top + 280 > window.innerHeight
  const style: React.CSSProperties = {
    left: Math.min(rect.left, window.innerWidth - 320),
    ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top }),
  }

  return (
    <div className="suggest" style={style} ref={listRef} role="listbox">
      {state.items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === index}
          data-active={i === index}
          className={cx('suggest-item', i === index && 'active')}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={e => { e.preventDefault(); state.select(item) }}
        >
          <span className="suggest-title">{item.title}</span>
          {item.subtitle && <span className="suggest-sub">{item.subtitle}</span>}
          {item.hint && <span className="suggest-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}
