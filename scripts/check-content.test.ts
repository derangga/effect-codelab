/**
 * The rules check:content enforces, each against the smallest content tree
 * that breaks it. These exist so loosening a rule fails here rather than
 * quietly letting a bad chapter through.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const run = promisify(execFile)

const script = join(import.meta.dirname, 'check-content.ts')

const track = (title: string, order: number) =>
  `---\ntitle: ${title}\norder: ${order}\nicon: Brain\nprereq: none\nsummary: s\n---\n\nBody.\n`

const chapter = (order: number, extra = '', body = '```ts twoslash\nconst a = 1\n```') =>
  `---\ntitle: T\norder: ${order}\nsummary: s\n${extra}---\n\n${body}\n`

/** Writes a content tree from a path -> contents map and runs the check on it. */
async function check(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'content-check-'))
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents)
  }

  try {
    await run('bun', [script, dir])
    return { ok: true, stderr: '' }
  } catch (error) {
    return { ok: false, stderr: String((error as { stderr?: string }).stderr) }
  }
}

test('a track folder without a _track.md is rejected', async () => {
  const { ok, stderr } = await check({ 't1/01-x.md': chapter(1) })

  expect(ok).toBe(false)
  expect(stderr).toContain('missing _track.md')
})

test('two chapters in one track cannot share an order', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1),
    't1/02-y.md': chapter(1),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('order 1 is already used by t1/01-x.md')
})

test('two tracks may each open with an 01', async () => {
  const { ok } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1),
    't2/_track.md': track('T2', 2),
    't2/01-x.md': chapter(1),
  })

  expect(ok).toBe(true)
})

test('two tracks cannot share an order, since it sequences the home page', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1),
    't2/_track.md': track('T2', 1),
    't2/01-x.md': chapter(1),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('order 1 is already used by t1/_track.md')
})

test('a chapter with no compiled snippet is rejected', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1, '', 'Prose only.'),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('no compiled snippet')
})

test('a draft is exempt from needing a snippet', async () => {
  const { ok } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1, 'draft: true\n', 'Prose only.'),
  })

  expect(ok).toBe(true)
})

test('a chapter loose at the top of content/ is rejected', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1),
    'loose.md': chapter(1),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('every .md belongs to a track folder')
})

test('an em dash is rejected, draft or not', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1, 'draft: true\n', 'Effect is lazy — nothing runs.'),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('contains an em dash')
})

test('a frontmatter slug that disagrees with the filename is rejected', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(1, 'slug: renamed\n'),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('does not match the filename')
})
