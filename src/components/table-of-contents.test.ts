/**
 * The scroll spy's decision, which has been wrong twice: once marking nothing
 * at the foot of a page, once marking a stale heading after mermaid changed
 * the page height.
 */
import { expect, test } from 'vitest'
import { activeHeadingId } from './table-of-contents'

const tops = (...values: Array<number>) =>
  values.map((top, i) => ({ id: `h${i + 1}`, top }))

test('marks the last heading that has passed under the header', () => {
  expect(activeHeadingId(tops(-500, -40, 300, 900), false)).toBe('h2')
})

test('marks the first heading before anything has scrolled past', () => {
  expect(activeHeadingId(tops(200, 700, 1400), false)).toBe('h1')
})

test('marks the last heading at the foot of the page', () => {
  // The reported bug: a final section shorter than the viewport leaves its
  // heading at +506 with no scroll left, so the threshold never catches it.
  expect(activeHeadingId(tops(-900, -99, 506), true)).toBe('h3')
})

test('the foot of the page wins over the threshold', () => {
  // Every heading still ahead, and the document is at its end anyway: a very
  // short chapter under a tall viewport.
  expect(activeHeadingId(tops(120, 300), true)).toBe('h2')
})

test('no headings means nothing is marked', () => {
  expect(activeHeadingId([], false)).toBeUndefined()
  expect(activeHeadingId([], true)).toBeUndefined()
})
