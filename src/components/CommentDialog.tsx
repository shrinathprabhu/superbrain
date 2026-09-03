import { useEffect, useRef, useState } from 'react'

export default function CommentDialog({ quote, onCancel, onSubmit }: {
  quote: string
  onCancel: () => void
  onSubmit: (body: string) => void
}) {
  const [body, setBody] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="comment-dialog"
        onMouseDown={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (body.trim()) onSubmit(body.trim()) }}
      >
        <h3>Add a comment</h3>
        <blockquote className="comment-quote">{quote}</blockquote>
        <textarea
          ref={ref}
          value={body}
          placeholder="What about this?"
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (body.trim()) onSubmit(body.trim()) }
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!body.trim()}>Comment <kbd>⌘↵</kbd></button>
        </div>
      </form>
    </div>
  )
}
