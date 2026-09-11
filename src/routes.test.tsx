/**
 * Renders each route through the real router and reads the markup back. tsc
 * proves the links typecheck; this proves a reader actually gets a page.
 */
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import { routeTree } from './routeTree.gen.ts'

async function render(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const html = renderToString(<RouterProvider router={router} />)
  // The prose is written into the DOM by an effect, which does not run on the
  // server, so assertions here are about chrome and navigation, not chapter
  // body text.
  return { html, text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') }
}

test('the home page offers all four tracks', async () => {
  const { html, text } = await render('/')

  for (const track of [
    'mental-model',
    'basic-effect',
    'anti-patterns',
    'fullstack-monorepo',
  ]) {
    expect(html).toContain(`/learn/${track}`)
  }
  expect(text).toContain('Mental Model')
  expect(text).toContain('Assumes the Basic Effect track')
})

test('a track page lists its chapters', async () => {
  const { html, text } = await render('/learn/basic-effect')

  expect(text).toContain('Basic Effect')
  expect(html).toContain('/learn/basic-effect/01-why-effect')
  expect(html).toContain('/learn/basic-effect/10-testing')
})

test('an empty track says so rather than rendering a bare list', async () => {
  const { text } = await render('/learn/fullstack-monorepo')

  expect(text).toContain('no pages yet')
})

test('a chapter page links back to its track and on to the next chapter', async () => {
  const { html, text } = await render('/learn/basic-effect/02-three-channels')

  expect(text).toContain('The Three Channels')
  expect(html).toContain('/learn/basic-effect"')
  expect(html).toContain('/learn/basic-effect/01-why-effect')
  expect(html).toContain('/learn/basic-effect/03-building-effects')
})

test('the last chapter of a track offers the next track, not a next chapter', async () => {
  const { html, text } = await render('/learn/basic-effect/10-testing')

  expect(text).toContain('End of Basic Effect')
  expect(html).toContain('/learn/anti-patterns')
  expect(html).toContain('/learn/basic-effect/09-capstone')
})

test('the end of a track points at the track that follows it', async () => {
  const { html, text } = await render(
    '/learn/anti-patterns/05-testing-and-retries',
  )

  expect(text).toContain('End of Anti-patterns')
  expect(text).toContain('Fullstack Monorepo')
  expect(html).toContain('/learn/fullstack-monorepo')
})

test('a chapter in the wrong track is not found', async () => {
  const { text } = await render('/learn/anti-patterns/01-why-effect')

  expect(text).toContain('No such chapter')
})

test('an unknown track is not found', async () => {
  const { text } = await render('/learn/nope')

  expect(text).toContain('No such track')
})

test('the sidebar lists only the track being read', async () => {
  const { html, text } = await render('/learn/anti-patterns/03-errors')

  // Its own chapters are there.
  expect(html).toContain('/learn/anti-patterns/01-at-the-boundary')
  expect(html).toContain('/learn/anti-patterns/05-testing-and-retries')
  // Another track's chapters are not, which is the whole point of scoping it.
  expect(html).not.toContain('/learn/basic-effect/01-why-effect')
  // The switcher is present. Its menu items are portalled in on open, so
  // server markup carries the trigger rather than the other tracks' links.
  expect(html).toContain('aria-haspopup="menu"')
  // A link up to the track's own page, and the demo pinned outside the list.
  expect(html).toContain('/learn/anti-patterns"')
  expect(html).toContain('/demo')
  expect(text).toContain('Live demo')
})

test('the switcher names the track and its size', async () => {
  const { text } = await render('/learn/basic-effect/01-why-effect')

  expect(text).toContain('Basic Effect 10 pages')
})

test('off a track, the sidebar offers the tracks instead of chapters', async () => {
  const { html, text } = await render('/')

  expect(text).toContain('Learning Effect 4 tracks')
  expect(html).not.toContain('/learn/basic-effect/01-why-effect')
})
