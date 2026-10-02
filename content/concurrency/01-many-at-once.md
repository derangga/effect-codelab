---
title: Many at once
order: 1
slug: 01-many-at-once
summary: Run the nine product fetches together with the concurrency option on Effect.all and Effect.forEach.
---

The [Basic Effect](/learn/basic-effect) track fetched one product. A catalog
page needs nine. Run the nine fetches one after the other and the page takes
nine times as long as one fetch. Start all nine in the same instant and the
page is fast, but the API gets nine requests at once from every visitor.

One option picks a point between those two, and this chapter is about it.

## A fetch you can time

The real `fetchProduct` talks to the network, so it takes a different time on
every run. In this track a stand-in sleeps for 300 milliseconds and then
returns a product. Everything below works the same way on the real one.

```ts twoslash
import { Effect } from 'effect'

interface Product { id: number; title: string }

const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )

const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

## Effect.all runs one at a time

`Effect.all` takes a list of effects and returns one effect that produces the
list of their results.

```ts twoslash
import { Duration, Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
const program = Effect.gen(function* () {
  const fetches = ids.map(fetchProduct)
  const [duration, products] = yield* Effect.timed(Effect.all(fetches))
  console.log(products.length, Math.round(Duration.toMillis(duration)))
})

Effect.runPromise(program) // 9, then about 2700
```

`Effect.timed` runs an effect and returns how long it took next to its result.
Nine fetches of 300 milliseconds took 2700, so they ran one after the other.

That surprises people who know `Promise.all`. A Promise is already running by
the time you hold it, so `Promise.all` can only wait for work that has started.
An effect is a description of work that has not started. `ids.map(fetchProduct)`
built nine descriptions and sent nothing, so `Effect.all` gets to decide when
each one starts. With no options it starts the next one when the previous one
has finished.

## The concurrency option

Pass a second argument to change that.

```ts twoslash
import { Duration, Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
const program = Effect.gen(function* () {
  const fetches = ids.map(fetchProduct)

  const [all] = yield* Effect.timed(
    Effect.all(fetches, { concurrency: 'unbounded' }),
  )
  console.log(Math.round(Duration.toMillis(all))) // about 300

  const [three] = yield* Effect.timed(
    Effect.all(fetches, { concurrency: 3 }),
  )
  console.log(Math.round(Duration.toMillis(three))) // about 900
})

Effect.runPromise(program)
```

`'unbounded'` starts all nine at once, so the whole list takes as long as one
fetch. A number is a limit. With `concurrency: 3`, three fetches start, and
each time one of them finishes the next one in the list starts. At no moment
are more than three in flight.

The same list of effects ran twice in that program. That works because an
effect is a description, and running a description again does the work again.

The option changes when the work happens and nothing else. The type is the
same with or without it.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
const limited = Effect.all(ids.map(fetchProduct), { concurrency: 3 })
//    ^?
```

## forEach, when you hold ids instead of effects

Mapping a list and then passing it to `Effect.all` is common enough to have its
own function. `Effect.forEach` takes the list, the function, and the same
option.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
const products = Effect.forEach(ids, fetchProduct, { concurrency: 3 })
//    ^?
```

## Order and failure

Two things hold at every setting.

The results come back in the order of the input. Product 9 may finish before
product 1, and it is still last in the array.

The first failure ends the whole thing. Make product 6 fail and look at the
type.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
class NotFound extends Error {
  readonly _tag = 'NotFound'
}

const fetchOrFail = (id: number) =>
  id === 6 ? Effect.fail(new NotFound()) : fetchProduct(id)

const products = Effect.forEach(ids, fetchOrFail, { concurrency: 3 })
//    ^?
```

When product 6 fails, `Effect.forEach` fails with `NotFound`. The fetches that
were running beside it are interrupted, which means Effect stops them and runs
their cleanup. The fetches still waiting for a turn never start. You do not get
five products and an error. You get the error.

## Try it

Nine tasks sleep for 600 milliseconds each, inside one `Effect.forEach`. Move
the dial and run it. Then make task 6 fail and watch what happens to the tasks
around it.

```demo many-at-once
```

## The part people get wrong

The option belongs to one call. It is easy to read `concurrency: 3` as "this
program makes three requests at a time", and it does not say that. A second
`Effect.forEach` somewhere else with its own `concurrency: 3` has its own
limit. Run both together and six requests are in flight.

A limit that several calls share needs something they can all hold. That is a
[Semaphore](/learn/concurrency/06-semaphore), later in this track.

## Next

Something ran those nine fetches side by side and stopped three of them when
one failed. [Fibers](/learn/concurrency/02-fibers) is about what that
something is, and how to start and stop one yourself.
