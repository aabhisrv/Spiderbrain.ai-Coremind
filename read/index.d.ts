// Type declarations for @spiderbrain/read. The runtime is plain ESM (zero deps);
// these types exist so agents and editors get IntelliSense against the format.

/** One committed structure record (a file in the repo's understanding graph). */
export interface BrainNode {
  id: string
  kind: string
  role: string
  layer: string
  cluster: string
  isMaster: boolean
  master: string
  contentHash: string
  /** Edge-derivable transitive-dependent count (no scoring weights). */
  blastRadius: number
  dependsOn: string[]
  /** Inverted at load time from the committed forward edges. */
  dependedOnBy: string[]
}

export interface BrainManifest {
  schemaVersion: number
  variant: 'public' | 'private'
  privacy: string
  engineVersion: string
  scoredFrom: string | null
  repo: { name: string | null; commit: string | null }
  counts: { files: number; edges: number; clusters: number; masters: number }
  graphFingerprint: string
  fileHashes: Record<string, string>
}

export interface Brain {
  dir: string
  nodes: Record<string, BrainNode>
  ids: string[]
  manifest: BrainManifest | null
  integrity: 'verified' | 'MISMATCH' | 'unknown'
  source: 'committed' | 'registry'
}

export function loadBrain(root: string): Brain
export function parseStructure(raw: string): Record<string, BrainNode>
export function integrityOf(structureText: string, manifest: BrainManifest | null): Brain['integrity']

export function reach(nodes: Record<string, BrainNode>, id: string, maxCost?: number): Map<string, number>

export interface BlastResult {
  id: string
  found: boolean
  count?: number
  reached: { id: string; cost: number }[]
}
export function blast(nodes: Record<string, BrainNode>, id: string): BlastResult

export interface Keystone { id: string; reach: number; kind: string; cluster: string }
export function keystones(nodes: Record<string, BrainNode>, ids: string[], n?: number): Keystone[]

export interface NodeSummary {
  id: string
  found: boolean
  kind?: string
  role?: string | null
  cluster?: string
  layer?: string
  isMaster?: boolean
  master?: string | null
  blastRadius?: number
  dependsOn?: string[]
  dependedOnByCount?: number
}
export function describe(nodes: Record<string, BrainNode>, id: string): NodeSummary

export interface ImpactResult {
  changed: { path: string; found: boolean; reaches: number; keystone?: boolean }[]
  keystonesTouched: string[]
  reachedCount: number
  reached: string[]
  unknownCount: number
}
export function impact(nodes: Record<string, BrainNode>, ids: string[], changedPaths: string[], opts?: { keystoneN?: number }): ImpactResult

export interface PathResult {
  found: boolean
  direction?: 'imports' | 'imported-by'
  path?: string[]
  missing?: string[]
}
export function pathBetween(nodes: Record<string, BrainNode>, from: string, to: string): PathResult

export interface VerifyResult {
  ok: boolean
  dir: string
  files: Record<string, 'ok' | 'mismatch' | 'missing'>
  scoredFrom: string | null
  headCommit: string | null
  current: boolean | null
  problems: string[]
  fingerprint: string | null
}
export function verify(root: string, opts?: { headCommit?: string | null }): VerifyResult
