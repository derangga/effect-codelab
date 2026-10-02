import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { advance, itemIds, runQueue, type Stage } from './queue'

/** Runs the simulator's program, calling `watch` with every item's stage after each change. */
const run = async (
  config: { capacity: number; produceMs: number; consumeMs: number },
  watch: (stages: ReadonlyMap<number, Stage>, id: number) => void = () => {},
) => {
  const stages = new Map<number, Stage>(itemIds.map((id) => [id, 'unmade']))
  await Effect.runPromise(
    runQueue(config, (id, stage) => {
      stages.set(id, advance(stages.get(id)!, stage))
      watch(stages, id)
    }),
  )
  return stages
}
const count = (stages: ReadonlyMap<number, Stage>, ...wanted: Array<Stage>) =>
  [...stages.values()].filter((stage) => wanted.includes(stage)).length

test('the queue never holds more than its capacity, and every item is written', async () => {
  let peak = 0
  const stages = await run({ capacity: 2, produceMs: 1, consumeMs: 10 }, (now) => {
    peak = Math.max(peak, count(now, 'queued'))
  })
  expect(peak).toBe(2)
  expect(count(stages, 'written')).toBe(itemIds.length)
})

test('a full queue holds the producer back', async () => {
  const last = itemIds.length
  let takenWhenLastQueued = -1
  await run({ capacity: 2, produceMs: 1, consumeMs: 10 }, (now, id) => {
    if (id === last && now.get(last) === 'queued' && takenWhenLastQueued < 0) {
      takenWhenLastQueued = count(now, 'writing', 'written')
    }
  })
  // The last item only fits once the consumer has taken all but a queue's worth.
  expect(takenWhenLastQueued).toBeGreaterThanOrEqual(last - 2 - 1)
})

test('an item never moves backwards', () => {
  expect(advance('writing', 'queued')).toBe('writing')
  expect(advance('queued', 'writing')).toBe('writing')
})
