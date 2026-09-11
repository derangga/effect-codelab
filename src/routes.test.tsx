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
  // The hero opens the first track and points at the demo.
  expect(text).toContain('Start with Mental Model')
  expect(html).toContain('/demo')
})

test('the home page groups its tracks under theme headings', async () => {
  const { text } = await render('/')

  expect(text).toContain('Foundations')
  expect(text).toContain('Building applications')
  // Foundations is listed first, as themes.json orders it.
  expect(text.indexOf('Foundations')).toBeLessThan(
    text.indexOf('Building applications'),
  )
})

test('a track card carries a level and a reading time', async () => {
  const { text } = await render('/')

  expect(text).toMatch(/Basic Effect .*beginner \d+ min/)
  // The prereq belongs on the track page, not on the card.
  expect(text).not.toContain('Assumes the Basic Effect track')
})

test('the home page carries no sidebar, every other page does', async () => {
  const home = await render('/')
  const chapter = await render('/learn/basic-effect/01-why-effect')

  expect(home.text).not.toContain('All tracks')
  expect(chapter.text).toContain('All tracks')
})

test('a track page lists its chapters', async () => {
  const { html, text } = await render('/learn/basic-effect')

  expect(text).toContain('Basic Effect')
  expect(html).toContain('/learn/basic-effect/01-why-effect')
  expect(html).toContain('/learn/basic-effect/10-testing')
})

test('a track page carries the level, the prereq and the total time', async () => {
  const { text } = await render('/learn/anti-patterns')

  expect(text).toContain('intermediate')
  expect(text).toContain('Assumes the Basic Effect track')
  expect(text).toMatch(/\d+ min in total/)
  // The theme it sits under, as a way back to the catalog.
  expect(text).toContain('Foundations')
})

test('every chapter row on a track page carries its own time', async () => {
  const { text } = await render('/learn/basic-effect')

  const rows = text.match(/\d+ min(?! in total)/g) ?? []
  expect(rows.length).toBe(10)
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
  // A way back out to the catalog, and up to the track's own page.
  expect(html).toContain('/learn/anti-patterns"')
  expect(text).toContain('All tracks')
})

test('the sidebar header names the track and its size', async () => {
  const { text } = await render('/learn/basic-effect/01-why-effect')

  expect(text).toContain('Basic Effect 10 pages')
})

test('nothing in the sidebar grows with the number of tracks', async () => {
  const { html } = await render('/learn/basic-effect/01-why-effect')

  // Every other track's page would be listed by a switcher. None are.
  for (const track of ['mental-model', 'anti-patterns', 'fullstack-monorepo']) {
    expect(html).not.toContain(`/learn/${track}`)
  }
})

test('off a track the sidebar is just the way back', async () => {
  const { html, text } = await render('/demo')

  expect(text).toContain('All tracks')
  expect(html).not.toContain('/learn/')
})

test('a draft chapter is badged in the sidebar and banners itself', async () => {
  const { text } = await render('/learn/mental-model/01-you-describe')

  // Neither of these code paths had a draft to render until Mental Model got
  // its stubs, so the test is what proves they work at all.
  expect(text).toContain('Draft')
  expect(text).toContain('This page is an outline')
})

test('a finished chapter carries no draft banner', async () => {
  const { text } = await render('/learn/mental-model/05-design-thinking')

  expect(text).not.toContain('This page is an outline')
})
