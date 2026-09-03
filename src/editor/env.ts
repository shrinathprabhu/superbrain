import { createContext, useContext } from 'react'
import type { VaultNode } from '../lib/types'

export interface EditorEnv {
  /** Vault-relative path of the note being edited, for relative link resolution. */
  notePath: string
  noteId: string
  resolve: (target: string) => VaultNode | null
  open: (nodeId: string) => void
  /** Create the missing note a broken link points at, then open it. */
  createMissing: (target: string) => void
  assetUrl: (nodeId: string) => Promise<string | null>
  hasAssetBytes: (nodeId: string) => boolean
  excerptOf: (nodeId: string) => string
  readonly: boolean
}

export const EditorEnvContext = createContext<EditorEnv | null>(null)

export function useEditorEnv(): EditorEnv {
  const env = useContext(EditorEnvContext)
  if (!env) throw new Error('EditorEnvContext missing')
  return env
}
