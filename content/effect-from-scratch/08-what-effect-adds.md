---
title: What Effect adds
order: 8
slug: 08-what-effect-adds
summary: Run one program on the replica and on the real library, see that the difference is mostly a rename, then list what the replica leaves out.
---

Here is a program on the replica from the last chapter. It loads a user from a
database service, retries, and falls back to a guest.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never, R = unknown> {
  (env: R, signal: AbortSignal): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}

export const make = <A, E, R>(
  run: (env: R, signal: AbortSignal) => Promise<Result<A, E>>,
): Effect<A, E, R> => {
  const self: Effect<A, E, R> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: (signal: AbortSignal) => Promise<A>) =>
  make(async (_, signal) => ok(await f(signal)))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E, R>(async (env, signal) => {
      const r = await self(env, signal)
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E | E2, R & R2>(async (env, signal) => {
      const r = await self(env, signal)
      signal.throwIfAborted()
      return r.ok ? f(r.value)(env, signal) : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E, any>] ? E : never
type EnvOf<Y> = [Y] extends [Effect<any, any, infer R>] ? R : unknown

export const gen = <Y extends Effect<any, any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>, EnvOf<Y>>(async (env, signal) => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value(env, signal)
      signal.throwIfAborted()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2, R2>(f: (e: E) => Effect<B, E2, R2>) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A | B, E2, R & R2>(async (env, signal) => {
      const r = await self(env, signal)
      return r.ok ? r : f(r.error)(env, signal)
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A, E2, R>(async (env, signal) => {
      const r = await self(env, signal)
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2, R2>(fallback: Effect<B, E2, R2>) =>
  catchAll(() => fallback)

export const result = <A, E, R>(self: Effect<A, E, R>) =>
  make<Result<A, E>, never, R>(async (env, signal) => ok(await self(env, signal)))

export interface Tag<S, K extends string> {
  readonly key: K
  readonly _service?: S
}
export const tag =
  <S>() =>
  <const K extends string>(key: K): Tag<S, K> => ({ key })

export const service = <S, K extends string>(t: Tag<S, K>) =>
  make<S, never, { readonly [P in K]: S }>(async (env) => ok(env[t.key]))

export const provide =
  <R>(env: R) =>
  <A, E>(self: Effect<A, E, R>) =>
    make<A, E, unknown>((_, signal) => self(env, signal))

export interface Clock {
  now(): number
}
export const Clock = tag<Clock>()('clock')

export const repeat =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A[], E, R>(async (env, signal) => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self(env, signal)
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env, signal) => {
      for (let i = 0; ; i++) {
        const r = await self(env, signal)
        if (r.ok || i >= n || signal.aborted) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R & { readonly clock: Clock }>(async (env, signal) => {
      const start = env.clock.now()
      try {
        return await self(env, signal)
      } finally {
        console.log(`${label} took ${env.clock.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env, signal) => {
      const ctl = new AbortController()
      const forward = () => ctl.abort(signal.reason)
      signal.addEventListener('abort', forward)
      const timer = setTimeout(() => ctl.abort(new Error(`timed out after ${ms}ms`)), ms)
      const stopped = new Promise<never>((_, reject) =>
        ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason)),
      )
      try {
        return await Promise.race([self(env, ctl.signal), stopped])
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', forward)
      }
    })

export const ensuring =
  (cleanup: () => void | Promise<void>) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env, signal) => {
      try {
        return await self(env, signal)
      } finally {
        await cleanup()
      }
    })

export const acquireUseRelease =
  <A, E, R>(acquire: Effect<A, E, R>, release: (a: A) => void | Promise<void>) =>
  <B, E2, R2>(use: (a: A) => Effect<B, E2, R2>) =>
    make<B, E | E2, R & R2>(async (env, signal) => {
      const got = await acquire(env, signal)
      if (!got.ok) return got
      try {
        return await use(got.value)(env, signal)
      } finally {
        await release(got.value)
      }
    })

export const runPromise = async <A, E>(
  self: Effect<A, E>,
  options: { signal?: AbortSignal } = {},
): Promise<A> => {
  const r = await self(undefined, options.signal ?? new AbortController().signal)
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
class NotFound { readonly _tag = 'NotFound' }

interface Db {
  find(id: number): string | undefined
}
const Db = tag<Db>()('db')

const loadUser = (id: number) =>
  gen(function* () {
    const db = yield* service(Db)
    const name = db.find(id)
    if (name === undefined) return yield* fail(new NotFound())
    return name
  })

const program = pipe(
  loadUser(2),
  retry(2),
  catchAll(() => succeed('guest')),
  provide({ db: { find: (id: number) => (id === 1 ? 'ada' : undefined) } }),
)

runPromise(program).then(console.log)
```

It prints `guest`. Here is the same program on real Effect. Only the imports
and a handful of names change.

```ts twoslash
import { Context, Effect } from 'effect'

class NotFound {
  readonly _tag = 'NotFound'
}

class Db extends Context.Service<Db, { find(id: number): string | undefined }>()('Db') {}

const loadUser = (id: number) =>
  Effect.gen(function* () {
    const db = yield* Db
    const name = db.find(id)
    if (name === undefined) return yield* Effect.fail(new NotFound())
    return name
  })

const program = loadUser(2).pipe(
  Effect.retry({ times: 2 }),
  Effect.catch(() => Effect.succeed('guest')),
  Effect.provideService(Db, { find: (id: number) => (id === 1 ? 'ada' : undefined) }),
)

Effect.runPromise(program).then(console.log)
```

The shape is the same: a generator for the steps, a retry, a handler, a
provided service, one `runPromise` at the edge. Chapters one to seven are why
that program is not magic.

## The names

| replica | Effect | what is different |
| --- | --- | --- |
| `Effect<A, E, R>` | `Effect.Effect<A, E, R>` | the real one is an object with a runtime, not a function |
| `Result` | `Exit` | the real failure carries a cause, which also covers defects and interruption |
| `catchAll` | `Effect.catch` | |
| `orElse(fallback)` | `Effect.orElseSucceed`, `Effect.catch` | |
| `result` | `Effect.result`, `Effect.exit` | |
| `retry(n)` | `Effect.retry({ times: n })` | takes a schedule, so it can wait between tries |
| `repeat(n)` | `Effect.repeat` | also takes a schedule |
| `timeout(ms)` | `Effect.timeout` | fails with a typed `TimeoutError` instead of a defect |
| `timed(label)` | `Effect.timed` | returns the duration instead of logging it |
| `tag`, `service`, `provide` | `Context.Service`, `yield*` the service, `Effect.provideService` | the key is the class itself |
| `acquireUseRelease` | `Effect.acquireUseRelease` | the release step is itself an effect |
| `runPromise(e, { signal })` | `Effect.runPromise(e, { signal })` | |

Every row is a rename or a refinement, which was the point of using Effect's
names. Where the replica is simpler, the real version does the same job with
more care.

## What the replica leaves out

Six things, in roughly the order a real program would need them.

**Stack safety.** `flatMap` calls the effect inside it, which calls the effect
inside that. Chain enough of them and the call stack runs out. The real runtime
runs an effect with a loop and its own stack, so a chain of a million steps is fine.

**Fibers.** Real Effect runs everything on a **fiber**, a lightweight task that
the runtime schedules, can pause, and can interrupt. The replica leans on one
Promise chain and one `AbortSignal`, which is why there is no way to run two
effects at the same time and wait for both.

**A scheduler.** Real Effect decides when each fiber gets to run, so a long
computation yields to the others. The replica runs whatever the JavaScript
engine runs next.

**Structured concurrency.** When a fiber starts child fibers, the runtime
guarantees they finish or stop before the parent does. Abort in the replica
reaches exactly as far as the signal is passed by hand.

**Tracing.** Real Effect records where each step came from, so an error carries
a trace through the pipeline and spans can be shipped to a backend. The replica
keeps nothing. The [Observability](/learn/observability) track covers what you
get.

**Layers.** `provide` here hands over a finished `env`. A real **layer** is a
recipe that builds a service, may need other services, may fail, and cleans up
when the program ends. [Layers](/learn/layers) covers them.

## The part people get wrong

Believing the replica is almost Effect. It has the idea, an effect as a value
that holds work, and it has none of the safety. A program that nests a few
hundred thousand `flatMap`s will crash it, a stray `throw` skips every handler,
and any two effects that need to run side by side need a different engine. The
replica is for seeing how the real library works, not for running your
program.

## Try it

Find which replica function breaks first when you chain 100000 `flatMap`s. Build
the chain in a loop and run it.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never, R = unknown> {
  (env: R, signal: AbortSignal): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}

export const make = <A, E, R>(
  run: (env: R, signal: AbortSignal) => Promise<Result<A, E>>,
): Effect<A, E, R> => {
  const self: Effect<A, E, R> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: (signal: AbortSignal) => Promise<A>) =>
  make(async (_, signal) => ok(await f(signal)))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E, R>(async (env, signal) => {
      const r = await self(env, signal)
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E | E2, R & R2>(async (env, signal) => {
      const r = await self(env, signal)
      signal.throwIfAborted()
      return r.ok ? f(r.value)(env, signal) : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E, any>] ? E : never
type EnvOf<Y> = [Y] extends [Effect<any, any, infer R>] ? R : unknown

export const gen = <Y extends Effect<any, any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>, EnvOf<Y>>(async (env, signal) => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value(env, signal)
      signal.throwIfAborted()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2, R2>(f: (e: E) => Effect<B, E2, R2>) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A | B, E2, R & R2>(async (env, signal) => {
      const r = await self(env, signal)
      return r.ok ? r : f(r.error)(env, signal)
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A, E2, R>(async (env, signal) => {
      const r = await self(env, signal)
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2, R2>(fallback: Effect<B, E2, R2>) =>
  catchAll(() => fallback)

export const result = <A, E, R>(self: Effect<A, E, R>) =>
  make<Result<A, E>, never, R>(async (env, signal) => ok(await self(env, signal)))

export interface Tag<S, K extends string> {
  readonly key: K
  readonly _service?: S
}
export const tag =
  <S>() =>
  <const K extends string>(key: K): Tag<S, K> => ({ key })

export const service = <S, K extends string>(t: Tag<S, K>) =>
  make<S, never, { readonly [P in K]: S }>(async (env) => ok(env[t.key]))

export const provide =
  <R>(env: R) =>
  <A, E>(self: Effect<A, E, R>) =>
    make<A, E, unknown>((_, signal) => self(env, signal))

export interface Clock {
  now(): number
}
export const Clock = tag<Clock>()('clock')

export const repeat =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A[], E, R>(async (env, signal) => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self(env, signal)
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env, signal) => {
      for (let i = 0; ; i++) {
        const r = await self(env, signal)
        if (r.ok || i >= n || signal.aborted) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R & { readonly clock: Clock }>(async (env, signal) => {
      const start = env.clock.now()
      try {
        return await self(env, signal)
      } finally {
        console.log(`${label} took ${env.clock.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env, signal) => {
      const ctl = new AbortController()
      const forward = () => ctl.abort(signal.reason)
      signal.addEventListener('abort', forward)
      const timer = setTimeout(() => ctl.abort(new Error(`timed out after ${ms}ms`)), ms)
      const stopped = new Promise<never>((_, reject) =>
        ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason)),
      )
      try {
        return await Promise.race([self(env, ctl.signal), stopped])
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', forward)
      }
    })

export const ensuring =
  (cleanup: () => void | Promise<void>) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env, signal) => {
      try {
        return await self(env, signal)
      } finally {
        await cleanup()
      }
    })

export const acquireUseRelease =
  <A, E, R>(acquire: Effect<A, E, R>, release: (a: A) => void | Promise<void>) =>
  <B, E2, R2>(use: (a: A) => Effect<B, E2, R2>) =>
    make<B, E | E2, R & R2>(async (env, signal) => {
      const got = await acquire(env, signal)
      if (!got.ok) return got
      try {
        return await use(got.value)(env, signal)
      } finally {
        await release(got.value)
      }
    })

export const runPromise = async <A, E>(
  self: Effect<A, E>,
  options: { signal?: AbortSignal } = {},
): Promise<A> => {
  const r = await self(undefined, options.signal ?? new AbortController().signal)
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
let chain: Effect<number> = succeed(0)
for (let i = 0; i < 100_000; i++) {
  chain = pipe(chain, flatMap((n: number) => succeed(n + 1)))
}

runPromise(chain).then(
  (n) => console.log('finished', n),
  (error) => console.log('failed:', String(error)),
)
```

```sh
failed: RangeError: Maximum call stack size exceeded.
```

It is `flatMap`, and `map` has the same problem. The run function of each step
calls the run function of the one before it, so a left-nested chain of 100000
steps is 100000 calls deep before anything returns. Real Effect has no such
limit, and that gap is the largest single thing its runtime exists to close.

That is the end of the track. [Basic Effect](/learn/basic-effect) is the next
read, and now every function in it is one you have seen the insides of.
