---
title: Queue
order: 7
slug: 07-queue
summary: Hand work from a producer to a consumer with Queue.bounded, and watch the producer wait when the queue is full.
---

The [Semaphore](/learn/concurrency/06-semaphore) keeps three writes in flight.
It does nothing about the fetching. Products still arrive as fast as the API
can send them, and each one that cannot be written yet waits in memory. With
nine products nobody notices. With nine million, the program runs out of memory
before the database catches up.

What you want is for a slow database to slow the fetching down.

## A queue with a limit

A queue sits between the side that makes items, the producer, and the side
that uses them, the consumer. `Queue.bounded` makes one that holds a fixed
number of items.

```ts twoslash
import { Cause, Effect, Queue } from 'effect'
interface Product { id: number; title: string }
// ---cut---
const program = Effect.gen(function* () {
  const queue = yield* Queue.bounded<Product, Cause.Done>(3)
  //    ^?
})
```

The first type parameter is what the queue carries, and 3 is how many it
holds. The second, `Cause.Done`, is explained under "Finishing" below.

## The producer

`Queue.offer` puts one item in.

```ts twoslash
import { Cause, Effect, Queue } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
const produce = (queue: Queue.Queue<Product, Cause.Done>) =>
  Effect.forEach(
    ids,
    (id) =>
      fetchProduct(id).pipe(
        Effect.flatMap((product) => Queue.offer(queue, product)),
      ),
    { discard: true },
  )
```

When the queue has room, `offer` returns at once. When the queue is full,
`offer` suspends. The fiber stops at that line and waits, without holding up
any other fiber, until the consumer takes an item out. Then it puts its item in
and carries on to the next fetch.

So a full queue stops the producer from fetching. The slow side holds the fast
side back, and that is called backpressure.

`discard: true` tells `forEach` not to collect the results, since the products
went into the queue.

## The consumer

`Queue.take` removes the oldest item. When the queue is empty it suspends
until there is one.

```ts twoslash
import { Cause, Effect, Queue } from 'effect'
interface Product { id: number; title: string }
// ---cut---
const saveProduct = (product: Product) =>
  Effect.sleep('600 millis').pipe(
    Effect.andThen(Effect.sync(() => console.log('saved', product.title))),
  )

const consume = (queue: Queue.Queue<Product, Cause.Done>) =>
  Effect.forever(
    Effect.gen(function* () {
      const product = yield* Queue.take(queue)
      yield* saveProduct(product)
    }),
  )
```

`Effect.forever` runs an effect again each time it finishes. The stand-in
write takes 600 milliseconds, twice as long as a fetch, so this consumer is
the slow side.

## Finishing

`forever` has no end, and the consumer cannot tell an empty queue from a
finished one. The producer has to say that nothing more is coming.

`Queue.end` does that. The items already in the queue are still delivered.
After the last one, `Queue.take` fails with a `Cause.Done` value. That is the
reason for the second type parameter. A queue's error type lists what `take`
can fail with, and `Queue.end` only accepts a queue that lists `Cause.Done`.

The consumer catches that one failure and stops.

```ts twoslash
import { Cause, Effect, Fiber, Queue } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const saveProduct = (product: Product) =>
  Effect.sleep('600 millis').pipe(
    Effect.andThen(Effect.sync(() => console.log('saved', product.title))),
  )
const produce = (queue: Queue.Queue<Product, Cause.Done>) =>
  Effect.forEach(
    ids,
    (id) =>
      fetchProduct(id).pipe(
        Effect.flatMap((product) => Queue.offer(queue, product)),
      ),
    { discard: true },
  )
const consume = (queue: Queue.Queue<Product, Cause.Done>) =>
  Effect.forever(
    Effect.gen(function* () {
      const product = yield* Queue.take(queue)
      yield* saveProduct(product)
    }),
  )
// ---cut---
const program = Effect.gen(function* () {
  const queue = yield* Queue.bounded<Product, Cause.Done>(3)

  const producer = yield* Effect.forkChild(
    produce(queue).pipe(Effect.andThen(Queue.end(queue))),
  )
  const consumer = yield* Effect.forkChild(
    consume(queue).pipe(Effect.catchIf(Cause.isDone, () => Effect.void)),
  )

  yield* Fiber.join(producer)
  yield* Fiber.join(consumer)
  console.log('all nine saved')
})

Effect.runPromise(program)
```

The producer and the consumer each run on their own fiber, started with
`forkChild` from [Fibers](/learn/concurrency/02-fibers). The program joins
both, so it ends when the last product is saved. Run it and the nine `saved`
lines arrive 600 milliseconds apart. The fetches could have finished in 2.7
seconds, and the queue made them wait for the writes.

## Try it

One producer, one queue, one consumer. Start with the consumer slower than the
producer and watch the queue fill and the producer stop. Then make the consumer
the faster one and the queue stays empty.

```demo queue
```

## The part people get wrong

Leaving `Cause.Done` out of the type. `Queue.bounded<Product>(3)` is a queue
that can never end, and `Queue.end` on it is a type error. Decide when you
make the queue whether it finishes.

Stopping with `Queue.shutdown` instead. It looks like the same thing and it
is not. `shutdown` throws away the items still in the queue and interrupts
every fiber waiting on it. Products that were fetched and not yet saved are
lost, and a consumer stopped that way is interrupted, which interrupts the
fiber that joins it too. Use `Queue.end` to finish and keep `shutdown` for
giving up.

Reaching for `Queue.unbounded` because it never makes the producer wait. That
is the problem this chapter started with. A queue with no limit has no
backpressure, and it grows until memory runs out.

## Next

That is the track. Nine fetches run with a limit, a cache races the API, a
`Ref` counts, a lock keeps the count right, a `Semaphore` guards the pool, and
a queue lets the database set the pace. The [HTTP Auth API](/learn/http-auth-api) track builds a real
backend, and these tools are there when it needs them.
