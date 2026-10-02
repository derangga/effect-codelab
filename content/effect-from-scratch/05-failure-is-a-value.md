---
title: Failure is a value
order: 5
slug: 05-failure-is-a-value
summary: Throwing hides failure from the type, so widen the effect to return a Result, and expected failures become something the compiler can see and shrink.
---

Here is a login function that can go wrong in two ways a caller cares about.

```ts twoslash
class NotFound extends Error {}
class BadPassword extends Error {}
interface User { name: string }
declare function findUser(email: string): Promise<User | undefined>
declare function checkPassword(user: User, password: string): boolean
// ---cut---
async function login(email: string, password: string): Promise<User> {
  const user = await findUser(email)
  if (!user) throw new NotFound()
  if (!checkPassword(user, password)) throw new BadPassword()
  return user
}

async function handle() {
  try {
    await login('ada@example.com', 'hunter2')
  } catch (error) {
    console.log(error)
    //          ^?
  }
}
```

`Promise<User>` mentions neither error. A caller who wants to handle `NotFound`
differently from `BadPassword` has to catch an `unknown` and guess. Add a third
error next month and no caller will notice, because nothing in any type changed.

`throw` is invisible to the type system. The fix is to stop using it for things
you expect.

## Failure as a value

Make the result say which of two things happened.

```ts twoslash
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }
```

Now widen the effect. It still returns a Promise, and the Promise now holds a
`Result`. The second type parameter `E` is the error. The effect keeps its
type, so every helper can see it.

```ts twoslash
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }
// ---cut---
export interface Effect<A, E = never> {
  (): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E>, A, any>
}
```

`E` defaults to `never`, which means "cannot fail in a way you need to handle".
`succeed` and `sync` have it, and a new constructor, `fail`, is the way to make
one that has an `E`. This `fail` returns a failure instead of throwing, which
is a different job from the `fail` you wrote in chapter two.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never> {
  (): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E>, A, any>
}

export const make = <A, E>(run: () => Promise<Result<A, E>>): Effect<A, E> => {
  const self: Effect<A, E> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) => make(async () => ok(await f()))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(self: Effect<A, E>) =>
    make<B, E>(async () => {
      const r = await self()
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2>(f: (a: A) => Effect<B, E2>) =>
  <E>(self: Effect<A, E>) =>
    make<B, E | E2>(async () => {
      const r = await self()
      return r.ok ? f(r.value)() : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E>] ? E : never

export const gen = <Y extends Effect<any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>>(async () => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2>(f: (e: E) => Effect<B, E2>) =>
  <A>(self: Effect<A, E>) =>
    make<A | B, E2>(async () => {
      const r = await self()
      return r.ok ? r : f(r.error)()
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A>(self: Effect<A, E>) =>
    make<A, E2>(async () => {
      const r = await self()
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2>(fallback: Effect<B, E2>) => catchAll(() => fallback)

export const result = <A, E>(self: Effect<A, E>) =>
  make<Result<A, E>, never>(async () => ok(await self()))

export const repeat =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A[], E>(async () => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self()
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      for (let i = 0; ; i++) {
        const r = await self()
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      const start = Date.now()
      try {
        return await self()
      } finally {
        console.log(`${label} took ${Date.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(() => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self()
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
class NotFound { readonly _tag = 'NotFound' }
class BadPassword { readonly _tag = 'BadPassword' }
interface User { name: string }

const login = (n: number): Effect<User, NotFound | BadPassword> =>
  n === 0 ? fail(new NotFound()) : n === 1 ? fail(new BadPassword()) : succeed({ name: 'ada' })

const attempt = login(1)
//    ^?
```

The type now says what can go wrong. `NotFound | BadPassword` is a union of the
two error classes. Each carries a `_tag` field, a literal string that lets the
compiler tell them apart.

Helpers that combine effects have to combine their errors too. `flatMap`
returns an effect whose error is the first one's `E` or the second one's, and
`gen` collects the errors of everything you `yield*`.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never> {
  (): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E>, A, any>
}

export const make = <A, E>(run: () => Promise<Result<A, E>>): Effect<A, E> => {
  const self: Effect<A, E> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) => make(async () => ok(await f()))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(self: Effect<A, E>) =>
    make<B, E>(async () => {
      const r = await self()
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2>(f: (a: A) => Effect<B, E2>) =>
  <E>(self: Effect<A, E>) =>
    make<B, E | E2>(async () => {
      const r = await self()
      return r.ok ? f(r.value)() : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E>] ? E : never

export const gen = <Y extends Effect<any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>>(async () => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2>(f: (e: E) => Effect<B, E2>) =>
  <A>(self: Effect<A, E>) =>
    make<A | B, E2>(async () => {
      const r = await self()
      return r.ok ? r : f(r.error)()
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A>(self: Effect<A, E>) =>
    make<A, E2>(async () => {
      const r = await self()
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2>(fallback: Effect<B, E2>) => catchAll(() => fallback)

export const result = <A, E>(self: Effect<A, E>) =>
  make<Result<A, E>, never>(async () => ok(await self()))

export const repeat =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A[], E>(async () => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self()
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      for (let i = 0; ; i++) {
        const r = await self()
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      const start = Date.now()
      try {
        return await self()
      } finally {
        console.log(`${label} took ${Date.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(() => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self()
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
declare const findUser: (email: string) => Effect<{ name: string }, 'NotFound'>
declare const checkPassword: (name: string) => Effect<boolean, 'BadPassword'>

const verified: Effect<boolean, 'NotFound' | 'BadPassword'> = gen(function* () {
  const user = yield* findUser('ada@example.com')
  return yield* checkPassword(user.name)
})
```

The annotation on `verified` is checked by the compiler. Delete it and hover the
name, and the error is still `'NotFound' | 'BadPassword'`, because `gen` read it
off the effects you yielded.

## Handling an error and watching the type shrink

`catchAll` takes a function from the error to a fallback effect.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never> {
  (): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E>, A, any>
}

export const make = <A, E>(run: () => Promise<Result<A, E>>): Effect<A, E> => {
  const self: Effect<A, E> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) => make(async () => ok(await f()))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(self: Effect<A, E>) =>
    make<B, E>(async () => {
      const r = await self()
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2>(f: (a: A) => Effect<B, E2>) =>
  <E>(self: Effect<A, E>) =>
    make<B, E | E2>(async () => {
      const r = await self()
      return r.ok ? f(r.value)() : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E>] ? E : never

export const gen = <Y extends Effect<any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>>(async () => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2>(f: (e: E) => Effect<B, E2>) =>
  <A>(self: Effect<A, E>) =>
    make<A | B, E2>(async () => {
      const r = await self()
      return r.ok ? r : f(r.error)()
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A>(self: Effect<A, E>) =>
    make<A, E2>(async () => {
      const r = await self()
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2>(fallback: Effect<B, E2>) => catchAll(() => fallback)

export const result = <A, E>(self: Effect<A, E>) =>
  make<Result<A, E>, never>(async () => ok(await self()))

export const repeat =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A[], E>(async () => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self()
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      for (let i = 0; ; i++) {
        const r = await self()
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      const start = Date.now()
      try {
        return await self()
      } finally {
        console.log(`${label} took ${Date.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(() => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self()
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
type Failure = { _tag: 'NotFound' } | { _tag: 'BadPassword' }
declare const login: (n: number) => Effect<{ name: string }, Failure>

const withGuest: Effect<{ name: string }, { _tag: 'BadPassword' }> = pipe(
  login(0),
  catchAll((e) => (e._tag === 'NotFound' ? succeed({ name: 'guest' }) : fail(e))),
)
```

In the handler `e._tag === 'NotFound'` narrows `e`, so the `fail(e)` branch only
passes on the other error. Hover `withGuest` and the error is a single
`BadPassword`. `NotFound` is gone because the code handled it, and the
compiler agrees.

Two small cousins finish the set. `mapError` changes the error on the way out,
and `orElse` runs a fallback effect if anything failed.

## Expected failures and bugs

There are two kinds of things that go wrong, and they get two treatments.

A delivery that cannot be made, because the address does not exist, is an
expected failure. It has a label on the box, and the error type says what the
label is. That is `E`.

A fire alarm is a bug: a null that should not be null, a typo, an exception
from a library. You did not plan for it and no caller can recover in a useful
way. It is called a **defect**. In the replica a defect is simply a thrown
exception, and it goes straight through every `catchAll` as a rejected Promise.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never> {
  (): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E>, A, any>
}

export const make = <A, E>(run: () => Promise<Result<A, E>>): Effect<A, E> => {
  const self: Effect<A, E> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) => make(async () => ok(await f()))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(self: Effect<A, E>) =>
    make<B, E>(async () => {
      const r = await self()
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2>(f: (a: A) => Effect<B, E2>) =>
  <E>(self: Effect<A, E>) =>
    make<B, E | E2>(async () => {
      const r = await self()
      return r.ok ? f(r.value)() : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E>] ? E : never

export const gen = <Y extends Effect<any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>>(async () => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2>(f: (e: E) => Effect<B, E2>) =>
  <A>(self: Effect<A, E>) =>
    make<A | B, E2>(async () => {
      const r = await self()
      return r.ok ? r : f(r.error)()
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A>(self: Effect<A, E>) =>
    make<A, E2>(async () => {
      const r = await self()
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2>(fallback: Effect<B, E2>) => catchAll(() => fallback)

export const result = <A, E>(self: Effect<A, E>) =>
  make<Result<A, E>, never>(async () => ok(await self()))

export const repeat =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A[], E>(async () => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self()
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      for (let i = 0; ; i++) {
        const r = await self()
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      const start = Date.now()
      try {
        return await self()
      } finally {
        console.log(`${label} took ${Date.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(() => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self()
  if (!r.ok) throw r.error
  return r.value
}
// ---cut---
const bug = sync(() => {
  throw new Error('a bug')
})
const safe = pipe(bug, orElse(succeed(0)))
// runPromise(safe) still rejects with "a bug"
```

Expected failures belong in the type, and bugs belong in the logs.

## The part people get wrong

Using `throw` for something you expected, then losing the type. It is tempting
because it is shorter, and it works until a caller needs to react to it. If a
caller will want to handle the case, return it with `fail`. If it means the
program is wrong, throw.

## Try it

Write `orElse(fallback)` as a function of `catchAll`, in one line, and check
that after `orElse(succeed(0))` the error type is `never`. Both versions are in
the file below.

This is `mini-effect.ts` with `Result`, the error channel, and the handlers.
A **channel** here means one of the type parameters of an effect: the success
value is one channel and the error is another. `result` turns an effect into
one that succeeds with the `Result`, so you can look at it.

```ts twoslash
// mini-effect.ts
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E }

const ok = <A>(value: A): Result<A, never> => ({ ok: true, value })
const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Effect<A, E = never> {
  (): Promise<Result<A, E>>
  [Symbol.iterator](): Generator<Effect<A, E>, A, any>
}

export const make = <A, E>(run: () => Promise<Result<A, E>>): Effect<A, E> => {
  const self: Effect<A, E> = Object.assign(run, {
    *[Symbol.iterator]() {
      return (yield self) as A
    },
  })
  return self
}

export const succeed = <A>(a: A) => make(async () => ok(a))
export const fail = <E>(e: E) => make(async () => err(e))
export const sync = <A>(f: () => A) => make(async () => ok(f()))
export const promise = <A>(f: () => Promise<A>) => make(async () => ok(await f()))

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(self: Effect<A, E>) =>
    make<B, E>(async () => {
      const r = await self()
      return r.ok ? ok(f(r.value)) : r
    })

export const flatMap =
  <A, B, E2>(f: (a: A) => Effect<B, E2>) =>
  <E>(self: Effect<A, E>) =>
    make<B, E | E2>(async () => {
      const r = await self()
      return r.ok ? f(r.value)() : r
    })

type ErrorOf<Y> = [Y] extends [Effect<any, infer E>] ? E : never

export const gen = <Y extends Effect<any, any>, A>(body: () => Generator<Y, A, any>) =>
  make<A, ErrorOf<Y>>(async () => {
    const it = body()
    let step = it.next()
    while (!step.done) {
      const r = await step.value()
      if (!r.ok) {
        it.return(undefined as never)
        return r
      }
      step = it.next(r.value)
    }
    return ok(step.value)
  })

export const catchAll =
  <E, B, E2>(f: (e: E) => Effect<B, E2>) =>
  <A>(self: Effect<A, E>) =>
    make<A | B, E2>(async () => {
      const r = await self()
      return r.ok ? r : f(r.error)()
    })

export const mapError =
  <E, E2>(f: (e: E) => E2) =>
  <A>(self: Effect<A, E>) =>
    make<A, E2>(async () => {
      const r = await self()
      return r.ok ? r : err(f(r.error))
    })

export const orElse = <B, E2>(fallback: Effect<B, E2>) => catchAll(() => fallback)

export const result = <A, E>(self: Effect<A, E>) =>
  make<Result<A, E>, never>(async () => ok(await self()))

export const repeat =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A[], E>(async () => {
      const out: A[] = []
      for (let i = 0; i < n; i++) {
        const r = await self()
        if (!r.ok) return r
        out.push(r.value)
      }
      return ok(out)
    })

export const retry =
  (n: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      for (let i = 0; ; i++) {
        const r = await self()
        if (r.ok || i >= n) return r
      }
    })

export const timed =
  (label: string) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(async () => {
      const start = Date.now()
      try {
        return await self()
      } finally {
        console.log(`${label} took ${Date.now() - start}ms`)
      }
    })

export const timeout =
  (ms: number) =>
  <A, E>(self: Effect<A, E>) =>
    make<A, E>(() => {
      let timer: ReturnType<typeof setTimeout>
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
      return Promise.race([self(), limit]).finally(() => clearTimeout(timer))
    })

export const runPromise = async <A, E>(self: Effect<A, E>): Promise<A> => {
  const r = await self()
  if (!r.ok) throw r.error
  return r.value
}

const assert = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message)
}

const demo = async () => {
  class NotFound {
    readonly _tag = 'NotFound'
  }
  class BadPassword {
    readonly _tag = 'BadPassword'
  }
  type User = { name: string }

  const login = (n: number): Effect<User, NotFound | BadPassword> =>
    n === 0 ? fail(new NotFound()) : n === 1 ? fail(new BadPassword()) : succeed({ name: 'ada' })

  const withGuest = pipe(
    login(0),
    catchAll((e) => (e._tag === 'NotFound' ? succeed({ name: 'guest' }) : fail(e))),
  )
  assert((await runPromise(withGuest)).name === 'guest', 'NotFound handled')

  const shown = await runPromise(result(login(1)))
  assert(!shown.ok && shown.error._tag === 'BadPassword', 'failure is a value')
  console.log('login(1) as a value:', JSON.stringify(shown))

  const safe = pipe(login(1), orElse(succeed({ name: 'fallback' })))
  assert((await runPromise(safe)).name === 'fallback', 'orElse')

  const bug = sync(() => {
    throw new Error('a bug')
  })
  let escaped = ''
  try {
    await runPromise(pipe(bug, orElse(succeed(0))))
  } catch (e) {
    escaped = (e as Error).message
  }
  assert(escaped === 'a bug', 'a defect skips catchAll')
  console.log('defect escaped catchAll:', escaped)
}

await demo()
```

```sh
login(1) as a value: {"ok":false,"error":{"_tag":"BadPassword"}}
defect escaped catchAll: a bug
```

The type has two parameters now. It is about to get a third, for the things an
effect needs before it can run: [Needing things](/learn/effect-from-scratch/06-needing-things).
