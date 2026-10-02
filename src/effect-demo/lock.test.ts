import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { type BumpState, fiberIds, runBumps } from './lock'

/** Runs the simulator's program and returns the final counter and the most fibers between read and write at once. */
const run = async (locked: boolean) => {
  const states = new Map<number, BumpState>()
  let peak = 0
  const counter = await Effect.runPromise(
    runBumps({ locked, sleepMs: 5 }, (id, state) => {
      states.set(id, state)
      peak = Math.max(peak, [...states.values()].filter((s) => s === 'read').length)
    }),
  )
  return { counter, peak }
}

test('without the lock every fiber reads 0 and eight updates are lost', async () => {
  expect(await run(false)).toEqual({ counter: 1, peak: fiberIds.length })
})

test('with the lock one fiber at a time is between its read and its write', async () => {
  expect(await run(true)).toEqual({ counter: fiberIds.length, peak: 1 })
})
