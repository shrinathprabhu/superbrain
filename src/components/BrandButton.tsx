import { useEffect, useId, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import BrandMark from './BrandMark'
import { PROMISES } from './promises'

/**
 * The book's name in the top bar, doubling as the place the product explains
 * itself and the place the name gets changed.
 *
 * Opened by click, not hover. Hover does not exist on a touch screen, and the
 * panel holds buttons, so it has to be reachable by tapping and by keyboard.
 * It is a disclosure: the trigger owns `aria-expanded`, Escape closes it and
 * hands focus back, and a press anywhere outside dismisses it.
 */
export default function BrandButton({ onSettings }: { onSettings: () => void }) {
  const store = useStore()
  const state = useVault()
  const [renaming, setRenaming] = useState(false)
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!renaming) return
    field.current?.select()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRenaming(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renaming])

  const startRename = () => { setRenaming(true); setOpen(false) }
  const commit = (value: string) => {
    setRenaming(false)
    void store.renameOpenVault(value)
  }

  const onDisk = state.info?.mode === 'fs'

  // While renaming, the name itself becomes the field, in place.
  if (renaming) {
    return (
      <div className="brand">
        <form
          className="brand-rename inline"
          onSubmit={e => {
            e.preventDefault()
            commit(String(new FormData(e.currentTarget).get('label') ?? ''))
          }}
        >
          <BrandMark size={20} className="brand-mark" />
          <input
            ref={field}
            name="label"
            defaultValue={state.info?.label}
            aria-label="Vault name"
            onBlur={e => commit(e.currentTarget.value)}
          />
        </form>
      </div>
    )
  }

  return (
    <div className="brand" ref={host}>
      <button
        ref={trigger}
        type="button"
        className="brand-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${state.info?.label ?? 'Superbrain'}, vault menu`}
        onClick={() => setOpen(o => !o)}
        onDoubleClick={startRename}
        onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); startRename() } }}
      >
        <BrandMark size={20} className="brand-mark" />
        <strong>{state.info?.label ?? 'Superbrain'}</strong>
        <svg className="brand-caret" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 6.5 L8 10.5 L12 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="brand-pop" id={id}>
          <div className="brand-pop-head">
            <span className="brand-pop-name">{state.info?.label}</span>
            <button type="button" className="ghost small" onClick={startRename}>Rename</button>
          </div>
          <p className="brand-pop-lead">
            A markdown vault that runs entirely in this tab.
          </p>
          <ul className="promises compact">
            {PROMISES.map(promise => (
              <li key={promise.title}>
                <span className="promise-icon" aria-hidden="true">{promise.icon}</span>
                <span className="promise-body">
                  <strong>{promise.title}</strong>
                  <em>{promise.detail}</em>
                </span>
              </li>
            ))}
          </ul>
          <div className="brand-pop-where">
            <p>
              {onDisk ? (
                <>Saving to <strong>{state.info?.label}</strong>, a folder on this computer.</>
              ) : (
                <>Saving in this browser. Pictures are not kept here.</>
              )}
            </p>
            <button
              type="button"
              className="ghost small"
              onClick={() => { setOpen(false); onSettings() }}
            >
              Vault settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
