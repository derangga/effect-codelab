/**
 * Checks every track page and chapter against the rules that must hold, from
 * the markdown source alone. Run with `bun run check:content`.
 *
 * Nothing here renders. Fumadocs owns rendering now, and its build compiles
 * every `ts twoslash` fence, so a snippet that does not typecheck fails there
 * rather than here. What is left is the set of rules a renderer would never
 * catch: frontmatter that is missing or disagrees with the filename, an order
 * used twice, a link to a page that does not exist.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'

/** The levels a track may declare. */
const LEVELS = ['beginner', 'intermediate']

// Defaults to the real content/. A directory argument lets the failure paths
// be exercised against fixtures.
const dir = process.argv[2] ?? join(import.meta.dirname, '..', 'content')

const stripFences = (markdown: string) =>
  markdown.replace(/^```[\s\S]*?^```$/gm, '')

/**
 * Read a page and apply the rules that hold for a track and a chapter alike.
 *
 * The em dash rule lives here rather than beside the prose rules below because
 * it is the one check a draft is not exempt from.
 */
async function read(path: string, label: string) {
  const source = await readFile(path, 'utf8')

  assert.ok(
    !source.includes('—'),
    `${label}: contains an em dash, use a comma or a full stop instead`,
  )

  const { data, content } = matter(source)
  return {
    source,
    data,
    headings: (stripFences(content).match(/^#{2,3} /gm) ?? []).length,
    hasMermaid: /^```mermaid$/m.test(content),
  }
}

// The catalog groups tracks by theme, so themes.json is what decides whether a
// track is reachable at all. Reading it here is what turns a typo in a theme
// slug from a track silently missing off the home page into a failed run.
const themes: Array<{ slug: string; title: string }> = JSON.parse(
  await readFile(join(dir, 'themes.json'), 'utf8'),
)
const themeSlugs = themes.map((theme) => theme.slug)

const entries = await readdir(dir, { withFileTypes: true })

const trackDirs = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

assert.ok(trackDirs.length > 0, 'no track folders found in content/')

const strayFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)

assert.deepEqual(
  strayFiles,
  [],
  `content/ holds loose chapters, every .md belongs to a track folder: ${strayFiles.join(', ')}`,
)

// Track order sequences a track within its theme, not across the site, so two
// themes may each hold an order 1. Tracks are validated first so the chapter
// output below can read in course order rather than readdir order.
const trackOrders = new Map<string, string>()
const validated: Array<{
  track: string
  files: Array<string>
  theme: string
  title: string
  order: number
  level: string
}> = []

for (const track of trackDirs) {
  const files = (await readdir(join(dir, track))).filter((f) =>
    f.endsWith('.md'),
  )

  assert.ok(
    files.includes('index.md'),
    `content/${track}: missing index.md, which every track folder needs`,
  )

  const label = `${track}/index.md`
  const { data } = await read(join(dir, track, 'index.md'), label)

  assert.ok(data.title, `${label}: missing frontmatter title`)
  assert.ok(data.summary, `${label}: missing frontmatter summary`)
  assert.ok(data.icon, `${label}: missing frontmatter icon, a lucide icon name`)
  assert.ok(
    data.prereq,
    `${label}: missing frontmatter prereq, one line on what this track assumes`,
  )
  assert.ok(
    themeSlugs.includes(data.theme),
    `${label}: theme "${data.theme}" is not in themes.json, which lists ${themeSlugs.join(', ')}`,
  )
  assert.ok(
    LEVELS.includes(data.level),
    `${label}: level "${data.level}" is not one of ${LEVELS.join(', ')}`,
  )

  const orderKey = `${data.theme}/${data.order}`
  assert.ok(
    !trackOrders.has(orderKey),
    `${label}: order ${data.order} is already used within theme "${data.theme}" by ${trackOrders.get(orderKey)}`,
  )
  trackOrders.set(orderKey, label)

  validated.push({
    track,
    files,
    theme: data.theme,
    title: data.title,
    order: data.order ?? 999,
    level: data.level,
  })
}

let chapterCount = 0
let draftCount = 0

// Chapters link across tracks now, so a link is a reference that can rot. Both
// sides are collected here and matched at the end, which is what stops a
// renamed chapter leaving a dead link in another track.
const internalLinks: Array<{ label: string; href: string }> = []
const pages = new Set<string>(['/', '/demo'])

// Images are skipped. `![alt](/x.webp)` points at a file the build copies out
// of public/, not at a page, so checking it against the page list would fail
// every image on the site.
function collectLinks(source: string, label: string) {
  for (const [, bang, href] of source.matchAll(
    /(!?)\[[^\]]*\]\((\/[^)\s]*)\)/g,
  )) {
    if (bang === '!') continue
    internalLinks.push({ label, href })
  }
}

// Read out in catalog order: themes as themes.json lists them, tracks ordered
// within their theme. The run output then reads the way the home page does.
const inCatalogOrder = themes.flatMap((theme) =>
  validated
    .filter((entry) => entry.theme === theme.slug)
    .sort((a, b) => a.order - b.order)
    .map((entry, index) => ({ ...entry, theme, first: index === 0 })),
)

for (const entry of inCatalogOrder) {
  const { track, files, title, order, level, theme, first } = entry
  const trackDir = join(dir, track)
  pages.add(`/learn/${track}`)
  collectLinks(
    await readFile(join(trackDir, 'index.md'), 'utf8'),
    `${track}/index.md`,
  )
  if (first) console.log(`\n== ${theme.title}  (${theme.slug})`)
  console.log(`\n${title}  (${track}, ${theme.slug} ${order}, ${level})`)

  // Orders are unique within a track, not across the app, so two tracks can
  // both open with an 01. Slugs are the filenames, so readdir already made
  // them unique; what is checked is that no frontmatter slug disagrees.
  const seenOrders = new Map<number, string>()

  for (const file of files.filter((f) => f !== 'index.md').sort()) {
    const label = `${track}/${file}`
    const slug = file.replace(/\.md$/, '')
    const { source, data, headings, hasMermaid } = await read(
      join(trackDir, file),
      label,
    )

    assert.ok(data.title, `${label}: missing frontmatter title`)
    assert.ok(data.summary, `${label}: missing frontmatter summary`)

    // The URL is the filename: Fumadocs routes by path and never reads this
    // field. A slug that disagrees is a second source of truth that no longer
    // decides anything, which is worse than not having one at all.
    assert.ok(
      data.slug === undefined || data.slug === slug,
      `${label}: frontmatter slug "${data.slug}" does not match the filename "${slug}"`,
    )
    assert.ok(
      !seenOrders.has(data.order),
      `${label}: order ${data.order} is already used by ${seenOrders.get(data.order)}`,
    )
    seenOrders.set(data.order, label)
    pages.add(`/learn/${track}/${slug}`)
    collectLinks(source, label)

    // A chapter must leave the reader able to run something. A draft is an
    // outline with no prose yet, so it is exempt until the prose arrives.
    if (data.draft !== true) {
      assert.match(
        source,
        /^```ts twoslash$/m,
        `${label}: no compiled snippet, every chapter must leave the reader something to run (or set draft: true)`,
      )
    }

    chapterCount++
    if (data.draft === true) draftCount++

    console.log(
      `  ok  ${String(data.order).padStart(2, '0')} ${file}  headings=${headings}  mermaid=${hasMermaid}${data.draft === true ? '  DRAFT' : ''}`,
    )
  }
}

for (const { label, href } of internalLinks) {
  assert.ok(
    pages.has(href),
    `${label}: links to ${href}, which is not a page on this site`,
  )
}

const drafts = draftCount > 0 ? `, ${draftCount} of them draft` : ''
const themed = themes.filter((theme) =>
  validated.some((entry) => entry.theme === theme.slug),
).length
console.log(
  `\n${themed} theme(s), ${trackDirs.length} track(s), ${chapterCount} chapter(s) checked clean${drafts}.`,
)
