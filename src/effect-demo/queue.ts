/**
 * The program behind the queue simulator, with no React in it so a test can
 * run it. It is the producer and consumer the chapter shows, plus one callback
 * so the component can draw each item as it moves.
 */
import { Cause, Effect, Fiber, Queue } from 'effect'

export const itemIds = Array.from({ length: 9 }, (_, i) => i + 1)

/**
 * Where an item is, in the order it gets there. `making` is the producer's
 * sleep. `offering` is the producer holding the item in `Queue.offer`, which
 * is where it suspends when the queue is full.
 */
export const stages = ['unmade', 'making', 'offering', 'queued', 'writing', 'written'] as const
export type Stage = (typeof stages)[number]

/**
 * An item only moves forward. The producer and the consumer are two fibers, so
 * `queued` from one can arrive after `writing` from the other for the same item.
 */
export const advance = (from: Stage, to: Stage): Stage =>
  stages.indexOf(to) > stages.indexOf(from) ? to : from

export const runQueue = (
  config: { capacity: number; produceMs: number; consumeMs: number },
  onChange: (id: number, stage: Stage) => void,
) =>
  Effect.gen(function* () {
    const emit = (id: number, stage: Stage) => Effect.sync(() => onChange(id, stage))
    const queue = yield* Queue.bounded<number, Cause.Done>(config.capacity)

    const producer = yield* Effect.forkChild(
      Effect.forEach(
        itemIds,
        (id) =>
          Effect.gen(function* () {
            yield* emit(id, 'making')
            yield* Effect.sleep(config.produceMs)
            yield* emit(id, 'offering')
            yield* Queue.offer(queue, id)
            // A take that frees a slot wakes this fiber before the consumer
            // has reported what it took. Yielding once lets that report land
            // first, so the drawing never shows more items than the queue holds.
            yield* Effect.yieldNow
            yield* emit(id, 'queued')
          }),
        { discard: true },
      ).pipe(Effect.andThen(Queue.end(queue))),
    )

    const consumer = yield* Effect.forkChild(
      Effect.forever(
        Effect.gen(function* () {
          const id = yield* Queue.take(queue)
          yield* emit(id, 'writing')
          yield* Effect.sleep(config.consumeMs)
          yield* emit(id, 'written')
        }),
      ).pipe(Effect.catchIf(Cause.isDone, () => Effect.void)),
    )

    yield* Fiber.join(producer)
    yield* Fiber.join(consumer)
  })
