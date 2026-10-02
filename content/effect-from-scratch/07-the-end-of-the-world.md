---
title: The end of the world
order: 7
slug: 07-the-end-of-the-world
summary: runPromise is the one place work happens, so it is also the one place that can stop work, with an AbortSignal, and clean up after it, with ensuring.
---

Two pieces of code that most programs have, and that nothing in the last six
chapters can fix.

```ts twoslash
declare function showProduct(title: string): void
// ---cut---
async function loadAndShow(id: number) {
  const response = await fetch(`https://example.com/products/${id}`)
  const product = await response.json()
  showProduct(product.title)
}
```

If the user leaves the page while this runs, the request carries on and
`showProduct` fires on a page that is gone. Nothing told the work to stop.

```ts twoslash
declare function openFile(path: string): Promise<{ close(): Promise<void>; read(): Promise<string> }>
// ---cut---
async function firstLine(path: string) {
  const file = await openFile(path)
  const text = await file.read()
  await file.close()
  return text.split('\n')[0]
}
```

If `read` throws, `close` never runs. The handle stays open until the process
exits.

Both are the same gap. Work has a life: it starts, it can be stopped, and
whatever it opened needs to be closed whichever way it ends. The replica needs
a place that owns that life.

## One door

Every effect so far has been run by `runPromise`, and nothing else calls an
effect directly. That makes `runPromise` the kitchen door. Everything inside the
kitchen describes work, and everything that actually happens goes out through
this one door.

```ts twoslash
type Result<A, E> = { ok: true; value: A } | { ok: false; error: E }
interface Effect<A, E> {
  (env: unknown, signal: AbortSignal): Promise<Result<A, E>>
}
// ---cut---
export const runPromise = async <A, E>(
  self: Effect<A, E>,
  options: { signal?: AbortSignal } = {},
): Promise<A> => {
  const r = await self(undefined, options.signal ?? new AbortController().signal)
  if (!r.ok) throw r.error
  return r.value
}
```

A door can carry something with it. The only addition is an `AbortSignal`, the
standard browser and Bun object for "please stop". `runPromise` takes one in
its options and passes it to the effect. The effect type gets a second
parameter for it.

```ts twoslash
type Result<A, E> = { ok: true; value: A } | { ok: false; error: E }
// ---cut---
export interface Effect<A, E = never, R = unknown> {
  (env: R, signal: AbortSignal): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}
```

Every combinator forwards the signal the same way it forwards `env`. Three of
them go further.

`promise` hands the signal to the function you give it, so a `fetch` can listen.

```ts twoslash
declare const promise: <A>(f: (signal: AbortSignal) => Promise<A>) => unknown
// ---cut---
const loadProduct = (id: number) =>
  promise((signal) => fetch(`https://example.com/products/${id}`, { signal }))
```

`flatMap` and `gen` look at the signal between steps, with
`signal.throwIfAborted()`, so an aborted effect does not start its next step.

`timeout` can finally do what chapter three could not. When the time is up it
aborts its own child signal, which is the signal the inner effect sees, so the
slow work actually stops.

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
const slow = promise(
  (signal) => new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('done'), 1000)
    signal.addEventListener('abort', () => clearTimeout(timer))
  }),
)
const limited = pipe(slow, timeout(50))
```

## Cleanup that always runs

`ensuring` runs a function when the effect ends, however it ends.

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
const read = pipe(
  sync(() => 'contents'),
  ensuring(() => console.log('cleanup ran')),
)
```

It is a `try` with a `finally`, wrapped once so you do not rewrite it. It runs
on success, on a failure, and on abort.

For a resource that has to be opened first, `acquireUseRelease` pairs the three
steps. You give it the effect that opens the resource and a function that
releases it, and it gives back a function that takes the work to do in
between.

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
const file = acquireUseRelease(
  sync(() => ({ path: 'notes.txt', text: 'first line\nsecond' })),
  (handle) => console.log(`closed ${handle.path}`),
)

const firstLine = file((handle) => succeed(handle.text.split('\n')[0]))
```

`firstLine` opens the file when it runs, reads it, and closes it on every way
out. The name for it comes from the real library, which splits the same thing
into acquire, use and release.

## The part people get wrong

Running an effect inside another one. The replica lets you:

```ts
const inner = sync(() => runPromise(otherEffect))
```

It runs. It also starts `otherEffect` as a separate run, with a new empty
`env` and no signal, so the outer abort does not reach it and the services the
outer effect was given are lost. The door is one on purpose. If something needs
to happen inside an effect, make it an effect and compose it with `gen` or
`flatMap`, and call `runPromise` once at the edge.

## Try it

`retry` from chapter three keeps going after the effect is aborted. Change it so
it stops retrying as soon as `signal.aborted` is true. The shipped version does
it in one condition.

Here is the finished `mini-effect.ts`. Its demo opens a resource and closes it
on success and on failure, aborts a slow run and checks that cleanup still
happens, and aborts before a retry loop.

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

const assert = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message)
}

const demo = async () => {
  const logs: string[] = []
  const log = (line: string) => {
    console.log(line)
    logs.push(line)
  }

  // The resource has to be closed on success, on failure and on abort.
  const open = (name: string) =>
    sync(() => {
      log(`open ${name}`)
      return name
    })
  const file = acquireUseRelease(open('file'), (name) => log(`close ${name}`))

  const read = file((name) => succeed(`contents of ${name}`))
  assert((await runPromise(read)) === 'contents of file', 'success path')

  const broken = file(() => fail('disk full'))
  let failure: unknown
  try {
    await runPromise(broken)
  } catch (e) {
    failure = e
  }
  assert(failure === 'disk full', 'failure path')

  // Abort: a slow effect stops, its cleanup still runs, and retry gives up.
  const controller = new AbortController()
  const slow = pipe(
    promise(
      (signal) =>
        new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    ),
    ensuring(() => log('cleanup after abort')),
  )
  const running = runPromise(slow, { signal: controller.signal })
  controller.abort(new Error('page closed'))
  let reason = ''
  try {
    await running
  } catch (e) {
    reason = (e as Error).message
  }
  assert(reason === 'page closed', 'abort rejects the run')

  let attempts = 0
  const alwaysFails = make<never, string, unknown>(async () => (attempts++, err('nope')))
  const stop = new AbortController()
  stop.abort()
  await runPromise(pipe(alwaysFails, retry(10)), { signal: stop.signal }).catch(() => {})
  assert(attempts === 1, 'retry stops once aborted')

  assert(logs.filter((l) => l.startsWith('close')).length === 2, 'every open has a close')
  console.log('mini-effect: all checks passed')
}

await demo()
```

```sh
open file
close file
open file
close file
cleanup after abort
mini-effect: all checks passed
```

You have rebuilt the core of Effect. The last chapter puts the replica next to
the real thing, and says exactly where they differ:
[What Effect adds](/learn/effect-from-scratch/08-what-effect-adds).
