/* Tiny read-only .git introspection (no git binary needed): HEAD commit and the
 * GitHub owner/repo of the origin remote. Pure file reads; every failure returns
 * null so callers degrade gracefully. MIT, zero deps. */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Walk up from `dir` to the repo root (the directory holding .git). */
export function findGitDir(dir) {
  let cur = dir
  for (let i = 0; i < 40; i++) {
    const g = join(cur, '.git')
    if (existsSync(g)) return g
    const up = join(cur, '..')
    if (up === cur) return null
    cur = up
  }
  return null
}

/** The current HEAD commit sha, from .git files (handles symbolic refs, loose
 *  refs, packed-refs, and detached HEAD). Null when not a git repo. */
export function readHeadCommit(dir) {
  try {
    const git = findGitDir(dir)
    if (!git) return null
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim()
    if (/^[0-9a-f]{40}$/i.test(head)) return head // detached
    const m = head.match(/^ref:\s*(.+)$/)
    if (!m) return null
    const refPath = m[1].trim()
    const loose = join(git, ...refPath.split('/'))
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    // packed-refs: "<sha> <ref>" lines
    const packed = join(git, 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        if (line.endsWith(' ' + refPath)) return line.slice(0, 40)
      }
    }
    return null
  } catch { return null }
}

/** { owner, repo } of the origin remote when it points at GitHub, else null. */
export function readOriginOwnerRepo(dir) {
  try {
    const git = findGitDir(dir)
    if (!git) return null
    const cfg = readFileSync(join(git, 'config'), 'utf8')
    // git@github.com:owner/repo.git | https://github.com/owner/repo(.git)
    const m = cfg.match(/github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\s*$/mi)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch { return null }
}
