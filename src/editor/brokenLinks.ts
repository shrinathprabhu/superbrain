import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EXTERNAL } from '../lib/markdown'
import type { VaultNode } from '../lib/types'

/**
 * Marks markdown links that point at something this vault does not have.
 *
 * `[[wikilinks]]` already render through a node view that knows whether they
 * resolve, but a plain `[Budget](../Finance/Budget.md)` was drawn exactly like
 * a working link. A link out of the vault is not a normal link: nothing
 * happens when you click it, and importing whatever folder it points into is a
 * decision only the reader can make. Showing it as broken is what turns that
 * dead end into an offer.
 *
 * A decoration rather than a class written onto the DOM: ProseMirror owns the
 * mark elements and rebuilds them on any change, so anything set by hand is
 * gone at the next keystroke.
 */
export const brokenLinkKey = new PluginKey('brokenLinks')

/** True for a href that names something inside the vault rather than the web. */
export function isInternalHref(href: string): boolean {
  if (!href) return false
  if (EXTERNAL.test(href)) return false
  if (href.startsWith('#')) return false
  if (/^(mailto:|tel:|data:|blob:)/i.test(href)) return false
  return true
}

export const BrokenLinks = (resolve: (target: string) => VaultNode | null) =>
  Extension.create({
    name: 'brokenLinks',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: brokenLinkKey,
          props: {
            decorations(state) {
              const found: Decoration[] = []
              state.doc.descendants((node, pos) => {
                if (!node.isText) return
                const link = node.marks.find(m => m.type.name === 'link')
                if (!link) return
                const href = String(link.attrs.href ?? '')
                if (!isInternalHref(href)) return
                // Strip a heading anchor: the note is what has to exist.
                let target = href.replace(/#.*$/, '')
                try { target = decodeURI(target) } catch { /* leave it as written */ }
                if (resolve(target)) return
                found.push(
                  Decoration.inline(pos, pos + node.nodeSize, {
                    class: 'broken-link',
                    title: `“${target}” is not in this vault. Click to bring it in.`,
                  }),
                )
              })
              return DecorationSet.create(state.doc, found)
            },
          },
        }),
      ]
    },
  })
