import { expect, test } from 'vitest'
import { chapterBySlug, neighbours, nextTrack, tracks } from './content.ts'

test('every track folder is found, in reading order', () => {
  expect(tracks.map((t) => t.meta.slug)).toEqual([
    'mental-model',
    'basic-effect',
    'anti-patterns',
    'fullstack-monorepo',
  ])
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
