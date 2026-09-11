import { expect, test } from 'vitest'
import {
  chapterBySlug,
  neighbours,
  nextTrack,
  themes,
  trackBySlug,
  tracks,
} from './content.ts'

test('every track folder is found, in catalog order', () => {
  expect(tracks.map((t) => t.meta.slug)).toEqual([
    'mental-model',
    'basic-effect',
    'anti-patterns',
    'fullstack-monorepo',
  ])
})

test('the catalog is two themes holding four tracks between them', () => {
  expect(themes.map((t) => t.slug)).toEqual(['foundations', 'applications'])
  expect(themes.flatMap((t) => t.tracks)).toHaveLength(4)
  expect(themes[0].tracks.map((t) => t.meta.title)).toEqual([
    'Mental Model',
    'Basic Effect',
    'Anti-patterns',
  ])
  expect(themes[1].tracks.map((t) => t.meta.title)).toEqual([
    'Fullstack Monorepo',
  ])
})

test('track order is per theme, so two themes may share an order', () => {
  const firsts = themes.map((t) => t.tracks.at(0)?.meta.order)

  expect(firsts).toEqual([1, 1])
})

test('a level is carried on every track', () => {
  expect(trackBySlug('basic-effect')?.meta.level).toBe('beginner')
  expect(trackBySlug('anti-patterns')?.meta.level).toBe('intermediate')
})

test('reading time is per page and sums over a track', () => {
  const basic = trackBySlug('basic-effect')
  const longest = Math.max(...(basic?.chapters.map((c) => c.minutes) ?? []))

  // Every page reports something, and no page reports zero.
  for (const chapter of basic?.chapters ?? []) {
    expect(chapter.minutes).toBeGreaterThan(0)
  }
  // The track total covers all ten chapters plus its own page, so it has to
  // exceed the single longest chapter by a wide margin.
  expect(basic?.totalMinutes).toBeGreaterThan(longest)
  expect(basic?.totalMinutes).toBeGreaterThan(30)
})

test("a track's total covers its own page as well as its chapters", () => {
  // Fullstack Monorepo was the empty track this used to pin the behaviour on.
  // It has chapters now, so the invariant is stated for every track instead:
  // the total is the page plus its chapters, and a track with no chapters
  // still reports the time to read the page itself.
  for (const track of tracks) {
    const chapters = track.chapters.reduce((sum, c) => sum + c.minutes, 0)

    expect(track.totalMinutes).toBe(track.minutes + chapters)
    expect(track.minutes).toBeGreaterThan(0)
  }
})

test('a track collects its own chapters, ordered', () => {
  const basic = tracks.find((t) => t.meta.slug === 'basic-effect')
  const slugs = basic?.chapters.map((c) => c.meta.slug)

  expect(slugs?.at(0)).toBe('01-why-effect')
  expect(slugs?.at(-1)).toBe('10-testing')
  expect(slugs).toEqual([...(slugs ?? [])].sort())
})

test('a chapter is addressed by its track', () => {
  expect(chapterBySlug('basic-effect', '01-why-effect')?.meta.title).toBe(
    'Why Effect',
  )
  expect(chapterBySlug('anti-patterns', '01-why-effect')).toBeUndefined()
})

test('neighbours stop at the track edges', () => {
  expect(neighbours('basic-effect', '01-why-effect').prev).toBeUndefined()
  expect(neighbours('basic-effect', '01-why-effect').next?.meta.slug).toBe(
    '02-three-channels',
  )
  expect(neighbours('basic-effect', '10-testing').next).toBeUndefined()
})

test('the last track has no track after it', () => {
  expect(nextTrack('mental-model')?.meta.slug).toBe('basic-effect')
  expect(nextTrack('fullstack-monorepo')).toBeUndefined()
})
