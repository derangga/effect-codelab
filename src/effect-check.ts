// ponytail: smallest thing that fails if effect@rc or the TS setup is wrong.
import { Effect } from 'effect'

const program: Effect.Effect<number, never, never> = Effect.succeed(1).pipe(
  Effect.map((n) => n + 1),
)

export const run = () => Effect.runPromise(program)
