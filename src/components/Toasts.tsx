import { useEffect } from 'react'
import { cx } from '../lib/util'

export interface Toast {
  id: string
  tone: 'info' | 'warn' | 'error'
  message: string
}

export default function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.map(t => setTimeout(() => onDismiss(t.id), t.tone === 'error' ? 12_000 : 7_000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, onDismiss])

  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={cx('toast', t.tone)}>
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
