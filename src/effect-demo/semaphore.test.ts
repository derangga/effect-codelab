import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { heavyId, runTasks, taskIds, weight, type TaskState } from './semaphore'

/** Runs the simulator's program and returns the most permits held at once. */
const peak = async (permits: number, heavy: boolean) => {
  const held = new Map<number, number>()
  let max = 0
  await Effect.runPromise(
    runTasks({ permits, heavy, sleepMs: 5 }, (id: number, state: TaskState) => {
      if (state === 'running') held.set(id, weight(id, permits, heavy))
      else held.delete(id)
      max = Math.max(max, [...held.values()].reduce((a, b) => a + b, 0))
    }),
  )
  return max
}

test('never holds more permits than the semaphore has', async () => {
  expect(await peak(3, false)).toBe(3)
  expect(await peak(3, true)).toBeLessThanOrEqual(3)
  expect(await peak(1, true)).toBe(1)
})

test('every task finishes', async () => {
  const done = new Set<number>()
  await Effect.runPromise(
    runTasks({ permits: 2, heavy: true, sleepMs: 1 }, (id, state) => {
      if (state === 'done') done.add(id)
    }),
  )
  expect(done.size).toBe(taskIds.length)
  expect(weight(heavyId, 1, true)).toBe(1)
})
