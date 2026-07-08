/* Read-only .git introspection for the producer: the HEAD commit (stamped into the
 * manifest as scoredFrom) and the origin owner/repo (stamped as repo.name). Pure
 * file reads, every failure returns null. Kept self-contained so @spiderbrain/create
 * stays independently installable. MIT. */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function findGitDir(dir) {
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

export function readHeadCommit(dir) {
  try {
    const git = findGitDir(dir)
    if (!git) return null
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim()
    if (/^[0-9a-f]{40}$/i.test(head)) return head
    const m = head.match(/^ref:\s*(.+)$/)
    if (!m) return null
    const refPath = m[1].trim()
    const loose = join(git, ...refPath.split('/'))
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    const packed = join(git, 'packed-refs')
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
    const cfg = readFileSync(join(git, 'config'), 'utf8')
    const m = cfg.match(/github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\s*$/mi)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch { return null }
}
