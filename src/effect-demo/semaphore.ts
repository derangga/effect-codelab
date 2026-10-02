/**
 * The program behind the semaphore simulator, with no React in it so a test
 * can run it. It is the code the chapter shows, plus one callback so the
 * component can draw each task as it changes state.
 */
import { Effect, Semaphore } from 'effect'

export const taskIds = Array.from({ length: 9 }, (_, i) => i + 1)

/** The task that takes two permits when the heavy toggle is on. */
export const heavyId = 4

export type TaskState = 'waiting' | 'running' | 'done'

/** How many permits a task holds. A task cannot ask for more than the total, which would wait forever. */
export const weight = (id: number, permits: number, heavy: boolean) =>
  heavy && id === heavyId ? Math.min(2, permits) : 1

export const runTasks = (
  config: { permits: number; heavy: boolean; sleepMs: number },
  onChange: (id: number, state: TaskState) => void,
) =>
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(config.permits)

    const task = (id: number) =>
      semaphore.withPermits(weight(id, config.permits, config.heavy))(
        Effect.suspend(() => {
          onChange(id, 'running')
          return Effect.sleep(config.sleepMs)
        }).pipe(Effect.ensuring(Effect.sync(() => onChange(id, 'done')))),
      )

    yield* Effect.all(taskIds.map(task), { concurrency: 'unbounded' })
  })
