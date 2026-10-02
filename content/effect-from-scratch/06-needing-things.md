---
title: Needing things
order: 6
slug: 06-needing-things
summary: A function that reaches for a global database is hard to swap, so make the need a parameter of the effect and let the type say what is missing.
---

Here is a handler that loads a user and says hello.

```ts twoslash
declare const db: { find(id: number): Promise<string> }
// ---cut---
async function greet(id: number): Promise<string> {
  const name = await db.find(id)
  return `hello ${name}`
}
```

`db` is a module-level import. It works, and it makes `greet` hard to test,
because the only way to give it a fake database is to replace the module. It
also hides something. Reading the signature of `greet`, you would never learn
that it needs a database at all.

The usual fix is to pass the database in as a parameter. That is fine for one
function, and it spreads. A function three levels down needs a logger, so every
function above it takes a logger too, just to pass it along.

## Making the need part of the effect

Effect's answer is to put the need in the type, once, and let the type
carry it up for you. Widen the function one more time. An effect now takes an
`env`, the things it needs before it can run.

```ts twoslash
type Result<A, E> = { ok: true; value: A } | { ok: false; error: E }
// ---cut---
export interface Effect<A, E = never, R = unknown> {
  (env: R): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}
```

The third parameter `R` is the **requirement**. It is the type of the `env`
the effect has to be given. An effect that asks for a database is an
`Effect<string, never, { db: Db }>`.

The default is `unknown`. A function that takes an `unknown` accepts anything,
so an effect that needs nothing can run with anything, and the compiler
never asks for more. Real Effect writes this default as `never`, which says the
same thing the other way round.

Every combinator forwards the `env` and merges requirements. When two effects
run in a row, their needs add up, written as an intersection: the combined
effect needs `R & R2`.

## Services

A **service** is a named thing an effect asks for, such as a database or a
clock. To ask for one you need a key that names it and carries its type.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never, R = unknown> {
  (env: R): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}

export const make = <A, E, R>(run: (env: R) => Promise<Result<A, E>>): Effect<A, E, R> => {
  const self: Effect<A, E, R> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make<A, never, unknown>(async () => ok(a))
export const fail = <E>(e: E) => make<never, E, unknown>(async () => err(e))
export const sync = <A>(f: () => A) => make<A, never, unknown>(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) =>
  make<A, never, unknown>(async () => ok(await f()))

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
    make<B, E, R>(async (env) => {
      const r = await self(env)
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E | E2, R & R2>(async (env) => {
      const r = await self(env)
      return r.ok ? f(r.value)(env) : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E, any>] ? E : never
type EnvOf<Y> = [Y] extends [Effect<any, any, infer R>] ? R : unknown

export const gen = <Y extends Effect<any, any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>, EnvOf<Y>>(async (env) => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value(env)
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
    make<A | B, E2, R & R2>(async (env) => {
      const r = await self(env)
      return r.ok ? r : f(r.error)(env)
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A, E2, R>(async (env) => {
      const r = await self(env)
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2, R2>(fallback: Effect<B, E2, R2>) => catchAll(() => fallback)

export const result = <A, E, R>(self: Effect<A, E, R>) =>
  make<Result<A, E>, never, R>(async (env) => ok(await self(env)))

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
    make<A, E, unknown>(() => self(env))

export interface Clock {
  now(): number
}
export const Clock = tag<Clock>()('clock')

export const repeat =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A[], E, R>(async (env) => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self(env)
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env) => {
      for (let i = 0; ; i++) {
        const r = await self(env)
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R & { readonly clock: Clock }>(async (env) => {
      const start = env.clock.now()
      try {
        return await self(env)
      } finally {
        console.log(`${label} took ${env.clock.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>((env) => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(env), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self(undefined)
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
interface Db {
  find(id: number): Promise<string>
}
const Db = tag<Db>()('db')

const greet = gen(function* () {
  const db = yield* service(Db)
  return `hello ${yield* promise(() => db.find(1))}`
})
```

`tag<Db>()('db')` makes a key. The type argument is the shape of the service,
and the string is its name in the `env`. `service(Db)` is an effect that
produces the service and requires it. Hover `greet` and the requirement is
`{ readonly db: Db }`.

That requirement is now visible without opening the function. It also stops the
compiler from running it:

```ts
runPromise(greet)
// type error: an effect that needs { db: Db } cannot run with nothing
```

`runPromise` only accepts an effect whose requirement is `unknown`. This is the
point of the third parameter: a need cannot be forgotten, only satisfied.

## provide

`provide` is how the need gets satisfied. It takes an `env` and an effect that
needs it, and returns an effect that needs nothing.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never, R = unknown> {
  (env: R): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}

export const make = <A, E, R>(run: (env: R) => Promise<Result<A, E>>): Effect<A, E, R> => {
  const self: Effect<A, E, R> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make<A, never, unknown>(async () => ok(a))
export const fail = <E>(e: E) => make<never, E, unknown>(async () => err(e))
export const sync = <A>(f: () => A) => make<A, never, unknown>(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) =>
  make<A, never, unknown>(async () => ok(await f()))

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
    make<B, E, R>(async (env) => {
      const r = await self(env)
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E | E2, R & R2>(async (env) => {
      const r = await self(env)
      return r.ok ? f(r.value)(env) : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E, any>] ? E : never
type EnvOf<Y> = [Y] extends [Effect<any, any, infer R>] ? R : unknown

export const gen = <Y extends Effect<any, any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>, EnvOf<Y>>(async (env) => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value(env)
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
    make<A | B, E2, R & R2>(async (env) => {
      const r = await self(env)
      return r.ok ? r : f(r.error)(env)
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A, E2, R>(async (env) => {
      const r = await self(env)
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2, R2>(fallback: Effect<B, E2, R2>) => catchAll(() => fallback)

export const result = <A, E, R>(self: Effect<A, E, R>) =>
  make<Result<A, E>, never, R>(async (env) => ok(await self(env)))

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
    make<A, E, unknown>(() => self(env))

export interface Clock {
  now(): number
}
export const Clock = tag<Clock>()('clock')

export const repeat =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A[], E, R>(async (env) => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self(env)
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env) => {
      for (let i = 0; ; i++) {
        const r = await self(env)
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R & { readonly clock: Clock }>(async (env) => {
      const start = env.clock.now()
      try {
        return await self(env)
      } finally {
        console.log(`${label} took ${env.clock.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>((env) => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(env), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self(undefined)
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
interface Db {
  find(id: number): Promise<string>
}
const Db = tag<Db>()('db')
const greet = gen(function* () {
  const db = yield* service(Db)
  return `hello ${yield* promise(() => db.find(1))}`
})

const live: Db = { find: async (id) => `user ${id} from the database` }
const fake: Db = { find: async (id) => `user ${id} from a fixture` }

const withLive = pipe(greet, provide({ db: live }))
const withFake = pipe(greet, provide({ db: fake }))
```

One recipe, two ovens. `greet` was written once and neither version edits it.
In a test you provide the fake, and in the real program you provide the live one.

This version of `provide` supplies everything in one go. Real Effect builds
the `env` from small recipes called layers, which can depend on each other and
share one instance. That is a track of its own, and
[Layers](/learn/layers) is where it starts.

## The part people get wrong

Reading the service from a global inside the effect.

```ts
const greet = sync(() => `hello ${globalDb.find(1)}`)
```

This type-checks, and `R` stays `unknown`. The need is real and the type says
there is none, so `runPromise(greet)` compiles and you cannot swap the
database in a test. The requirement exists to be asked for through `service`.
Anything you take from outside the effect without asking is invisible to it.

## Try it

`timed` from chapter three reads `Date.now()`, so nothing can control the time
it reports. Change it to ask for a `Clock` service instead, and provide a fake
`Clock` that moves 50 milliseconds at each reading. Then `timed` becomes testable,
because a test can pin the duration it expects. The file below has it.

Here is `mini-effect.ts` with services. The demo provides a fake database and a
fake clock to the same effects.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never, R = unknown> {
  (env: R): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, any>
}

export const make = <A, E, R>(run: (env: R) => Promise<Result<A, E>>): Effect<A, E, R> => {
  const self: Effect<A, E, R> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make<A, never, unknown>(async () => ok(a))
export const fail = <E>(e: E) => make<never, E, unknown>(async () => err(e))
export const sync = <A>(f: () => A) => make<A, never, unknown>(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) =>
  make<A, never, unknown>(async () => ok(await f()))

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
    make<B, E, R>(async (env) => {
      const r = await self(env)
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2, R2>(f: (a: A) => Effect<B, E2, R2>) =>
  <E, R>(self: Effect<A, E, R>) =>
    make<B, E | E2, R & R2>(async (env) => {
      const r = await self(env)
      return r.ok ? f(r.value)(env) : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E, any>] ? E : never
type EnvOf<Y> = [Y] extends [Effect<any, any, infer R>] ? R : unknown

export const gen = <Y extends Effect<any, any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>, EnvOf<Y>>(async (env) => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value(env)
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
    make<A | B, E2, R & R2>(async (env) => {
      const r = await self(env)
      return r.ok ? r : f(r.error)(env)
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A, R>(self: Effect<A, E, R>) =>
    make<A, E2, R>(async (env) => {
      const r = await self(env)
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2, R2>(fallback: Effect<B, E2, R2>) => catchAll(() => fallback)

export const result = <A, E, R>(self: Effect<A, E, R>) =>
  make<Result<A, E>, never, R>(async (env) => ok(await self(env)))

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
    make<A, E, unknown>(() => self(env))

export interface Clock {
  now(): number
}
export const Clock = tag<Clock>()('clock')

export const repeat =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A[], E, R>(async (env) => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self(env)
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>(async (env) => {
      for (let i = 0; ; i++) {
        const r = await self(env)
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R & { readonly clock: Clock }>(async (env) => {
      const start = env.clock.now()
      try {
        return await self(env)
      } finally {
        console.log(`${label} took ${env.clock.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E, R>(self: Effect<A, E, R>) =>
    make<A, E, R>((env) => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(env), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self(undefined)
  if (!r.ok) throw r.error
  return r.value
}

const assert = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message)
}

const demo = async () => {
  interface Db {
    find(id: number): string
  }
  const Db = tag<Db>()('db')

  const greet = gen(function* () {
    const db = yield* service(Db)
    return `hello ${db.find(1)}`
  })
  // runPromise(greet) is a type error: greet still needs a Db.

  const live: Db = { find: (id) => `user ${id} from the database` }
  const fake: Db = { find: (id) => `user ${id} from a fixture` }
  console.log(await runPromise(pipe(greet, provide({ db: live }))))
  console.log(await runPromise(pipe(greet, provide({ db: fake }))))

  let t = 0
  const clock: Clock = { now: () => (t += 50) }
  const run = pipe(succeed('done'), timed('step'), provide({ clock }))
  assert((await runPromise(run)) === 'done', 'timed runs the effect')
  assert(t === 100, 'the fake clock was read twice')
}

await demo()
```

```sh
hello user 1 from the database
hello user 1 from a fixture
step took 50ms
```

The file has no way yet to stop work once it has started, or to clean up after
it. [The end of the world](/learn/effect-from-scratch/07-the-end-of-the-world)
adds both.
