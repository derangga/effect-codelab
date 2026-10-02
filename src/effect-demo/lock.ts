/**
 * The program behind the lock simulator, with no React in it so a test can run
 * it. It is the counter the Lock chapter shows: every fiber reads the
 * counter, sleeps, then writes back what it read plus one. A one-permit
 * semaphore around those three steps is the lock.
 */
import { Effect, Ref, Semaphore } from 'effect'

export const fiberIds = Array.from({ length: 9 }, (_, i) => i + 1)

/** `read` covers the read and the sleep after it. `value` is what the fiber read or wrote. */
export type BumpState = 'waiting' | 'read' | 'wrote'

export const runBumps = (
  config: { locked: boolean; sleepMs: number },
  onChange: (id: number, state: BumpState, value: number) => void,
) =>
  Effect.gen(function* () {
    const counter = yield* Ref.make(0)
    const lock = yield* Semaphore.make(1)

    const bump = (id: number) => {
      const steps = Effect.gen(function* () {
        const n = yield* Ref.get(counter)
        onChange(id, 'read', n)
        yield* Effect.sleep(config.sleepMs)
        yield* Ref.set(counter, n + 1)
        onChange(id, 'wrote', n + 1)
      })
      return config.locked ? lock.withPermits(1)(steps) : steps
    }

    yield* Effect.all(fiberIds.map(bump), { concurrency: 'unbounded' })
    return yield* Ref.get(counter)
  })
