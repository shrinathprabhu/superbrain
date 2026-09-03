import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Comment } from '../lib/types'

export const commentsKey = new PluginKey('superbrainComments')

export interface CommentHighlightOptions {
  getComments: () => Comment[]
  getActiveId: () => string | null
}

/** Flatten the doc to text while keeping a char-index -> doc-position map. */
function flatten(doc: PMNode): { text: string; pos: number[] } {
  let text = ''
  const pos: number[] = []
  let firstBlock = true
  doc.descendants((node, at) => {
    if (node.isText) {
      const t = node.text ?? ''
      for (let i = 0; i < t.length; i++) pos.push(at + i)
      text += t
    } else if (node.isBlock) {
      if (!firstBlock) { text += '\n'; pos.push(at) }
      firstBlock = false
    }
    return true
  })
  return { text, pos }
}

function build(doc: PMNode, options: CommentHighlightOptions): DecorationSet {
  const comments = options.getComments()
  if (!comments.length) return DecorationSet.empty
  const { text, pos } = flatten(doc)
  const activeId = options.getActiveId()
  const decorations: Decoration[] = []

  for (const comment of comments) {
    const quote = comment.quote.replace(/\s+/g, ' ').trim()
    if (!quote) continue
    // Search the flattened text, tolerating whitespace differences.
    const needle = quote.toLowerCase()
    const haystack = text.replace(/\s+/g, ' ').toLowerCase()
    // Map compacted indices back to original ones.
    const compactToRaw: number[] = []
    let lastWasSpace = false
    for (let i = 0; i < text.length; i++) {
      const isSpace = /\s/.test(text[i])
      if (isSpace) {
        if (lastWasSpace) continue
        lastWasSpace = true
      } else {
        lastWasSpace = false
      }
      compactToRaw.push(i)
    }
    let from = haystack.indexOf(needle)
    let guard = 0
    while (from !== -1 && guard++ < 50) {
      const startRaw = compactToRaw[from]
      const endRaw = compactToRaw[Math.min(from + needle.length - 1, compactToRaw.length - 1)]
      if (startRaw != null && endRaw != null && pos[startRaw] != null && pos[endRaw] != null) {
        decorations.push(
          Decoration.inline(pos[startRaw], pos[endRaw] + 1, {
            class: comment.resolved
              ? 'comment-mark comment-resolved'
              : comment.id === activeId
                ? 'comment-mark comment-active'
                : 'comment-mark',
            'data-comment-id': comment.id,
          }),
        )
      }
      from = haystack.indexOf(needle, from + Math.max(needle.length, 1))
    }
  }
  return DecorationSet.create(doc, decorations)
}

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: 'commentHighlight',

  addOptions() {
    return { getComments: () => [], getActiveId: () => null }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin({
        key: commentsKey,
        state: {
          init: (_config, state) => build(state.doc, options),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(commentsKey) ? build(newState.doc, options) : old,
        },
        props: {
          decorations(state) { return commentsKey.getState(state) as DecorationSet },
        },
      }),
    ]
  },
})
