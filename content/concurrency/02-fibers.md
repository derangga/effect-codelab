---
title: Fibers
order: 2
slug: 02-fibers
summary: Start work in the background with Effect.forkChild, wait for it with Fiber.join, stop it with Fiber.interrupt.
---

`Effect.all` wants every effect up front and hands you every result at the end.
Some work does not fit that. You want to start a fetch, carry on with something
else, and collect the product later. Or you want to stop the fetch, because the
visitor left the page and nobody needs the answer.

Both need a way to hold on to work that is already running.

## What ran the nine fetches

A fiber is one running task that Effect manages itself. It is not an operating
system thread. It is a small object, and a program can have thousands of them.

Every effect that runs, runs on a fiber. `Effect.runPromise(program)` starts
one for `program`. `Effect.all` with `concurrency: 3` kept three more going.
You did not see them, because `Effect.all` started and stopped them for you.

## Fork

`Effect.forkChild` starts an effect on a new fiber and returns straight away.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
// ---cut---
const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(fetchProduct(1))
  //    ^?
  console.log('forked, and the fetch is still running')
})
```

`fetchProduct` is the 300 millisecond stand-in from
[Many at once](/learn/concurrency/01-many-at-once). The `yield*` did not wait
for it. What came back is a `Fiber`, a handle to the running fetch. Its two
type parameters say what the work will succeed with and what it can fail with.

## Join

`Fiber.join` waits for a fiber and gives you its result.

```ts twoslash
import { Duration, Effect, Fiber } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
// ---cut---
const both = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(fetchProduct(1))
  const second = yield* fetchProduct(2)
  const first = yield* Fiber.join(fiber)
  return [first.title, second.title]
})

const program = Effect.gen(function* () {
  const [duration, titles] = yield* Effect.timed(both)
  console.log(titles, Math.round(Duration.toMillis(duration)))
})

Effect.runPromise(program) // [ 'Product 1', 'Product 2' ], then about 300
```

Product 1 was in flight while product 2 was fetched, so both took 300
milliseconds together. If the forked fetch had failed, `Fiber.join` would fail
with the same error, at the line where you join.

## Interrupt

`Fiber.interrupt` stops a fiber.

```ts twoslash
import { Effect, Fiber } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
// ---cut---
const watched = fetchProduct(1).pipe(
  Effect.onInterrupt(() => Effect.sync(() => console.log('fetch stopped'))),
)

const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(watched)
  yield* Effect.sleep('100 millis')
  yield* Fiber.interrupt(fiber)
  console.log('carrying on')
})

Effect.runPromise(program) // fetch stopped, then carrying on
```

The fetch was 100 milliseconds into its 300 when the interrupt arrived. It
stopped there and never produced a product. `Effect.onInterrupt` attaches
cleanup that runs only when the effect is interrupted, and `Fiber.interrupt`
waits for that cleanup to finish before it returns. That is why the two lines
print in that order.

This is what `Effect.forEach` did in
[Many at once](/learn/concurrency/01-many-at-once) when product 6 failed. It
interrupted the fibers that were still fetching.

## A child stops when its parent ends

The fiber that calls `forkChild` is the parent, and the new fiber is its
child. When the parent finishes, Effect interrupts every child that is still
running.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
// ---cut---
const warmCache = Effect.sleep('5 seconds').pipe(
  Effect.andThen(Effect.sync(() => console.log('cache is warm'))),
  Effect.onInterrupt(() => Effect.sync(() => console.log('warming stopped'))),
)

const program = Effect.gen(function* () {
  yield* Effect.forkChild(warmCache)
  return yield* fetchProduct(1)
})

Effect.runPromise(program).then((product) => console.log(product.title))
// warming stopped
// Product 1
```

The program ends after 300 milliseconds. It does not wait five seconds for the
child, and `cache is warm` never prints.

This is the default on purpose. Work that outlives the thing that started it is
how a program ends up with requests nobody is waiting for. With `forkChild`,
background work cannot leak past its parent.

The parent is a fiber, not the `Effect.gen` block the fork is written in. A
fork inside a helper function lives as long as the fiber that ran the helper.

## The part people get wrong

A fiber is a handle and not an effect, so it cannot be yielded. This does not
compile:

```ts
const fiber = yield* Effect.forkChild(fetchProduct(1))
const product = yield* fiber
```

Write `yield* Fiber.join(fiber)`.

Forking and then joining on the next line gains nothing. It runs the same work
and waits for it, which is what `yield* fetchProduct(1)` does with one line
less. Fork when something happens between the fork and the join, or when you
need the handle to interrupt.

The third mistake is the child rule from the other side. Fork a "save this in
the background" task at the end of a request handler, return the response, and
the save is interrupted, because the handler's fiber has finished.
`Effect.forkDetach` starts a fiber with no parent for that case. It is outside
this track, and you will need it less often than you expect.

## Next

Starting two fibers and stopping the one you no longer need is common enough
that Effect does it for you.
[Race and timeout](/learn/concurrency/03-race-and-timeout) covers both forms.
