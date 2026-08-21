/* Tiny read-only .git introspection (no git binary needed): HEAD commit and the
 * GitHub owner/repo of the origin remote. Pure file reads; every failure returns
 * null so callers degrade gracefully. MIT, zero deps. */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

/** Walk up from `dir` and return the real git directory, resolving the `gitdir: <path>`
 *  pointer file that a linked worktree or a submodule uses instead of a real .git directory.
 *
 *  Returning the pointer file itself made every later `join(git, 'HEAD')` read throw, so
 *  readHeadCommit returned null, and a null HEAD makes verify skip its staleness check and
 *  report success. A brain in a worktree verified clean no matter how stale it was.
 *
 *  Returns a string, unchanged from before, because this is exported as the "./git" subpath
 *  and is therefore public API. See gitCommonDir for the shared directory a worktree keeps
 *  config and packed-refs in. */
export function findGitDir(dir) {
  let cur = dir
  for (let i = 0; i < 40; i++) {
    const g = join(cur, '.git')
    if (existsSync(g)) {
      try {
        if (!statSync(g).isFile()) return g
        const m = readFileSync(g, 'utf8').match(/^gitdir:\s*(.+)$/m)
        if (!m) return null
        const target = m[1].trim()
        const resolved = isAbsolute(target) ? target : join(cur, target)
        return existsSync(resolved) ? resolved : null
      } catch { return null }
    }
    const up = join(cur, '..')
    if (up === cur) return null
    cur = up
  }
  return null
}

/** The directory holding shared state (config, packed-refs). A linked worktree's own gitdir
 *  contains a `commondir` file pointing at it; an ordinary clone has none, so this is the
 *  identity there. */
export function gitCommonDir(gitDir) {
  try {
    const cd = join(gitDir, 'commondir')
    if (!existsSync(cd)) return gitDir
    const rel = readFileSync(cd, 'utf8').trim()
    if (!rel) return gitDir
    return isAbsolute(rel) ? rel : join(gitDir, rel)
  } catch { return gitDir }
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
    /* A worktree keeps its own branch ref, so try its gitdir first and the shared
       directory second before falling back to the shared packed-refs. */
    for (const base of [git, gitCommonDir(git)]) {
      const loose = join(base, ...refPath.split('/'))
      if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    }
    // packed-refs: "<sha> <ref>" lines
    const packed = join(gitCommonDir(git), 'packed-refs')
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
    const cfg = readFileSync(join(gitCommonDir(git), 'config'), 'utf8')
    // git@github.com:owner/repo.git | https://github.com/owner/repo(.git)
    const m = cfg.match(/github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\s*$/mi)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch { return null }
}
