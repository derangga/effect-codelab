import { expect, test } from 'vitest'
import { render } from './vite-plugin-markdown.ts'

const chapter = (frontmatter: string) =>
  `---\n${frontmatter}\n---\n\nBody.\n`

test('an index.md renders as a track, keyed by its folder name', async () => {
  const { meta } = await render(
    chapter('title: Mental Model\norder: 1\nsummary: s\nicon: Brain\nprereq: none'),
    '/content/mental-model/index.md',
  )

  expect(meta).toMatchObject({
    kind: 'track',
    slug: 'mental-model',
    title: 'Mental Model',
    order: 1,
    icon: 'Brain',
    prereq: 'none',
  })
})

test('any other file renders as a chapter that knows its track', async () => {
  const { meta } = await render(
    chapter('title: Why Effect\norder: 1\nsummary: s'),
    '/content/basic-effect/01-why-effect.md',
  )

  expect(meta).toMatchObject({
    kind: 'chapter',
    track: 'basic-effect',
    slug: '01-why-effect',
    draft: false,
  })
})

test('draft is opt-in', async () => {
  const { meta } = await render(
    chapter('title: T\norder: 2\nsummary: s\ndraft: true'),
    '/content/fullstack-monorepo/02-todo.md',
  )

  expect(meta).toMatchObject({ kind: 'chapter', draft: true })
})

test('a frontmatter slug that disagrees with the filename fails the build', async () => {
  await expect(
    render(
      chapter('title: T\norder: 1\nsummary: s\nslug: renamed'),
      '/content/basic-effect/01-why-effect.md',
    ),
  ).rejects.toThrow('does not match the filename')
})

test('a track carries its theme and level', async () => {
  const { meta } = await render(
    chapter(
      'title: T\norder: 1\ntheme: foundations\nlevel: intermediate\nsummary: s',
    ),
    '/content/mental-model/index.md',
  )

  expect(meta).toMatchObject({ theme: 'foundations', level: 'intermediate' })
})

test('level falls back to beginner rather than passing a typo through', async () => {
  const { meta } = await render(
    chapter('title: T\norder: 1\nlevel: expert\nsummary: s'),
    '/content/mental-model/index.md',
  )

  expect(meta).toMatchObject({ level: 'beginner' })
})

test('reading time rounds up, so no page reports zero minutes', async () => {
  const { minutes } = await render(chapter('title: T\norder: 1\nsummary: s'), '/content/t/01-x.md')

  expect(minutes).toBe(1)
})

test('reading time counts code by the line, not as prose', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `const a${i} = ${i}`)
  const { minutes } = await render(
    `---\ntitle: T\norder: 1\nsummary: s\n---\n\n\`\`\`ts\n${lines.join('\n')}\n\`\`\`\n`,
    '/content/t/01-x.md',
  )

  // 62 fenced lines at 15 a minute is over four, where the same tokens read as
  // prose would have rounded to one.
  expect(minutes).toBeGreaterThan(3)
})

test('a type reveal nests its own pre inside a popup container', async () => {
  // chapter-content.tsx skips pre.shiki inside .twoslash-popup-container, so a
  // `^?` block does not get a Copy button covering the type it is revealing.
  // If a twoslash upgrade renames that class, the guard silently stops
  // matching and the button comes back. This is what fails first.
  const source = `---\ntitle: T\norder: 1\nsummary: s\n---\n\n\`\`\`ts twoslash
import { Effect } from 'effect'

const config = Effect.succeed({ retries: 3 })
//    ^?
\`\`\`\n`

  const { html } = await render(source, '/content/t/01-x.md')

  expect(html).toContain('twoslash-popup-container')
  // The reveal really does carry a nested pre, which is why the guard exists.
  const popup = html.slice(html.indexOf('twoslash-popup-container'))
  expect(popup).toContain('<pre class="shiki')
})
