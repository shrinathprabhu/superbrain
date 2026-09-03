import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'

import { WikiLink } from './wikilink'
import { VaultMedia, VaultTaskList } from './media'
import { CommentHighlight, commentsKey } from './comments'
import { makeSuggestion, SuggestionController, type SuggestionItem } from './suggestions'
import SuggestionMenu from './SuggestionMenu'
import Toolbar from './Toolbar'
import { EditorEnvContext, type EditorEnv } from './env'
import { useStore, useVault, useResolver } from '../store/vault'
import { excerpt, parseFrontmatter } from '../lib/markdown'
import { titleOf, assetClass, cx, ACCEPT_MEDIA_ATTR } from '../lib/util'
import type { VaultNode } from '../lib/types'

/** Read-only view of a note's YAML frontmatter, shown above the prose. */
function Properties({ markdown }: { markdown: string }) {
  const fm = parseFrontmatter(markdown)
  const entries = Object.entries(fm.data)
  if (!entries.length) return null
  return (
    <dl className="properties">
      {entries.map(([key, value]) => (
        <div key={key} className="property">
          <dt>{key}</dt>
          <dd>
            {Array.isArray(value)
              ? value.map(v => <span key={v} className="tag">{v}</span>)
              : value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface Props {
  noteId: string
  onOpen: (id: string) => void
  onRequestComment: (quote: string) => void
}

export default function NoteEditor({ noteId, onOpen, onRequestComment }: Props) {
  const store = useStore()
  const state = useVault()
  const resolver = useResolver()
  const fileInput = useRef<HTMLInputElement>(null)
  const [, forceRender] = useState(0)

  const wikiController = useMemo(() => new SuggestionController(), [])
  const slashController = useMemo(() => new SuggestionController(), [])

  const notePath = store.pathFor(noteId)
  const envRef = useRef<EditorEnv | null>(null)

  const env: EditorEnv = useMemo(() => ({
    notePath,
    noteId,
    resolve: (target: string) => resolver.resolve(target, notePath),
    open: onOpen,
    createMissing: (target: string) => {
      const parts = target.split('/')
      const name = parts.pop() ?? target
      void store.createNote(store.node(noteId)?.parentId ?? null, name).then(onOpen)
    },
    assetUrl: (id: string) => store.assetUrl(id),
    hasAssetBytes: (id: string) => store.hasAssetBytes(id),
    excerptOf: (id: string) => excerpt(store.body(id), 200),
    readonly: false,
  }), [notePath, noteId, resolver, onOpen, store])
  envRef.current = env

  // ------------------------------------------------------------- suggestions

  const linkItems = useCallback((query: string): SuggestionItem[] => {
    const q = query.trim().toLowerCase()
    const candidates = state.nodes.filter(n => n.kind !== 'folder' && !n.deletedAt && n.id !== noteId)
    const scored = candidates
      .map(n => {
        const label = n.kind === 'note' ? titleOf(n.name) : n.name
        const path = store.pathFor(n.id)
        const hay = `${label}\n${path}`.toLowerCase()
        if (!q) return { n, label, path, score: 0 }
        const i = hay.indexOf(q)
        return i === -1 ? null : { n, label, path, score: i }
      })
      .filter((x): x is { n: VaultNode; label: string; path: string; score: number } => x !== null)
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
      .slice(0, 8)

    const items: SuggestionItem[] = scored.map(({ n, label, path }) => ({
      id: n.id,
      title: label,
      subtitle: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined,
      hint: n.kind === 'asset' ? assetClass(n.mime, n.name) : undefined,
      run: (editor, range) => {
        const target = resolver.linkTextFor(n, notePath)
        const embed = n.kind === 'asset'
        editor.chain().focus()
          .insertContentAt(range, [
            { type: 'wikiLink', attrs: { target, alias: null, embed } },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
    }))

    if (q && !scored.some(s => s.label.toLowerCase() === q)) {
      items.push({
        id: '__new__',
        title: `Create “${query.trim()}”`,
        hint: 'new note',
        run: (editor, range) => {
          const target = query.trim()
          editor.chain().focus()
            .insertContentAt(range, [
              { type: 'wikiLink', attrs: { target, alias: null, embed: false } },
              { type: 'text', text: ' ' },
            ])
            .run()
          void store.createNote(store.node(noteId)?.parentId ?? null, target)
        },
      })
    }
    return items
  }, [state.nodes, noteId, resolver, notePath, store])

  const slashItems = useCallback((query: string): SuggestionItem[] => {
    const all: SuggestionItem[] = [
      { id: 'h1', title: 'Heading 1', hint: '#', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
      { id: 'h2', title: 'Heading 2', hint: '##', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
      { id: 'h3', title: 'Heading 3', hint: '###', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
      { id: 'ul', title: 'Bullet list', hint: '-', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
      { id: 'ol', title: 'Numbered list', hint: '1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
      { id: 'todo', title: 'Task list', hint: '[ ]', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
      { id: 'quote', title: 'Quote', hint: '>', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
      { id: 'code', title: 'Code block', hint: '```', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
      { id: 'table', title: 'Table', hint: '3×3', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: 'hr', title: 'Divider', hint: '---', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
      { id: 'link', title: 'Link to a note', hint: '[[', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('[[').run() },
      { id: 'file', title: 'Image, video or file', hint: 'upload', run: (e, r) => { e.chain().focus().deleteRange(r).run(); fileInput.current?.click() } },
    ]
    const q = query.trim().toLowerCase()
    return q ? all.filter(i => i.title.toLowerCase().includes(q) || i.hint?.includes(q)) : all
  }, [])

  const linkItemsRef = useRef(linkItems)
  linkItemsRef.current = linkItems
  const slashItemsRef = useRef(slashItems)
  slashItemsRef.current = slashItems

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: { HTMLAttributes: { class: 'code-block' } },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
      // Vault-relative hrefs (`Daily/2026-09-01.md`) are legitimate here.
      isAllowedUri: () => true,
      shouldAutoLink: url => /^https?:\/\//i.test(url),
    }),
    Highlight,
    Typography,
    Placeholder.configure({ placeholder: 'Start writing. Press “/” for blocks, or “[[” to link a note' }),
    Table.configure({ resizable: true }),
    TableRow, TableHeader, TableCell,
    VaultTaskList,
    TaskItem.configure({ nested: true }),
    VaultMedia.configure({ inline: false, allowBase64: true }),
    WikiLink,
    CommentHighlight.configure({
      getComments: () => store.getSnapshot().comments.filter(c => c.noteId === noteId),
      getActiveId: () => null,
    }),
    makeSuggestion({ name: 'wikiSuggest', char: '[[', allowSpaces: true, controller: wikiController, getItems: q => linkItemsRef.current(q) }),
    makeSuggestion({
      name: 'slashSuggest', char: '/', startOfLine: false,
      // Only at a word boundary, so dates and paths don't open the block menu.
      allowedPrefixes: [' '],
      controller: slashController, getItems: q => slashItemsRef.current(q),
    }),
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ], [store, noteId, wikiController, slashController])

  const lastPushed = useRef<{ id: string; md: string } | null>(null)
  // YAML frontmatter is preserved verbatim and re-attached on every save.
  const frontmatter = useRef('')

  const editing = state.editing === noteId

  const editor = useEditor({
    extensions,
    editable: false,
    autofocus: false,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handleDOMEvents: {
        click: (_view, event) => {
          const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
          if (!anchor) return false
          const href = anchor.getAttribute('href') ?? ''
          if (/^(https?:|mailto:|tel:)/i.test(href)) {
            event.preventDefault()
            window.open(href, '_blank', 'noopener,noreferrer')
            return true
          }
          const hit = envRef.current?.resolve(decodeURI(href.replace(/#.*$/, '')))
          if (hit && hit.kind === 'note') {
            event.preventDefault()
            onOpen(hit.id)
            return true
          }
          return false
        },
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (!files.length) return false
        event.preventDefault()
        void attach(files)
        return true
      },
      handleDrop: (_view, event) => {
        const dt = (event as DragEvent).dataTransfer
        const files = [...(dt?.files ?? [])]
        if (!files.length) return false
        event.preventDefault()
        void attach(files)
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      const doc = (ed.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
      const md = frontmatter.current ? `${frontmatter.current.replace(/\n+$/, '')}\n\n${doc}` : doc
      lastPushed.current = { id: noteId, md }
      store.setWorking(noteId, md)
    },
    onSelectionUpdate: () => forceRender(v => v + 1),
    onTransaction: () => forceRender(v => v + 1),
  }, [extensions])

  useEffect(() => { lastPushed.current = null }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editing)
    if (editing) editor.commands.focus()
  }, [editor, editing])

  // Push the stored markdown in whenever it differs from what we last emitted
  // (note switch, or a rewrite caused by a rename elsewhere in the vault).
  useEffect(() => {
    if (!editor) return
    const md = store.body(noteId)
    if (lastPushed.current?.id === noteId && lastPushed.current.md === md) return
    const switching = lastPushed.current?.id !== noteId
    const fm = parseFrontmatter(md)
    frontmatter.current = fm.raw
    lastPushed.current = { id: noteId, md }
    editor.commands.setContent(fm.body, false)
    if (switching) {
      editor.commands.setTextSelection(0)
      editor.view.dom.scrollTo({ top: 0 })
    }
  }, [editor, noteId, state.rev, store])

  // Comment decorations are derived state; nudge the plugin when they change.
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(commentsKey, true))
  }, [editor, state.comments])

  const attach = useCallback(async (files: File[]) => {
    if (!files.length || !editor) return
    const ids = await store.importFiles(files.map(f => ({ path: `assets/${f.name}`, file: f })), null)
    const nodes = ids.map(id => store.node(id)).filter((n): n is VaultNode => !!n)
    for (const n of nodes) {
      const path = store.pathFor(n.id)
      if (n.kind === 'note') {
        editor.chain().focus().insertContent([
          { type: 'wikiLink', attrs: { target: resolver.linkTextFor(n, notePath), alias: null, embed: false } },
        ]).run()
      } else {
        editor.chain().focus().insertContent({
          type: 'image',
          attrs: { src: path, alt: n.name },
        }).run()
      }
    }
  }, [editor, store, resolver, notePath])

  const selectionText = useCallback((): string => {
    if (!editor) return ''
    const { from, to } = editor.state.selection
    return from === to ? '' : editor.state.doc.textBetween(from, to, ' ', ' ').trim()
  }, [editor])

  const handleComment = useCallback(() => {
    const quote = selectionText()
    if (quote) onRequestComment(quote)
  }, [selectionText, onRequestComment])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        handleComment()
      }
      if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        if (!editing) store.beginEdit(noteId)
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (editing) void store.saveEdit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleComment, editing, noteId, store])

  if (!editor) return <div className="editor-loading">Loading editor…</div>

  return (
    <EditorEnvContext.Provider value={env}>
      {editing ? (
        <>
          <Toolbar
            editor={editor as Editor}
            onComment={handleComment}
            canComment={Boolean(selectionText())}
            onInsertMedia={() => fileInput.current?.click()}
          />
          <div className="edit-bar">
            <span className={cx('edit-state', state.dirty && 'dirty')}>
              {state.saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : 'No changes yet'}
            </span>
            <button
              type="button"
              className="ghost small"
              onClick={() => store.discardEdit()}
            >
              Discard
            </button>
            <button
              type="button"
              className="primary small"
              disabled={!state.dirty || state.saving}
              onClick={() => { void store.saveEdit().then(() => store.endEdit()) }}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <div className="read-bar">
          <span className="read-hint">Reading</span>
          <button type="button" className="ghost small" onClick={() => store.beginEdit(noteId)}>
            Edit note
          </button>
        </div>
      )}
      <div className="editor-scroll">
        <Properties markdown={state.bodies.get(noteId) ?? ''} />
        <EditorContent editor={editor} />
      </div>
      <SuggestionMenu controller={wikiController} />
      <SuggestionMenu controller={slashController} />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={ACCEPT_MEDIA_ATTR}
        onChange={e => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void attach(files)
        }}
      />
    </EditorEnvContext.Provider>
  )
}
