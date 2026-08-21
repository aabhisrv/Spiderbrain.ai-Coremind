/* Read-only .git introspection for the producer: the HEAD commit (stamped into the
 * manifest as scoredFrom) and the origin owner/repo (stamped as repo.name). Pure
 * file reads, every failure returns null. Kept self-contained so @spiderbrain/create
 * stays independently installable. MIT. */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

/* Resolve a .git that may be a POINTER FILE rather than a directory.
 *
 * In a linked worktree or a submodule, .git is a file whose contents are `gitdir: <path>`.
 * Returning that file made every subsequent readFileSync(join(git, ...)) throw, so
 * readHeadCommit returned null, the manifest recorded repo.commit: null, and verify had
 * nothing to compare HEAD against — reporting SUCCESS instead of staleness. A brain built in
 * a worktree verified clean forever. Reproduced with scripts/build-own-brain.mjs inside
 * `git worktree add`.
 *
 * Returns { dir, common }. `dir` holds HEAD and is per-worktree. `common` holds config, refs
 * and packed-refs and is shared; a worktree's gitdir contains a `commondir` file pointing at
 * it. They are the same path for an ordinary clone. */
function findGitDir(dir) {
  let cur = dir
  for (let i = 0; i < 40; i++) {
    const g = join(cur, '.git')
    if (existsSync(g)) {
      let gitDir = g
      try {
        if (statSync(g).isFile()) {
          const m = readFileSync(g, 'utf8').match(/^gitdir:\s*(.+)$/m)
          if (!m) return null
          const target = m[1].trim()
          gitDir = isAbsolute(target) ? target : join(cur, target)
          if (!existsSync(gitDir)) return null
        }
      } catch { return null }
      let common = gitDir
      try {
        const cd = join(gitDir, 'commondir')
        if (existsSync(cd)) {
          const rel = readFileSync(cd, 'utf8').trim()
          if (rel) common = isAbsolute(rel) ? rel : join(gitDir, rel)
        }
      } catch { /* an ordinary clone has no commondir */ }
      return { dir: gitDir, common }
    }
    const up = join(cur, '..')
    if (up === cur) return null
    cur = up
  }
  return null
}

export function readHeadCommit(dir) {
  try {
    const git = findGitDir(dir)
    if (!git) return null
    const head = readFileSync(join(git.dir, 'HEAD'), 'utf8').trim()
    if (/^[0-9a-f]{40}$/i.test(head)) return head
    const m = head.match(/^ref:\s*(.+)$/)
    if (!m) return null
    const refPath = m[1].trim()
    /* A worktree's branch ref may be loose in either directory, so try both before
       falling back to the shared packed-refs. */
    for (const base of [git.dir, git.common]) {
      const loose = join(base, ...refPath.split('/'))
      if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    }
    const packed = join(git.common, 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        if (line.endsWith(' ' + refPath)) return line.slice(0, 40)
      }
    }
    return null
  } catch { return null }
}

export function readOriginOwnerRepo(dir) {
  try {
    const git = findGitDir(dir)
    if (!git) return null
    const cfg = readFileSync(join(git.common, 'config'), 'utf8')
    const m = cfg.match(/github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\s*$/mi)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch { return null }
}
