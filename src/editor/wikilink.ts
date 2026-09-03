import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import WikiLinkView from './WikiLinkView'

export interface WikiLinkAttrs {
  target: string
  alias: string | null
  embed: boolean
}

const PATTERN = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g

/** Replace `[[x]]` inside text nodes with elements our parseHTML recognises. */
function markupTextNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement
      while (el && el !== root) {
        if (el.tagName === 'CODE' || el.tagName === 'PRE' || el.tagName === 'A') return NodeFilter.FILTER_REJECT
        el = el.parentElement
      }
      return PATTERN.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as unknown as Text)

  for (const textNode of targets) {
    const text = textNode.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let last = 0
    PATTERN.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PATTERN.exec(text))) {
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)))
      const span = document.createElement('span')
      span.setAttribute('data-wikilink', m[2].trim())
      if (m[3]) span.setAttribute('data-alias', m[3].trim())
      if (m[1]) span.setAttribute('data-embed', 'true')
      frag.append(span)
      last = m.index + m[0].length
    }
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)))
    textNode.replaceWith(frag)
  }
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      target: { default: '', parseHTML: el => (el as HTMLElement).getAttribute('data-wikilink') ?? '' },
      alias: { default: null, parseHTML: el => (el as HTMLElement).getAttribute('data-alias') },
      embed: {
        default: false,
        parseHTML: el => (el as HTMLElement).getAttribute('data-embed') === 'true',
        renderHTML: attrs => (attrs.embed ? { 'data-embed': 'true' } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': node.attrs.target,
        class: 'wikilink',
      }),
      node.attrs.alias || node.attrs.target,
    ]
  },

  renderText({ node }) {
    const alias = node.attrs.alias ? `|${node.attrs.alias}` : ''
    return `${node.attrs.embed ? '!' : ''}[[${node.attrs.target}${alias}]]`
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView, { as: 'span', className: 'wikilink-host' })
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]$/,
        type: this.type,
        getAttributes: match => ({
          embed: match[1] === '!',
          target: (match[2] ?? '').trim(),
          alias: match[3] ? match[3].trim() : null,
        }),
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: WikiLinkAttrs }) {
          const alias = node.attrs.alias ? `|${node.attrs.alias}` : ''
          state.write(`${node.attrs.embed ? '!' : ''}[[${node.attrs.target}${alias}]]`)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            markupTextNodes(element)
          },
        },
      },
    }
  },
})

/** `[[Note]]` typed by hand becomes a real node as soon as the brackets close. */
export const WIKILINK_INPUT = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]$/
