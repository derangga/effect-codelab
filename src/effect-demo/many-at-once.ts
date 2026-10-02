/**
 * The program behind the "many at once" simulator, with no React in it so a
 * test can run it. It is the `Effect.forEach` the chapter shows, plus one
 * callback so the component can draw each task as it changes state.
 */
import { Effect } from 'effect'

export const taskIds = Array.from({ length: 9 }, (_, i) => i + 1)

/** The task that fails when the failing toggle is on. */
export const failingId = 6

export type TaskState = 'waiting' | 'running' | 'done' | 'failed' | 'interrupted'

export const runTasks = (
  config: { concurrency: number; failing: boolean; sleepMs: number },
  onChange: (id: number, state: TaskState) => void,
) => {
  const emit = (id: number, state: TaskState) => Effect.sync(() => onChange(id, state))

  const task = (id: number) =>
    Effect.suspend(() => {
      onChange(id, 'running')
      // The failing task fails halfway, while the tasks beside it are still running.
      return config.failing && id === failingId
        ? Effect.sleep(config.sleepMs / 2).pipe(Effect.andThen(Effect.fail('NotFound' as const)))
        : Effect.sleep(config.sleepMs)
    }).pipe(
      Effect.tap(() => emit(id, 'done')),
      Effect.tapError(() => emit(id, 'failed')),
      Effect.onInterrupt(() => emit(id, 'interrupted')),
    )

  return Effect.forEach(taskIds, task, { concurrency: config.concurrency, discard: true })
}
