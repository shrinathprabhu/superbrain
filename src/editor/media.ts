import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MediaView from './MediaView'

interface SerializerState {
  write: (s: string) => void
  closeBlock: (node: unknown) => void
  esc: (s: string) => string
}

/** Paths with spaces or parens need angle-bracket delimiters to survive. */
function href(src: string): string {
  return /[\s()<>]/.test(src) ? `<${src}>` : src
}

/**
 * Images in the markdown carry vault-relative paths (`assets/photo.png`), which
 * a browser cannot load directly. The node keeps the authored path in `src` so
 * serialisation stays lossless; the node view resolves it to an object URL and
 * picks the right element for video/audio/pdf.
 */
export const VaultMedia = Image.extend({
  name: 'image',
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaView)
  },

  addStorage() {
    return {
      markdown: {
        // The stock serialiser writes an image inline and never closes the
        // block, so a following heading gets glued onto the same line.
        serialize(state: SerializerState, node: { attrs: Record<string, string | null>; isInline: boolean }) {
          const alt = state.esc(node.attrs.alt ?? '')
          const title = node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : ''
          state.write(`![${alt}](${href(node.attrs.src ?? '')}${title})`)
          if (!node.isInline) state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

/**
 * tiptap-markdown only marks bulletList/orderedList as "tight", so task lists
 * round-trip with a blank line between every item. Opt them in as well.
 */
export const VaultTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: element => element.getAttribute('data-tight') !== 'false',
        renderHTML: attributes => (attributes.tight ? { 'data-tight': 'true' } : null),
      },
    }
  },
})
