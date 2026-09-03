import type { Editor } from '@tiptap/react'
import { cx } from '../lib/util'

interface Props {
  editor: Editor
  onComment: () => void
  onInsertMedia: () => void
  canComment: boolean
}

function Btn({ on, disabled, title, onClick, children }: {
  on?: boolean; disabled?: boolean; title: string
  onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cx('tb-btn', on && 'on')}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const Sep = () => <span className="tb-sep" aria-hidden="true" />

export default function Toolbar({ editor, onComment, onInsertMedia, canComment }: Props) {
  const chain = () => editor.chain().focus()

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn title="Undo (⌘Z)" onClick={() => chain().undo().run()} disabled={!editor.can().undo()}>↶</Btn>
      <Btn title="Redo (⌘⇧Z)" onClick={() => chain().redo().run()} disabled={!editor.can().redo()}>↷</Btn>
      <Sep />
      <select
        className="tb-select"
        aria-label="Block type"
        value={
          editor.isActive('heading', { level: 1 }) ? 'h1'
          : editor.isActive('heading', { level: 2 }) ? 'h2'
          : editor.isActive('heading', { level: 3 }) ? 'h3'
          : editor.isActive('codeBlock') ? 'code'
          : editor.isActive('blockquote') ? 'quote'
          : 'p'
        }
        onChange={e => {
          const v = e.target.value
          if (v === 'p') chain().setParagraph().run()
          else if (v === 'code') chain().toggleCodeBlock().run()
          else if (v === 'quote') chain().toggleBlockquote().run()
          else chain().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run()
        }}
      >
        <option value="p">Text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="quote">Quote</option>
        <option value="code">Code block</option>
      </select>
      <Sep />
      <Btn title="Bold (⌘B)" on={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><b>B</b></Btn>
      <Btn title="Italic (⌘I)" on={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="Strikethrough" on={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><s>S</s></Btn>
      <Btn title="Inline code" on={editor.isActive('code')} onClick={() => chain().toggleCode().run()}>{'</>'}</Btn>
      <Btn title="Highlight" on={editor.isActive('highlight')} onClick={() => chain().toggleHighlight().run()}>▧</Btn>
      <Sep />
      <Btn title="Bullet list" on={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>•</Btn>
      <Btn title="Numbered list" on={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>1.</Btn>
      <Btn title="Task list" on={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()}>☑</Btn>
      <Sep />
      <Btn
        title="Insert table"
        on={editor.isActive('table')}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >⊞</Btn>
      {editor.isActive('table') && (
        <>
          <Btn title="Add row below" onClick={() => chain().addRowAfter().run()}>+row</Btn>
          <Btn title="Add column after" onClick={() => chain().addColumnAfter().run()}>+col</Btn>
          <Btn title="Delete row" onClick={() => chain().deleteRow().run()}>−row</Btn>
          <Btn title="Delete column" onClick={() => chain().deleteColumn().run()}>−col</Btn>
          <Btn title="Delete table" onClick={() => chain().deleteTable().run()}>⌫</Btn>
        </>
      )}
      <Sep />
      <Btn title="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}>―</Btn>
      <Btn title="Insert image, video or file" onClick={onInsertMedia}>🖼</Btn>
      <Btn
        title="Link (⌘K)"
        on={editor.isActive('link')}
        onClick={() => {
          const previous = editor.getAttributes('link').href as string | undefined
          const href = window.prompt('Link URL, or a note path like Projects/Ideas.md', previous ?? 'https://')
          if (href === null) return
          if (!href) { chain().unsetLink().run(); return }
          chain().extendMarkRange('link').setLink({ href }).run()
        }}
      >🔗</Btn>
      <Sep />
      <Btn title="Comment on selection (⌘⇧M)" onClick={onComment} disabled={!canComment}>💬</Btn>
    </div>
  )
}
