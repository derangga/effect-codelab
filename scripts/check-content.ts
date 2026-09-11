/**
 * Renders every chapter through the markdown pipeline and asserts the three
 * things that must hold. Run with `bun run check:content`.
 *
 * This is the smallest thing that fails if the pipeline breaks. A twoslash
 * error in any chapter throws here, which is the point: broken teaching code
 * must not reach a reader.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from '../vite-plugin-markdown.ts'

const dir = join(import.meta.dirname, '..', 'content')
// Sorted so output reads in chapter order. readdir does not promise one.
const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()

assert.ok(files.length > 0, 'no chapters found in content/')

const seenSlugs = new Set<string>()
const seenOrders = new Set<number>()

for (const file of files) {
  const path = join(dir, file)
  const source = await readFile(path, 'utf8')

  // Twoslash failures name a line number inside one snippet, with no hint as
  // to which snippet or file. Catching here and pointing at the exact fence
  // turns a guessing game into a fix.
  let rendered: Awaited<ReturnType<typeof render>>
  try {
    rendered = await render(source, path)
  } catch (error) {
    console.error(`\nFAILED in ${file}`)

    // Re-render each twoslash fence on its own to find the one that throws.
    // Slower than the single pass, but this only runs on the failure path.
    const fences = [...source.matchAll(/^```(\w+[^\n]*)\n([\s\S]*?)^```$/gm)]
      .filter((f) => f[1].includes('twoslash'))
    for (const [index, fence] of fences.entries()) {
      const only = `---\ntitle: t\nsummary: s\norder: 0\nslug: s\n---\n\n\`\`\`${fence[1]}\n${fence[2]}\`\`\`\n`
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
        break
      }
    }
    console.error(
      `\nLine numbers in the error below count from the start of that snippet,\nafter any \`// ---cut---\`.\n`,
    )
    throw error
  }

  const { meta, headings, hasMermaid, html } = rendered

  assert.ok(meta.title, `${file}: missing frontmatter title`)
  assert.ok(meta.summary, `${file}: missing frontmatter summary`)
  assert.ok(
    !seenSlugs.has(meta.slug),
    `${file}: duplicate slug "${meta.slug}"`,
  )
  assert.ok(
    !seenOrders.has(meta.order),
    `${file}: duplicate order ${meta.order}`,
  )
  seenSlugs.add(meta.slug)
  seenOrders.add(meta.order)

  // Mermaid source must survive untouched, not get syntax highlighted.
  if (hasMermaid) {
    assert.match(
      html,
      /<pre class="mermaid">[^<]/,
      `${file}: mermaid block was mangled`,
    )
    assert.ok(
      !/<pre class="mermaid">\s*<span/.test(html),
      `${file}: mermaid block got highlighted`,
    )
    // Write literal < and > in diagram labels. The pipeline escapes them for
    // transport and the browser decodes them back. Writing the entity by hand
    // escapes the ampersand too, and the reader sees "&lt;" in the diagram.
    const diagram = html.slice(html.indexOf('<pre class="mermaid">'))
    assert.ok(
      !diagram.includes('&#x26;lt;') && !diagram.includes('&#x26;gt;'),
      `${file}: mermaid label has a double escaped entity, write < and > directly`,
    )
  }

  // Highlighting must be dual theme, otherwise dark mode shows black on black.
  // Only chapters that actually contain a non-mermaid code fence are checked.
  if (/^```(?!mermaid)\w/m.test(source)) {
    assert.ok(html.includes('shiki'), `${file}: code was not highlighted`)
    assert.ok(
      html.includes('--shiki-dark'),
      `${file}: highlighting is not dual theme`,
    )
  }

  // Prose rule: no em dashes anywhere in the rendered chapter.
  assert.ok(
    !source.includes('—'),
    `${file}: contains an em dash, use a comma or a full stop instead`,
  )

  console.log(
    `ok  ${file}  order=${meta.order}  headings=${headings.length}  mermaid=${hasMermaid}`,
  )
}

console.log(`\n${files.length} chapter(s) rendered clean.`)
