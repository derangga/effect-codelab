/**
 * Renders every track page and chapter through the markdown pipeline and
 * asserts the things that must hold. Run with `bun run check:content`.
 *
 * This is the smallest thing that fails if the pipeline breaks. A twoslash
 * error in any chapter throws here, which is the point: broken teaching code
 * must not reach a reader.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from '../vite-plugin-markdown.ts'

type Rendered = Awaited<ReturnType<typeof render>>

// Defaults to the real content/. A directory argument lets the failure paths
// be exercised against fixtures.
const dir = process.argv[2] ?? join(import.meta.dirname, '..', 'content')

/**
 * Twoslash failures name a line number inside one snippet, with no hint as to
 * which snippet or file. Re-rendering each fence alone finds the one that
 * throws and points at it, which turns a guessing game into a fix. Slower than
 * the single pass, so it only runs on the failure path.
 */
async function blameFence(source: string, path: string) {
  const fences = [
    ...source.matchAll(/^```(\w+[^\n]*)\n([\s\S]*?)^```$/gm),
  ].filter((f) => f[1].includes('twoslash'))

  for (const [index, fence] of fences.entries()) {
    // No slug in this frontmatter: render derives it from the filename, and a
    // slug that disagrees with the filename is itself an error.
    const only = `---\ntitle: t\nsummary: s\norder: 0\n---\n\n\`\`\`${fence[1]}\n${fence[2]}\`\`\`\n`
    try {
      await render(only, path)
    } catch {
      const numbered = fence[2]
        .split('\n')
        .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
        .join('\n')
      console.error(
        `twoslash block ${index + 1} of ${fences.length} is the one that fails:\n${numbered}`,
      )
      return
    }
  }
}

async function renderOrBlame(source: string, path: string, label: string) {
  try {
    return await render(source, path)
  } catch (error) {
    console.error(`\nFAILED in ${label}`)
    await blameFence(source, path)
    console.error(
      `\nLine numbers in the error below count from the start of that snippet,\nafter any \`// ---cut---\`.\n`,
    )
    throw error
  }
}

/** Rules that hold for a track page and a chapter alike. */
function checkRendered(
  { headings, hasMermaid, html }: Rendered,
  source: string,
  label: string,
) {
  // Mermaid source must survive untouched, not get syntax highlighted.
  if (hasMermaid) {
    assert.match(
      html,
      /<pre class="mermaid">[^<]/,
      `${label}: mermaid block was mangled`,
    )
    assert.ok(
      !/<pre class="mermaid">\s*<span/.test(html),
      `${label}: mermaid block got highlighted`,
    )
    // Write literal < and > in diagram labels. The pipeline escapes them for
    // transport and the browser decodes them back. Writing the entity by hand
    // escapes the ampersand too, and the reader sees "&lt;" in the diagram.
    const diagram = html.slice(html.indexOf('<pre class="mermaid">'))
    assert.ok(
      !diagram.includes('&#x26;lt;') && !diagram.includes('&#x26;gt;'),
      `${label}: mermaid label has a double escaped entity, write < and > directly`,
    )
  }

  // Highlighting must be dual theme, otherwise dark mode shows black on black.
  // Only pages that actually contain a non-mermaid code fence are checked.
  if (/^```(?!mermaid)\w/m.test(source)) {
    assert.ok(html.includes('shiki'), `${label}: code was not highlighted`)
    assert.ok(
      html.includes('--shiki-dark'),
      `${label}: highlighting is not dual theme`,
    )
  }

  // Prose rule: no em dashes anywhere.
  assert.ok(
    !source.includes('—'),
    `${label}: contains an em dash, use a comma or a full stop instead`,
  )

  return headings.length
}

const trackDirs = (await readdir(dir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

assert.ok(trackDirs.length > 0, 'no track folders found in content/')

const strayFiles = (await readdir(dir, { withFileTypes: true }))
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
const validated = []

for (const track of trackDirs) {
  const files = (await readdir(join(dir, track))).filter((f) =>
    f.endsWith('.md'),
  )

  assert.ok(
    files.includes('_track.md'),
    `content/${track}: missing _track.md, which every track folder needs`,
  )

  const trackPath = join(dir, track, '_track.md')
  const trackSource = await readFile(trackPath, 'utf8')
  const trackLabel = `${track}/_track.md`
  const trackPage = await renderOrBlame(trackSource, trackPath, trackLabel)
  const trackMeta = trackPage.meta

  assert.equal(
    trackMeta.kind,
    'track',
    `${trackLabel}: did not render as a track`,
  )
  if (trackMeta.kind !== 'track') continue

  assert.ok(trackMeta.title, `${trackLabel}: missing frontmatter title`)
  assert.ok(trackMeta.summary, `${trackLabel}: missing frontmatter summary`)
  assert.ok(
    trackMeta.icon,
    `${trackLabel}: missing frontmatter icon, a lucide icon name`,
  )
  assert.ok(
    trackMeta.prereq,
    `${trackLabel}: missing frontmatter prereq, one line on what this track assumes`,
  )
  const orderKey = `${trackMeta.theme}/${trackMeta.order}`
  assert.ok(
    !trackOrders.has(orderKey),
    `${trackLabel}: order ${trackMeta.order} is already used within theme "${trackMeta.theme}" by ${trackOrders.get(orderKey)}`,
  )
  trackOrders.set(orderKey, trackLabel)

  checkRendered(trackPage, trackSource, trackLabel)
  validated.push({ track, files, meta: trackMeta })
}

let chapterCount = 0
let draftCount = 0

for (const { track, files, meta: trackMeta } of validated.sort(
  (a, b) =>
    a.meta.theme.localeCompare(b.meta.theme) || a.meta.order - b.meta.order,
)) {
  const trackDir = join(dir, track)
  console.log(
    `\n${trackMeta.title}  (${track}, ${trackMeta.theme} ${trackMeta.order}, ${trackMeta.level})`,
  )

  // Slugs and orders are unique within a track, not across the app, so two
  // tracks can both open with an 01.
  const seenSlugs = new Set<string>()
  const seenOrders = new Map<number, string>()

  for (const file of files.filter((f) => f !== '_track.md').sort()) {
    const path = join(trackDir, file)
    const source = await readFile(path, 'utf8')
    const label = `${track}/${file}`
    const chapter = await renderOrBlame(source, path, label)
    const meta = chapter.meta

    assert.equal(meta.kind, 'chapter', `${label}: did not render as a chapter`)
    if (meta.kind !== 'chapter') continue

    assert.equal(
      meta.track,
      track,
      `${label}: rendered under track "${meta.track}"`,
    )
    assert.ok(meta.title, `${label}: missing frontmatter title`)
    assert.ok(meta.summary, `${label}: missing frontmatter summary`)
    assert.ok(
      !seenSlugs.has(meta.slug),
      `${label}: duplicate slug "${meta.slug}" within this track`,
    )
    assert.ok(
      !seenOrders.has(meta.order),
      `${label}: order ${meta.order} is already used by ${seenOrders.get(meta.order)}`,
    )
    seenSlugs.add(meta.slug)
    seenOrders.set(meta.order, label)

    const headings = checkRendered(chapter, source, label)

    // A chapter must leave the reader able to run something. A draft is an
    // outline with no prose yet, so it is exempt until the prose arrives.
    if (!meta.draft) {
      assert.match(
        source,
        /^```ts twoslash$/m,
        `${label}: no compiled snippet, every chapter must leave the reader something to run (or set draft: true)`,
      )
    }

    chapterCount++
    if (meta.draft) draftCount++

    console.log(
      `  ok  ${String(meta.order).padStart(2, '0')} ${file}  headings=${headings}  mermaid=${chapter.hasMermaid}${meta.draft ? '  DRAFT' : ''}`,
    )
  }
}

const drafts = draftCount > 0 ? `, ${draftCount} of them draft` : ''
console.log(
  `\n${trackDirs.length} track(s), ${chapterCount} chapter(s) rendered clean${drafts}.`,
)
