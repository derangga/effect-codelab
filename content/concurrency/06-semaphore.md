---
title: Semaphore
order: 6
slug: 06-semaphore
summary: Share one limit across every place that touches a resource. A Semaphore with three permits keeps a three-connection pool from ever seeing six.
---

The product fetcher now writes to a database, and the database pool has three
connections. Two different parts of the program write to it. One saves prices
and one saves stock levels. Each uses `Effect.forEach` with `concurrency: 3`
to stay polite.

That is not enough. The `concurrency` option limits one call. Run the two calls
together and each opens three connections, so the pool sees six.

The [Lock](/learn/concurrency/05-lock) chapter made a semaphore with one
permit. Put three permits in the box and it becomes a limit of three, and every
part of the program that holds the box shares it.

## Three permits

Only the number in `Semaphore.make` changes. Each write still takes one
permit.

```ts twoslash
import { Effect, Semaphore } from 'effect'

declare const savePrice: (id: number) => Effect.Effect<void>

const program = Effect.gen(function* () {
  const pool = yield* Semaphore.make(3)
  const limited = (id: number) => pool.withPermits(1)(savePrice(id))

  yield* Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8, 9], limited, {
    concurrency: 'unbounded',
  })
})
```

The `concurrency` option says "start all nine", and the semaphore says "three
at a time". Nine fibers exist at once. Three hold a permit and are writing, and
six are waiting for one.

## Share it between call sites

Create the semaphore once and use the same one in both places.

```ts twoslash
import { Effect, Semaphore } from 'effect'

declare const savePrice: (id: number) => Effect.Effect<void>
declare const saveStock: (id: number) => Effect.Effect<void>

const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const program = Effect.gen(function* () {
  const pool = yield* Semaphore.make(3)

  const prices = Effect.forEach(
    ids,
    (id) => pool.withPermits(1)(savePrice(id)),
    { concurrency: 'unbounded' },
  )
  const stock = Effect.forEach(
    ids,
    (id) => pool.withPermits(1)(saveStock(id)),
    { concurrency: 'unbounded' },
  )

  yield* Effect.all([prices, stock], { concurrency: 'unbounded' })
})
```

Eighteen writes are in flight and three of them hold a permit. The pool never
sees a fourth connection.

## Some work is heavier

The number in `withPermits` can change too. A report query that scans a whole
table might count as two ordinary queries.

```ts twoslash
import { Effect, Semaphore } from 'effect'

declare const report: Effect.Effect<void>

const program = Effect.gen(function* () {
  const pool = yield* Semaphore.make(3)
  yield* pool.withPermits(2)(report)
})
```

While the report runs, one permit is left for everything else.

> [!NOTE]
> The number in `withPermits` must not be bigger than the number in
> `Semaphore.make`. With `Semaphore.make(2)`, a task wrapped in
> `withPermits(4)` waits for four free permits, and the box never holds more
> than two, so it waits forever. Nothing fails and the compiler does not catch
> it. The same number is fine. `withPermits(2)` takes both permits and runs
> alone.

## Try it

Nine tasks sleep for 600 milliseconds each, all wrapped in the same semaphore.
Move the permits and run it. Turn on the heavy task and watch it take two.

```demo semaphore
```

Set the permits to 1 and it behaves like the lock, with one task running at a
time.

## The part people get wrong

Creating the semaphore inside the function that uses it:

```ts twoslash
import { Effect, Semaphore } from 'effect'

declare const write: (id: number) => Effect.Effect<void>

const savePrice = (id: number) =>
  Effect.gen(function* () {
    const pool = yield* Semaphore.make(3)
    yield* pool.withPermits(1)(write(id))
  })
```

Every call to `savePrice` makes its own box with three fresh permits, so
nothing is shared and nothing is limited. It looks right and it does nothing.
`Semaphore.make` runs once, where the resource lives. `withPermits` runs at
every use.

## Next

The semaphore decides how many writes run at once. It does not decide what
happens to the ones that arrive faster than the database can take them. The
[Queue](/learn/concurrency/07-queue) chapter handles that.
