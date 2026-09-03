import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

export interface SuggestionItem {
  id: string
  title: string
  subtitle?: string
  hint?: string
  run: (editor: Editor, range: Range) => void
}

export interface SuggestionState {
  items: SuggestionItem[]
  query: string
  rect: DOMRect | null
  select: (item: SuggestionItem) => void
}

type Listener = (s: SuggestionState | null) => void

/**
 * Bridge between the ProseMirror suggestion plugin and a React popup: the
 * plugin pushes state in, the popup subscribes and registers a key handler.
 */
export class SuggestionController {
  private listeners = new Set<Listener>()
  private state: SuggestionState | null = null
  keydown: ((event: KeyboardEvent) => boolean) | null = null

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = () => this.state
  set(next: SuggestionState | null) {
    this.state = next
    this.listeners.forEach(l => l(next))
  }
}

export function makeSuggestion(config: {
  name: string
  char: string
  allowSpaces?: boolean
  startOfLine?: boolean
  /** Characters the trigger may follow. `null` means anywhere. */
  allowedPrefixes?: string[] | null
  controller: SuggestionController
  getItems: (query: string) => SuggestionItem[]
}) {
  const { controller } = config
  // Each suggestion plugin needs its own key, or a second one throws on install.
  const pluginKey = new PluginKey(config.name)
  return Extension.create({
    name: config.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem>({
          pluginKey,
          editor: this.editor,
          char: config.char,
          allowSpaces: config.allowSpaces ?? false,
          startOfLine: config.startOfLine ?? false,
          allowedPrefixes: config.allowedPrefixes === undefined ? null : config.allowedPrefixes,
          items: ({ query }) => config.getItems(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => {
            const push = (props: {
              items: SuggestionItem[]
              query: string
              clientRect?: (() => DOMRect | null) | null
              command: (item: SuggestionItem) => void
            }) => {
              controller.set({
                items: props.items,
                query: props.query,
                rect: props.clientRect?.() ?? null,
                select: props.command,
              })
            }
            return {
              onStart: push,
              onUpdate: push,
              onKeyDown: ({ event }) => {
                if (event.key === 'Escape') { controller.set(null); return true }
                return controller.keydown?.(event) ?? false
              },
              onExit: () => controller.set(null),
            }
          },
        }),
      ]
    },
  })
}
