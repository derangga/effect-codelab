---
title: The first superpowers
order: 3
slug: 03-the-first-superpowers
summary: Repeat, retry and time any effect without touching it, once the type is a function that returns a Promise.
---

Here is a function that does its job, and then does three other jobs that
have nothing to do with it.

```ts twoslash
declare function loadPrice(id: number): Promise<number>
// ---cut---
async function loadPriceSafely(id: number): Promise<number> {
  const start = Date.now()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const price = await loadPrice(id)
      console.log(`price took ${Date.now() - start}ms`)
      return price
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  throw new Error('unreachable')
}
```

The loop is retry logic. The `Date.now()` calls are timing. The business
function, `loadPrice`, is one line in the middle. You write this once for each
function you want to harden, and it is easy to get subtly wrong. The loop
above retries on every error, including the ones that can never succeed.

All three jobs are about how a piece of work gets run, and none of them is
about what the work is. When the work is a value, they can live outside it.

## Widening to a Promise

Real work is asynchronous, so first change the type from `() => A` to
`() => Promise<A>`. `runSync` becomes `runPromise`, and `succeed` and `sync`
get an `async` in front.

```ts twoslash
export type Effect<A> = () => Promise<A>

export const succeed = <A>(a: A): Effect<A> => async () => a
export const sync = <A>(f: () => A): Effect<A> => async () => f()
export const promise = <A>(f: () => Promise<A>): Effect<A> => f

export const runPromise = <A>(self: Effect<A>): Promise<A> => self()
```

`promise` is the bridge from the code you have. Hand it a function that
returns a Promise and you get an effect. It is the same `() => fetchProduct(1)`
you wrote in chapter one, now with a name.

## Helpers that take an effect and return an effect

One more small function makes them pleasant to chain.

```ts twoslash
export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}
```

`pipe(x, f, g)` is `g(f(x))` written in the order you read it. It is not an
effect helper, and the real library exports the same function.

Now the three helpers. Each one takes an effect and returns a new effect that
wraps it.

**`repeat`** is control flow. It runs the same effect `n` times and collects the
results.

```ts twoslash
type Effect<A> = () => Promise<A>
// ---cut---
export const repeat =
  (n: number) =>
  <A>(self: Effect<A>): Effect<A[]> =>
  async () => {
    const out: A[] = []
    for (let i = 0; i < n; i++) out.push(await self())
    return out
  }
```

**`retry`** is resilience. It runs the effect again when it throws, up to `n`
extra times, and gives up with the last error.

```ts twoslash
type Effect<A> = () => Promise<A>
// ---cut---
export const retry =
  (n: number) =>
  <A>(self: Effect<A>): Effect<A> =>
  async () => {
    for (let i = 0; ; i++) {
      try {
        return await self()
      } catch (error) {
        if (i >= n) throw error
      }
    }
  }
```

**`timed`** is instrumentation. It measures the wall time of whatever it wraps.

```ts twoslash
type Effect<A> = () => Promise<A>
// ---cut---
export const timed =
  (label: string) =>
  <A>(self: Effect<A>): Effect<A> =>
  async () => {
    const start = Date.now()
    try {
      return await self()
    } finally {
      console.log(`${label} took ${Date.now() - start}ms`)
    }
  }
```

None of them knows what the effect does. `retry` works on a price lookup, a
file read, or a database call, and the three stack in any order.

```ts twoslash
declare const pipe: (a: any, ...fns: Array<(x: any) => any>) => any
declare const retry: (n: number) => <A>(self: () => Promise<A>) => () => Promise<A>
declare const timed: (label: string) => <A>(self: () => Promise<A>) => () => Promise<A>
declare const loadPrice: (id: number) => () => Promise<number>
// ---cut---
const safePrice = pipe(loadPrice(1), retry(3), timed('price'))
```

`loadPriceSafely` from the top of the chapter was twelve lines. This is one,
and `loadPrice` stayed as simple as the day it was written.

## The part people get wrong

Retrying something that has already run. If `loadPrice(1)` returned a Promise,
which is the usual thing, then `retry` would receive a Promise that settled
before it was called, and a rejected Promise stays rejected however many times
you wait on it.

```ts
const price = loadPrice(1) // a Promise, already running
retry(3)(price) // type error: a Promise is not a function
```

`retry` only works because the thing it gets is a recipe. This is the same
point as chapter one, in the shape you will meet it in real code.

## Try it

Write `timeout(ms)`. It takes an effect and rejects if the effect has not
finished in `ms` milliseconds. `Promise.race` between the effect and a timer is
enough. The file below has one.

Then notice what it cannot do. The race rejects, but the slow work underneath
keeps running to the end, because nothing told it to stop. Chapter seven fixes
that.

Here is `mini-effect.ts` with all of it, and a demo that retries a flaky effect,
repeats another, and times out a slow one.

```ts twoslash
// mini-effect.ts
export type Effect<A> = () => Promise<A>

export const succeed = <A>(a: A): Effect<A> => async () => a
export const sync = <A>(f: () => A): Effect<A> => async () => f()
export const promise = <A>(f: () => Promise<A>): Effect<A> => f
export const fail = (error: unknown): Effect<never> => async () => {
  throw error
}

export const runPromise = <A>(self: Effect<A>): Promise<A> => self()

export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  return fns.reduce((x, f) => f(x), a)
}

export const repeat =
  (n: number) =>
  <A>(self: Effect<A>): Effect<A[]> =>
  async () => {
    const out: A[] = []
    for (let i = 0; i < n; i++) out.push(await self())
    return out
  }

export const retry =
  (n: number) =>
  <A>(self: Effect<A>): Effect<A> =>
  async () => {
    for (let i = 0; ; i++) {
      try {
        return await self()
      } catch (error) {
        if (i >= n) throw error
      }
    }
  }

export const timed =
  (label: string) =>
  <A>(self: Effect<A>): Effect<A> =>
  async () => {
    const start = Date.now()
    try {
      return await self()
    } finally {
      console.log(`${label} took ${Date.now() - start}ms`)
    }
  }

export const timeout =
  (ms: number) =>
  <A>(self: Effect<A>): Effect<A> =>
  () => {
    let timer: ReturnType<typeof setTimeout>
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    })
    return Promise.race([self(), limit]).finally(() => clearTimeout(timer))
  }

const assert = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message)
}

const demo = async () => {
  let calls = 0
  const flaky = promise(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (++calls < 3) throw new Error(`attempt ${calls} failed`)
    return `ok after ${calls} calls`
  })
  const value = await runPromise(pipe(flaky, retry(5), timed('flaky')))
  assert(calls === 3, 'retry reruns the same recipe')
  console.log(value)

  let ticks = 0
  const tick = sync(() => ++ticks)
  console.log('repeat', await runPromise(pipe(tick, repeat(3))))

  const slow = promise(() => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200)))
  let message = ''
  try {
    await runPromise(pipe(slow, timeout(50)))
  } catch (e) {
    message = (e as Error).message
  }
  assert(message === 'timed out after 50ms', 'timeout rejects')
  console.log(message)
}

await demo()
```

```sh
flaky took 62ms
ok after 3 calls
repeat [ 1, 2, 3 ]
timed out after 50ms
```

The timing line depends on your machine. The next chapter is about building one
effect out of several: [Composing without running](/learn/effect-from-scratch/04-composing-without-running).
