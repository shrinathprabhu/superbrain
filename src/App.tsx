import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { mostRecentBrowserVault } from './store/vaults'
import { lastUsedMode, useStore, useVault } from './store/vault'
import { HAS_FS_ACCESS } from './store/fs'
import Welcome from './components/Welcome'
import FileTree from './components/FileTree'
import SidePanel from './components/SidePanel'
import AssetView from './components/AssetView'
import QuickSwitcher from './components/QuickSwitcher'
import CommentDialog from './components/CommentDialog'
import NoteEditor from './editor/NoteEditor'

// The graph and the zip writer are only needed on demand; keeping them out of
// the first paint saves the reader ~60 kB they may never use.
const GraphView = lazy(() => import('./components/GraphView'))
import { filesFromDrop, filesFromInput } from './lib/dropfiles'
import { describeSkipped } from './lib/intake'
import { ACCEPTED_SUMMARY, ACCEPT_ATTR } from './lib/util'
import Toasts, { type Toast } from './components/Toasts'
import ThemeToggle from './components/ThemeToggle'
import BrandButton from './components/BrandButton'
import BookSettings from './components/BookSettings'
import ConfirmDialog, { type ConfirmRequest } from './components/ConfirmDialog'
import CloseVaultDialog from './components/CloseVaultDialog'
import UnlockScreen from './components/UnlockScreen'
import UnsavedDialog from './components/UnsavedDialog'
import TrashView from './components/TrashView'
import FolderView from './components/FolderView'
import NotFound from './components/NotFound'
import { useRoute } from './lib/router'
import { cx, titleOf, uid } from './lib/util'

type View = 'note' | 'graph' | 'trash'

export default function App() {
  const store = useStore()
  const state = useVault()
  const [view, setView] = useState<View>('note')
  const [filter, setFilter] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [switcher, setSwitcher] = useState(false)
  const [pendingComment, setPendingComment] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  // On a phone the tree is a drawer, so it starts closed and covers the note.
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 720px)').matches)
  const [panelOpen, setPanelOpen] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [closing, setClosing] = useState(false)
  /** An action held back until unsaved edits are dealt with. */
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [route, navigate] = useRoute()
  const [missingState, setMissingState] = useState<string | null>(null)
  /*
   * Mirrored in a ref because the effects below run in one pass: the route
   * effect marks a dead link, and the URL-writeback effect runs straight after
   * it, still holding the previous render's `missing`. Reading state there
   * would let the auto-selected first note overwrite the address bar before
   * the 404 ever applied, turning a bad deep link into a silent redirect.
   */
  const missingRef = useRef<string | null>(null)
  const missing = missingState
  const setMissing = (path: string | null) => {
    missingRef.current = path
    setMissingState(path)
  }
  // The URL wins on first load; after that the selection drives the URL.
  const hydrated = useRef(false)
  const lastActive = useRef<string | null>(null)
  // The selection applied from a URL lands a commit later than the effect that
  // requests it, so the write-back has to sit out that one stale render.
  const pendingId = useRef<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const folderImportInput = useRef<HTMLInputElement>(null)
  const zipImportInput = useRef<HTMLInputElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Pick up where the last session left off: re-attach to the folder if the
  // permission is still live, otherwise reopen the browser-storage notebook.
  useEffect(() => {
    if (state.status !== 'idle') return
    void (async () => {
      const mode = await lastUsedMode()
      if (!mode) return
      if (mode === 'fs' && HAS_FS_ACCESS) {
        if (await store.reopenLastFolder(false)) return
      }
      if (mode === 'idb') {
        const last = await mostRecentBrowserVault()
        if (last) await store.openVault(last)
      }
    })()
  }, [state.status, store])

  useEffect(() => {
    if (folderImportInput.current) folderImportInput.current.setAttribute('webkitdirectory', '')
  }, [state.status])

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    setToasts(list => [...list, { id: uid(), tone, message }])
  }, [])
  const dismiss = useCallback((id: string) => setToasts(list => list.filter(t => t.id !== id)), [])

  // Surface storage failures rather than letting them die in the console.
  useEffect(() => {
    if (state.error) notify(state.error, 'error')
  }, [state.error, notify])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const sync = () => {
      setNarrow(mq.matches)
      setSidebarOpen(!mq.matches)
    }
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const exportAll = useCallback(() => {
    void (async () => {
      await store.flush()
      const { exportVault } = await import('./lib/export')
      const snapshot = store.getSnapshot()
      const result = await exportVault({
        nodes: snapshot.nodes,
        pathOf: id => store.pathFor(id),
        body: id => store.body(id),
        asset: async id => {
          const node = store.node(id)
          const backend = store.backend
          return node && backend ? backend.readAsset(node, store.pathFor(id)) : null
        },
      }, snapshot.info?.label ?? 'superbrain')
      if (result.skipped.length) {
        notify(
          `Exported ${result.written} files. Left out ${result.skipped.length} ` +
          `asset${result.skipped.length === 1 ? '' : 's'} whose bytes aren't loaded ` +
          `(${result.skipped.slice(0, 3).join(', ')}${result.skipped.length > 3 ? '…' : ''}). ` +
          `Re-link them, or use a folder on disk to keep binaries.`,
          'warn',
        )
      } else {
        notify(`Exported ${result.written} files.`)
      }
    })()
  }, [store, notify])

  /** Run `action`, unless there are unsaved edits that need a decision first. */
  const guarded = useCallback((action: () => void) => {
    const snapshot = store.getSnapshot()
    if (snapshot.editing && snapshot.dirty) {
      setPendingAction(() => action)
      return
    }
    if (snapshot.editing) store.endEdit()
    action()
  }, [store])

  /** Save one note as a standalone HTML file, pictures and all. */
  const exportNoteHtml = useCallback((id: string) => {
    void (async () => {
      const node = store.node(id)
      if (!node || node.kind !== 'note') return
      const { noteToHtml, downloadHtml } = await import('./lib/html')
      const { makeResolver } = await import('./lib/links')
      const snapshot = store.getSnapshot()
      const html = await noteToHtml({
        node,
        markdown: store.body(id),
        bookName: snapshot.info?.label ?? 'Superbrain',
        path: store.pathFor(id),
        resolver: makeResolver(snapshot.nodes),
        asset: async assetId => {
          const assetNode = store.node(assetId)
          const backend = store.backend
          return assetNode && backend ? backend.readAsset(assetNode, store.pathFor(assetId)) : null
        },
      })
      downloadHtml(titleOf(node.name), html)
      notify(`Saved “${titleOf(node.name)}” as a self-contained HTML file.`)
    })()
  }, [store, notify])

  /**
   * One way in for everything: a zip is unpacked first, then the same screening
   * runs, and whatever was refused is reported rather than silently dropped.
   */
  const intake = useCallback((files: ReturnType<typeof filesFromInput>, parentId: string | null) => {
    void (async () => {
      const zips = files.filter(f => /\.zip$/i.test(f.file.name))
      const rest = files.filter(f => !/\.zip$/i.test(f.file.name))
      let brought = 0
      for (const zip of zips) brought += (await store.importZip(zip.file, parentId)).length
      if (rest.length) brought += (await store.importFiles(rest, parentId)).length

      const report = store.intakeReport()
      if (!brought) {
        notify(
          report?.rejected.length
            ? `Nothing was imported. This vault takes ${ACCEPTED_SUMMARY}, and needs at least one .md file.`
            : 'Nothing was imported. A folder needs at least one .md file somewhere inside it.',
          'warn',
        )
        return
      }
      const skipped = report && describeSkipped(report)
      if (skipped) notify(skipped, 'warn')
    })()
  }, [store, notify])

  const open = useCallback((id: string) => {
    guarded(() => {
      setMissing(null)
      store.setActive(id)
      setView('note')
      if (narrow) setSidebarOpen(false)
    })
  }, [store, narrow, guarded])

  // 1. On first ready, honour whatever is already in the URL.
  useEffect(() => {
    if (state.status !== 'ready' || hydrated.current) return
    hydrated.current = true
    if (!route) return
    const id = store.idForPath(route)
    if (id) {
      pendingId.current = id
      store.setActive(id)
      setMissing(null)
    } else {
      setMissing(route)
    }
  }, [state.status, route, store])

  // 2. Later URL changes (back/forward, a pasted link) move the selection.
  useEffect(() => {
    if (state.status !== 'ready' || !hydrated.current) return
    if (!route) {
      setMissing(null)
      if (state.activeId !== null) store.setActive(null)
      return
    }
    const id = store.idForPath(route)
    const snapshot = store.getSnapshot()
    const leaving = id !== snapshot.activeId
    if (leaving && snapshot.editing && snapshot.dirty) {
      const previous = snapshot.activeId ? store.pathFor(snapshot.activeId) : ''
      setPendingAction(() => () => {
        if (id) {
          setMissing(null)
          pendingId.current = id
          store.setActive(id)
        } else {
          setMissing(route)
        }
      })
      // Undo the address bar until the question is answered.
      navigate(previous, true)
      return
    }
    if (id) {
      setMissing(null)
      if (leaving) {
        pendingId.current = id
        store.setActive(id)
      }
    } else {
      setMissing(route)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  // 3. The selection writes itself back. A rename keeps the same node, so it
  //    replaces the entry instead of stacking a new one.
  const activePath = state.activeId ? store.pathFor(state.activeId) : ''
  useEffect(() => {
    if (state.status !== 'ready' || !hydrated.current || missingRef.current) return
    if (pendingId.current) {
      const settled = state.activeId === pendingId.current
      pendingId.current = null
      // Still the old selection in this render — writing it would undo the URL.
      if (!settled) return
    }
    const replace = lastActive.current === state.activeId
    lastActive.current = state.activeId
    navigate(activePath, replace)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, state.activeId, state.status])

  // Starting a different vault drops the old route.
  useEffect(() => {
    if (state.status === 'idle') {
      hydrated.current = false
      lastActive.current = null
      setMissing(null)
    }
  }, [state.status])

  useEffect(() => {
    if (!addOpen) return
    const close = () => setAddOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [addOpen])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.getSnapshot().dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'k' || e.key === 'p') && !e.shiftKey) { e.preventDefault(); setSwitcher(true) }
      if (meta && e.key === 's') { e.preventDefault(); void store.flush() }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); setView(v => (v === 'graph' ? 'note' : 'graph')) }
      if (meta && e.key === 'n' && !e.shiftKey) {
        const active = store.node(store.getSnapshot().activeId)
        e.preventDefault()
        void store.createNote(active?.kind === 'folder' ? active.id : active?.parentId ?? null)
      }
      if (meta && e.key === '\\') { e.preventDefault(); setSidebarOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (state.status === 'locked') return <UnlockScreen />
  if (state.status !== 'ready') return <Welcome />

  const active = store.node(state.activeId)
  const trashCount = store.trashed().filter(n => !n.parentId || !store.node(n.parentId)?.deletedAt).length

  return (
    <div
      className={cx('app', dropping && 'dropping')}
      onDragOver={e => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false) }}
      onDrop={async e => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDropping(false)
        const files = await filesFromDrop(e.dataTransfer)
        if (files.length) intake(files, null)
      }}
    >
      <header className="topbar">
        <button type="button" className="icon-btn" title="Toggle sidebar (⌘\)" onClick={() => setSidebarOpen(o => !o)}>☰</button>
        <BrandButton onSettings={() => setSettingsOpen(true)} />

        <div className="topbar-spacer" />

        <div className="view-switch" role="tablist" data-active={view}>
          <button type="button" role="tab" aria-selected={view === 'note'} className={cx(view === 'note' && 'on')} onClick={() => setView('note')}>Notes</button>
          <button type="button" role="tab" aria-selected={view === 'graph'} className={cx(view === 'graph' && 'on')} onClick={() => setView('graph')}>Graph</button>
        </div>

        <div className="topbar-spacer" />

        <ThemeToggle compact />
        <span className={cx('save-state', state.saving && 'busy')}>
          {state.progress
            ? `${state.progress.label} ${state.progress.done}${state.progress.total ? `/${state.progress.total}` : ''}`
            : state.saving ? 'Saving…' : 'Saved'}
        </span>
        <button type="button" className="icon-btn" title="Search (⌘K)" onClick={() => setSwitcher(true)}>🔍</button>
      </header>

      <div className="body">
        {sidebarOpen && narrow && (
          <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        )}
        {sidebarOpen && (
          <nav className={cx('sidebar', narrow && 'drawer')}>
            <div className="sidebar-tools">
              <input
                className="filter"
                placeholder="Filter notes…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              <button type="button" className="icon-btn" title="New note (⌘N)" onClick={() => {
                void store.createNote(active?.kind === 'folder' ? active.id : active?.parentId ?? null)
              }}>＋</button>
              <button type="button" className="icon-btn" title="New folder" onClick={() => {
                void store.createFolder(active?.kind === 'folder' ? active.id : active?.parentId ?? null)
              }}>🗀</button>
            </div>
            <FileTree filter={filter} tag={tag} onTag={setTag} onOpen={open} onExportHtml={exportNoteHtml} />
            <button
              type="button"
              className={cx('trash-link', view === 'trash' && 'on')}
              onClick={() => guarded(() => setView('trash'))}
            >
              <span aria-hidden="true">🗑</span>
              Trash
              {trashCount > 0 && <span className="trash-count">{trashCount}</span>}
            </button>
            <div className="sidebar-foot">
              {/*
                A browser file dialog is either files or a folder, never both:
                webkitdirectory turns the picker into a folder chooser and drops
                the ability to pick files. So the entry point is one button and
                the choice lives inside it. Dragging handles both at once.
              */}
              <div className="add-menu-host">
                <button
                  type="button"
                  className="ghost small"
                  aria-expanded={addOpen}
                  onClick={e => { e.stopPropagation(); setAddOpen(o => !o) }}
                >
                  Add files or folder…
                </button>
                {addOpen && (
                  <div className="menu add-menu" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => { setAddOpen(false); importInput.current?.click() }}
                    >Files…</button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => { setAddOpen(false); folderImportInput.current?.click() }}
                    >Folder…</button>
                    <div className="menu-sep" />
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => { setAddOpen(false); zipImportInput.current?.click() }}
                    >Vault from a .zip…</button>
                  </div>
                )}
              </div>
              <span className="foot-spacer" />
              <button type="button" className="icon-btn" title="Export everything as a .zip" onClick={exportAll}>⬇</button>
              <button
                type="button"
                className="icon-btn"
                title="Close this vault"
                onClick={() => guarded(() => setClosing(true))}
              >⏏</button>
            </div>
          </nav>
        )}

        <main className="main">
          {view === 'trash' ? (
            <TrashView onOpen={id => { setView('note'); open(id) }} />
          ) : view === 'graph' ? (
            <Suspense fallback={<div className="empty-main">Building the graph…</div>}>
              <GraphView onOpen={open} />
            </Suspense>
          ) : (
            <>
              <div className="note-head">
                <Breadcrumb
                  id={missing ? null : active?.id ?? null}
                  onOpen={open}
                  onRoot={() => guarded(() => { setMissing(null); store.setActive(null) })}
                />
                {!missing && active?.kind === 'note' && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Save this note as a self-contained HTML file"
                      onClick={() => exportNoteHtml(active.id)}
                    >⤓</button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={panelOpen ? 'Hide side panel' : 'Show side panel'}
                      onClick={() => setPanelOpen(o => !o)}
                    >{panelOpen ? '⟩' : '⟨'}</button>
                  </>
                )}
              </div>
              {missing ? (
                <NotFound path={missing} onOpen={open} onHome={() => { setMissing(null); navigate('') }} />
              ) : !active || active.kind === 'folder' ? (
                <FolderView folderId={active?.id ?? null} onOpen={open} />
              ) : active.kind === 'asset' ? (
                <AssetView node={active} />
              ) : (
                <NoteEditor
                  key={active.id}
                  noteId={active.id}
                  onOpen={open}
                  onRequestComment={setPendingComment}
                />
              )}
            </>
          )}
        </main>

        {view === 'note' && panelOpen && !missing && active?.kind === 'note' && (
          <SidePanel noteId={active.id} onOpen={open} />
        )}
      </div>

      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} onOpen={open} />}
      {pendingComment && active && (
        <CommentDialog
          quote={pendingComment}
          onCancel={() => setPendingComment(null)}
          onSubmit={body => {
            store.addComment(active.id, pendingComment, body)
            setPendingComment(null)
          }}
        />
      )}

      <input
        ref={importInput}
        type="file"
        multiple
        hidden
        accept={ACCEPT_ATTR}
        onChange={e => {
          const files = filesFromInput(e.target.files)
          e.target.value = ''
          intake(files, active?.kind === 'folder' ? active.id : active?.parentId ?? null)
        }}
      />
      <input
        ref={folderImportInput}
        type="file"
        multiple
        hidden
        onChange={e => {
          const files = filesFromInput(e.target.files)
          e.target.value = ''
          intake(files, null)
        }}
      />
      <input
        ref={zipImportInput}
        type="file"
        hidden
        accept=".zip,application/zip"
        onChange={e => {
          const files = filesFromInput(e.target.files)
          e.target.value = ''
          intake(files, active?.kind === 'folder' ? active.id : active?.parentId ?? null)
        }}
      />

      {dropping && (
        <div className="drop-overlay">
          <span>Drop markdown, pictures or a .zip to add them to this vault</span>
        </div>
      )}
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      {closing && <CloseVaultDialog onClose={() => setClosing(false)} />}
      {settingsOpen && <BookSettings onClose={() => setSettingsOpen(false)} />}
      {pendingAction && (
        <UnsavedDialog
          noteName={store.node(state.editing)?.name ?? 'This note'}
          onResolved={() => { const run = pendingAction; setPendingAction(null); run() }}
          onCancel={() => setPendingAction(null)}
        />
      )}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

function Breadcrumb({ id, onOpen, onRoot }: {
  id: string | null
  onOpen: (id: string) => void
  onRoot: () => void
}) {
  const store = useStore()
  const state = useVault()
  const path: { id: string; label: string; kind: string }[] = []
  let cur = id ? store.node(id) : null
  let guard = 0
  while (cur && guard++ < 64) {
    path.unshift({ id: cur.id, label: cur.kind === 'note' ? titleOf(cur.name) : cur.name, kind: cur.kind })
    cur = cur.parentId ? store.node(cur.parentId) : null
  }
  return (
    <div className="breadcrumb">
      <button type="button" className="crumb root" onClick={onRoot}>{state.info?.label}</button>
      {path.map((p, i) => (
        <span key={p.id}>
          <span className="crumb-sep">/</span>
          <button
            type="button"
            className={cx('crumb', i === path.length - 1 && 'current')}
            onClick={() => onOpen(p.id)}
          >{p.label}</button>
        </span>
      ))}
    </div>
  )
}
