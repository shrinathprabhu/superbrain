import { useEffect } from 'react'
import { cx } from '../lib/util'

export interface Toast {
  id: string
  tone: 'info' | 'warn' | 'error'
  message: string
  /** An offer attached to the toast. One that asks something waits for an answer. */
  action?: { label: string; run: () => void }
}

export default function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const expiring = toasts.filter(t => !t.action)
    if (!expiring.length) return
    const timers = expiring.map(t => setTimeout(() => onDismiss(t.id), t.tone === 'error' ? 12_000 : 7_000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, onDismiss])

  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={cx('toast', t.tone)}>
          <span>{t.message}</span>
          {t.action && (
            <button type="button" className="toast-action" onClick={t.action.run}>{t.action.label}</button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
