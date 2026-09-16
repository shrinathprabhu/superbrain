import type { VaultNode } from './types'

export interface GraphBody {
  id: string; label: string; kind: VaultNode['kind']
  x: number; y: number; vx: number; vy: number; r: number
}
export type GraphRequest =
  | { type: 'init'; bodies: GraphBody[]; edges: { source: string; target: string; type: string }[] }
  | { type: 'tick' }
  | { type: 'reheat' }
  | { type: 'move'; id: string; x: number; y: number }
export interface GraphFrame { positions: Float64Array; active: boolean }
