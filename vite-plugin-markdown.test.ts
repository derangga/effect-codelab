import { expect, test } from 'vitest'
import { render } from './vite-plugin-markdown.ts'

const chapter = (frontmatter: string) =>
  `---\n${frontmatter}\n---\n\nBody.\n`

test('a _track.md renders as a track, keyed by its folder name', async () => {
  const { meta } = await render(
    chapter('title: Mental Model\norder: 1\nsummary: s\nicon: Brain\nprereq: none'),
    '/content/mental-model/_track.md',
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
