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

const track = (
  title: string,
  order: number,
  theme = 'foundations',
  level = 'beginner',
) =>
  `---\ntitle: ${title}\norder: ${order}\ntheme: ${theme}\nlevel: ${level}\nicon: Brain\nprereq: none\nsummary: s\n---\n\nBody.\n`

const THEMES = JSON.stringify([
  { slug: 'foundations', title: 'Foundations' },
  { slug: 'applications', title: 'Building applications' },
])

const chapter = (order: number, extra = '', body = '```ts twoslash\nconst a = 1\n```') =>
  `---\ntitle: T\norder: ${order}\nsummary: s\n${extra}---\n\n${body}\n`

/** Writes a content tree from a path -> contents map and runs the check on it. */
async function check(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'content-check-'))
  for (const [path, contents] of Object.entries({
    'themes.json': THEMES,
    ...files,
  })) {
    const full = join(dir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents)
  }

  try {
    const { stdout } = await run('bun', [script, dir])
    return { ok: true, stdout, stderr: '' }
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string }
    return { ok: false, stdout: String(stdout), stderr: String(stderr) }
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

test('two tracks in one theme cannot share an order', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1, 'foundations'),
    't1/01-x.md': chapter(1),
    't2/_track.md': track('T2', 1, 'foundations'),
    't2/01-x.md': chapter(1),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('already used within theme "foundations"')
})

test('two tracks in different themes may share an order', async () => {
  const { ok } = await check({
    't1/_track.md': track('T1', 1, 'foundations'),
    't1/01-x.md': chapter(1),
    't2/_track.md': track('T2', 1, 'applications'),
    't2/01-x.md': chapter(1),
  })

  expect(ok).toBe(true)
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

test('a track naming a theme themes.json does not list is rejected', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1, 'foundatoins'),
    't1/01-x.md': chapter(1),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('t1/_track.md: theme "foundatoins" is not in themes.json')
})

test('a level outside the allowed set is rejected', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1, 'foundations', 'advanced'),
    't1/01-x.md': chapter(1),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('level "advanced" is not one of beginner, intermediate')
})

test('the run output names each theme and the tracks under it', async () => {
  const { ok, stdout } = await check({
    't1/_track.md': track('T1', 1, 'foundations'),
    't1/01-x.md': chapter(1),
    't2/_track.md': track('T2', 1, 'applications'),
    't2/01-x.md': chapter(1),
  })

  expect(ok).toBe(true)
  expect(stdout).toContain('== Foundations  (foundations)')
  expect(stdout).toContain('== Building applications  (applications)')
  expect(stdout).toContain('2 theme(s), 2 track(s)')
})

test('a chapter linking to a page that does not exist is rejected', async () => {
  const { ok, stderr } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(
      1,
      '',
      'See [gone](/learn/t1/99-gone).\n\n```ts twoslash\nconst a = 1\n```',
    ),
  })

  expect(ok).toBe(false)
  expect(stderr).toContain('links to /learn/t1/99-gone')
})

test('a chapter linking to another track resolves', async () => {
  const { ok } = await check({
    't1/_track.md': track('T1', 1),
    't1/01-x.md': chapter(
      1,
      '',
      'See [there](/learn/t2/01-y).\n\n```ts twoslash\nconst a = 1\n```',
    ),
    't2/_track.md': track('T2', 2),
    't2/01-y.md': chapter(1),
  })

  expect(ok).toBe(true)
})
