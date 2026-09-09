import { useEffect, useRef, useState } from 'react'
import { useStore, useVault } from '../store/vault'
import type { VaultRef } from '../store/vaults'
import { filesFromDrop, filesFromInput } from '../lib/dropfiles'
import ThemeToggle from './ThemeToggle'
import BrandMark from './BrandMark'
import { PROMISES } from './promises'
import { ACCEPTED_SUMMARY, cx } from '../lib/util'
import { describeSkipped } from '../lib/intake'
import ConfirmDialog, { type ConfirmRequest } from './ConfirmDialog'
import PasswordPrompt, { type PasswordChallenge } from './PasswordPrompt'

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  )
}

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function Welcome() {
  const store = useStore()
  const state = useVault()
  const [recent, setRecent] = useState<VaultRef[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<PasswordChallenge | null>(null)
  /* Held only between a password prompt and the dialog it leads into. */
  const unlocked = useRef<string | null>(null)

  const refreshRecent = () => { void store.recentVaults().then(setRecent) }

  /**
   * Run an action on a vault, asking for the password first when it is locked.
   * The padlock has to mean the vault, not just the reading of it.
   */
  const guardLocked = (ref: VaultRef, intent: {
    title: string
    body: string
    warning?: string
    confirmLabel: string
    tone?: 'danger' | 'normal'
    run: (password?: string) => void
  }) => {
    unlocked.current = null
    if (!ref.encrypted) { intent.run(); return }
    setChallenge({
      title: intent.title,
      body: intent.body,
      warning: intent.warning,
      confirmLabel: intent.confirmLabel,
      tone: intent.tone,
      onSubmit: async password => {
        if (!(await store.verifyVaultPassword(ref, password))) return false
        unlocked.current = password
        intent.run(password)
        return true
      },
    })
  }

  /** Save a book as a .zip without opening it. */
  const exportBook = async (ref: VaultRef, password?: string) => {
    setProblem(null)
    setNotice(null)
    setBusy(`Packing “${ref.label}”…`)
    try {
      const result = await store.exportVaultById(ref, password)
      if (result.ok) {
        setNotice(`Saved “${ref.label}.zip” with ${result.written} file${result.written === 1 ? '' : 's'}.`)
      } else if (result.reason === 'locked' || result.reason === 'password') {
        setProblem(`“${ref.label}” is locked and the password did not open it.`)
      } else if (result.reason === 'denied') {
        setProblem(`Access to the folder for “${ref.label}” wasn't granted, so nothing was exported.`)
      } else {
        setProblem(`There is nothing saved in “${ref.label}” yet.`)
      }
    } finally {
      setBusy(null)
    }
  }
  useEffect(refreshRecent, [store])

  const working = Boolean(busy) || state.status === 'loading'

  /** A name nothing else is using, so a second "New book" is not a reopen. */
  const freeName = (wanted: string) => {
    const taken = new Set(recent.map(r => r.label.trim().toLowerCase()))
    const base = wanted.trim() || 'My vault'
    if (!taken.has(base.toLowerCase())) return base
    for (let n = 2; n < 500; n++) {
      if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
    }
    return `${base} ${Date.now()}`
  }

  /**
   * Everything that starts from this screen lands in a book of its own, never
   * in whichever book happened to be open last. A zip is unpacked first, and if
   * nothing in it qualifies the book is closed again rather than left empty.
   */
  const startInBrowser = async (files: ReturnType<typeof filesFromInput>, name?: string) => {
    if (working) return
    setProblem(null)
    setBusy('Preparing…')
    try {
      if (!files.length) {
        await store.createBrowserVault(freeName(name ?? 'My vault'), true)
        return
      }
      const zips = files.filter(f => /\.zip$/i.test(f.file.name))
      const rest = files.filter(f => !/\.zip$/i.test(f.file.name))
      await store.createBrowserVault(
        freeName(name || zips[0]?.file.name.replace(/\.zip$/i, '') || 'My vault'),
        false,
      )

      let brought = 0
      for (const zip of zips) brought += (await store.importZip(zip.file, null, true)).length
      if (rest.length) brought += (await store.importFiles(rest, null)).length

      const report = store.intakeReport()
      if (!brought) {
        await store.close(false)
        setProblem(
          `Nothing in that could be imported. A vault takes ${ACCEPTED_SUMMARY}, and needs at least one .md file somewhere inside.`,
        )
        return
      }
      const skipped = report && describeSkipped(report)
      if (skipped) setProblem(skipped)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className={cx('welcome', dragOver && 'dragging')}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async e => {
        e.preventDefault()
        setDragOver(false)
        if (working) return
        const files = await filesFromDrop(e.dataTransfer)
        if (files.length) await startInBrowser(files)
      }}
    >
      <div className="welcome-card">
        <div className="welcome-head">
          <h1><BrandMark size={46} className="brand-mark" /> Superbrain</h1>
          <ThemeToggle />
        </div>

        <p className="tagline">
          Markdown in, a proper vault out. Editing, backlinks, comments and a map of how
          everything connects, all of it running in this tab.
        </p>

        <ul className="promises">
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

        {state.error && <p className="error">{state.error}</p>}
        {problem && <p className="error">{problem}</p>}
        {notice && <p className="settings-note">{notice}</p>}
        {(busy || state.status === 'loading') && (
          <p className="busy">
            {busy ?? state.progress?.label ?? 'Loading…'}
            {state.progress?.done
              ? `, ${state.progress.done}${state.progress.total ? `/${state.progress.total}` : ''}`
              : ''}
          </p>
        )}

        {recent.length > 0 && (
          <section className="recent">
            <h2>Your vaults</h2>
            <ul>
              {recent.map(ref => (
                <li key={ref.id}>
                  {renaming === ref.id ? (
                    <form
                      className="recent-rename"
                      onSubmit={e => {
                        e.preventDefault()
                        const value = new FormData(e.currentTarget).get('label')
                        void store.renameVaultById(ref.id, String(value ?? '')).then(() => {
                          setRenaming(null)
                          refreshRecent()
                        })
                      }}
                    >
                      <input name="label" defaultValue={ref.label} autoFocus aria-label="Vault name" />
                      <button type="submit" className="ghost small">Save</button>
                      <button type="button" className="ghost small" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="recent-entry"
                        disabled={working}
                        onClick={() => { void store.openVault(ref) }}
                      >
                        <span className="recent-icon" aria-hidden="true">
                          {ref.encrypted ? '🔒' : ref.mode === 'fs' ? '🗀' : <BrandMark size={18} />}
                        </span>
                        <span className="recent-body">
                          <span className="recent-name">{ref.label}</span>
                          <span className="recent-sub">
                            {ref.encrypted
                              ? 'Locked with a password'
                              : ref.mode === 'fs' ? 'Folder on this computer' : 'Stored in this browser'}
                            {' · '}{ago(ref.lastOpened)}
                          </span>
                        </span>
                        <span className="recent-go" aria-hidden="true">→</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn recent-action"
                        disabled={working}
                        title={`Export ${ref.label} as a .zip`}
                        aria-label={`Export ${ref.label} as a .zip`}
                        onClick={() => guardLocked(ref, {
                          title: `Export “${ref.label}”`,
                          body: 'This vault is locked, so its password is needed to read the notes out of it.',
                          warning: 'The .zip itself is not protected. Anyone who opens the file can read these notes, so keep it somewhere safe.',
                          confirmLabel: 'Unlock and export',
                          run: password => { void exportBook(ref, password) },
                        })}
                      >⬇</button>
                      <button
                        type="button"
                        className="icon-btn recent-action"
                        title={`Rename ${ref.label}`}
                        aria-label={`Rename ${ref.label}`}
                        onClick={() => guardLocked(ref, {
                          title: `Rename “${ref.label}”`,
                          body: 'This vault is locked, so its password is needed before the name can change.',
                          confirmLabel: 'Unlock and rename',
                          run: () => setRenaming(ref.id),
                        })}
                      >✎</button>
                      <button
                        type="button"
                        className="icon-btn recent-action danger-text"
                        title={ref.mode === 'fs' ? `Remove ${ref.label} from this list` : `Delete ${ref.label}`}
                        aria-label={ref.mode === 'fs' ? `Remove ${ref.label} from this list` : `Delete ${ref.label}`}
                        onClick={() => guardLocked(ref, {
                          title: `Delete “${ref.label}”`,
                          body: 'This vault is locked. Its password is needed before it can be deleted.',
                          confirmLabel: 'Unlock and continue',
                          tone: 'danger',
                          run: () => setConfirm(
                          ref.mode === 'fs'
                            ? {
                                title: `Remove “${ref.label}” from this list?`,
                                body: 'The folder on your computer is not touched. You can open it again any time.',
                                confirmLabel: 'Remove from list',
                                onConfirm: () => { void store.deleteVault(ref).then(refreshRecent) },
                              }
                            : {
                                title: `Delete “${ref.label}”?`,
                                body: 'This vault is kept in this browser, so deleting it removes the only copy. It does not go to the trash and it cannot be undone.',
                                details: [
                                  ref.encrypted
                                    ? 'Locked with a password, and deleted without needing it'
                                    : 'Export it as a .zip first if you want to keep it',
                                ],
                                confirmLabel: 'Delete this vault',
                                tone: 'danger',
                                secondary: {
                                  label: 'Export as .zip first',
                                  busyLabel: 'Packing…',
                                  onClick: () => { void exportBook(ref, unlocked.current ?? undefined) },
                                },
                                onConfirm: () => { void store.deleteVault(ref).then(refreshRecent) },
                              },
                        ) }) }
                      >×</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="start">
          <h2>Start here</h2>
          <div className="start-grid two">
            <button
              type="button"
              className="start-card primary-card"
              disabled={working}
              onClick={() => { void startInBrowser([]) }}
            >
              <span className="start-icon" aria-hidden="true">✎</span>
              <span className="start-title">Create a new vault</span>
              <span className="start-sub">
                Start empty and write your first note. Every one you make is its own vault.
              </span>
            </button>

            <button
              type="button"
              className="start-card"
              disabled={working}
              onClick={() => zipInput.current?.click()}
            >
              <span className="start-icon" aria-hidden="true">📦</span>
              <span className="start-title">Import a vault</span>
              <span className="start-sub">
                Open a .zip you exported before. It comes back as a vault of its own,
                named after the file.
              </span>
            </button>
          </div>

          <p className="start-import">
            You can also drop a .zip straight onto this page.
          </p>
        </section>

        <footer className="welcome-footer">
          <a
            className="foot-link"
            href="https://github.com/shrinathprabhu/superbrain"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubMark />
            Source on GitHub
          </a>
          <span className="foot-made">
            From the makers of{' '}
            <a href="https://owleye.dev" target="_blank" rel="noopener noreferrer">
              OwlEye Analytics
            </a>
            {' '}and{' '}
            <a href="https://lowkey.tools" target="_blank" rel="noopener noreferrer">
              lowkey.tools
            </a>
          </span>
        </footer>
      </div>

      {challenge && <PasswordPrompt challenge={challenge} onClose={() => setChallenge(null)} />}
      {confirm && (
        <ConfirmDialog
          request={confirm}
          onClose={() => { setConfirm(null); unlocked.current = null }}
        />
      )}

      <input
        ref={zipInput}
        type="file"
        hidden
        accept=".zip,application/zip"
        onChange={e => {
          const f = filesFromInput(e.target.files)
          e.target.value = ''
          void startInBrowser(f)
        }}
      />
    </div>
  )
}
