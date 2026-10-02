import { Effect, Exit } from 'effect'
import { expect, test } from 'vitest'
import { failingId, runTasks, taskIds, type TaskState } from './many-at-once'

/** Runs the simulator's program and returns the final states and the most tasks running at once. */
const run = async (concurrency: number, failing: boolean) => {
  const states = new Map<number, TaskState>()
  let peak = 0
  const exit = await Effect.runPromiseExit(
    runTasks({ concurrency, failing, sleepMs: 10 }, (id, state) => {
      states.set(id, state)
      peak = Math.max(peak, [...states.values()].filter((s) => s === 'running').length)
    }),
  )
  return { states, peak, exit }
}

test('never runs more tasks than the concurrency option allows', async () => {
  expect((await run(1, false)).peak).toBe(1)
  expect((await run(3, false)).peak).toBe(3)
  expect((await run(9, false)).peak).toBe(9)
})

test('a failure interrupts the running tasks and never starts the waiting ones', async () => {
  const { states, exit } = await run(3, true)
  expect(Exit.isFailure(exit)).toBe(true)
  expect(states.get(failingId)).toBe('failed')
  // #4 and #5 share the wave with #6. #7 to #9 never get a state.
  expect(states.get(4)).toBe('interrupted')
  expect(states.get(5)).toBe('interrupted')
  expect(states.size).toBe(failingId)
  expect(taskIds.length).toBe(9)
})
