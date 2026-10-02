---
title: A value that holds work
order: 2
slug: 02-a-value-that-holds-work
summary: Name the unran function an Effect, give it three constructors and one place where it runs, and the first piece of mini-effect.ts exists.
---

Suppose you want a list of three jobs to run later. You write the obvious thing:

```ts twoslash
let fired = 0

const jobs = [1, 2, 3].map((n) => {
  fired++
  console.log(`job ${n} ran`)
  return n * 10
})

console.log('jobs built, fired so far:', fired)
```

```sh
job 1 ran
job 2 ran
job 3 ran
jobs built, fired so far: 3
```

`jobs` is an array of numbers, not of jobs. Every call fired while the array was
being built. If you wanted to run them later, or only some of them, or in a
different order, that is already too late.

Chapter one's answer was a function in front of the work. Do that to each
element and the list holds recipes instead of results.

```ts twoslash
let fired = 0

const jobs = [1, 2, 3].map((n) => () => {
  fired++
  console.log(`job ${n} ran`)
  return n * 10
})

console.log('jobs built, fired so far:', fired)
console.log(jobs.map((job) => job()))
```

```sh
jobs built, fired so far: 0
job 1 ran
job 2 ran
job 3 ran
[ 10, 20, 30 ]
```

Nothing fired until the last line. Every element is a function that has not
run, and that is the type this track is about.

## Naming the type

```ts twoslash
type Effect<A> = () => A
```

An `Effect<A>` is a function that, when you finally call it, produces an `A`.
`A` is the type of the result, and until the call there is no result, only the
promise of one. The word is the same one the real library uses, and so is the
plan: build effects out of other effects, and run them once, at the end.

Two small constructors make effects out of things you already have.

```ts twoslash
type Effect<A> = () => A
// ---cut---
const succeed = <A>(a: A): Effect<A> => () => a
const sync = <A>(f: () => A): Effect<A> => () => f()

const one = succeed(1)
//    ^?
```

The two look alike and they are not the same. `succeed` wraps a value you
already have. `sync` wraps a computation, so it does not happen until the
effect runs.

```ts twoslash
type Effect<A> = () => A
const succeed = <A>(a: A): Effect<A> => () => a
const sync = <A>(f: () => A): Effect<A> => () => f()
// ---cut---
const now = succeed(Date.now())
const later = sync(() => Date.now())
```

`now` holds a timestamp taken at this line. `later` takes one each time it
runs.

## The end of the world

An effect that never runs does nothing, so something has to call it. Give that
a name and keep it to one function.

```ts twoslash
type Effect<A> = () => A
// ---cut---
const runSync = <A>(self: Effect<A>): A => self()
```

It is one call, and the track gives it a grand name for a reason. Every other
function you write from here on takes an effect and returns an effect, and none
of them does any work. `runSync` is where the work happens, the edge of the
program where the description meets the real world. Effect calls its version of
this the end of the world, and chapter seven comes back to why there should be
exactly one such place.

## The part people get wrong

Forgetting to call the thunk. A **thunk** is the plain name for a function that
exists only to delay a computation, and every effect in this chapter is one.

```ts
const hello = sync(() => console.log('hello'))
console.log(hello)
```

That prints `[Function: ...]` and not `hello`. Building an effect is not
running it. When nothing prints and you cannot see why, look for the missing
`runSync`.

## Try it

Write `fail`, an effect that throws an error you give it, and show that it
throws when you run it, not when you build it. Wrap `runSync` in `try`/`catch`
to prove the second half. The file below has an answer.

Here is `mini-effect.ts` so far, with a demo at the bottom.

```ts twoslash
// mini-effect.ts
export type Effect<A> = () => A

export const succeed = <A>(a: A): Effect<A> => () => a
export const sync = <A>(f: () => A): Effect<A> => () => f()
export const fail = (error: unknown): Effect<never> => () => {
  throw error
}

// The end of the world: the only function that calls the thunk.
export const runSync = <A>(self: Effect<A>): A => self()

const assert = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message)
}

const demo = () => {
  let fired = 0
  const steps: Effect<number>[] = [1, 2, 3].map((n) => sync(() => ++fired * n))
  assert(fired === 0, 'building the array must not run anything')
  console.log('built', steps.length, 'effects, fired', fired)

  console.log('results', steps.map(runSync))
  assert(fired === 3, 'each effect runs once per runSync')

  const boom = fail(new Error('boom'))
  let message = ''
  try {
    runSync(boom)
  } catch (e) {
    message = (e as Error).message
  }
  assert(message === 'boom', 'fail throws only when run')
  console.log('caught', message)
}

demo()
```

Run it with `bun mini-effect.ts`.

```sh
built 3 effects, fired 0
results [ 1, 4, 9 ]
caught boom
```

The `fail` here throws, which is the simplest thing that could work. It also
hides the failure from the type, since `Effect<never>` says nothing about what
was thrown. Chapter five fixes that on purpose.

The effects so far run synchronously, and real work does not. The next chapter
widens the type to a Promise, and that is what makes three useful helpers
possible: [The first superpowers](/learn/effect-from-scratch/03-the-first-superpowers).
