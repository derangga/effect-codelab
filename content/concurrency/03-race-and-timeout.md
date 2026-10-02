---
title: Race and timeout
order: 3
slug: 03-race-and-timeout
summary: Race a cache against the API with Effect.race, and give up on a slow call with Effect.timeout.
---

Some products are in a cache, and the cache answers in 50 milliseconds. The API
takes 300. Ask the cache first and then the API, and a product that is not
cached costs 350. Ask both at once and take the first answer, and no product
costs more than 300.

## A cache that misses

The stand-in cache holds products 1 to 3. For anything else it fails with a
`CacheMiss`, after the same 50 milliseconds.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
// ---cut---
class CacheMiss extends Error {
  readonly _tag = 'CacheMiss'
}

const fromCache = (id: number) =>
  Effect.sleep('50 millis').pipe(
    Effect.andThen(
      id <= 3
        ? Effect.succeed<Product>({ id, title: `Cached ${id}` })
        : Effect.fail(new CacheMiss()),
    ),
  )
```

## Race

`Effect.race` takes two effects, starts each on its own fiber, and returns the
result of the first one to succeed. It interrupts the other.

```ts twoslash
import { Duration, Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
class CacheMiss extends Error {
  readonly _tag = 'CacheMiss'
}
const fromCache = (id: number) =>
  Effect.sleep('50 millis').pipe(
    Effect.andThen(
      id <= 3
        ? Effect.succeed<Product>({ id, title: `Cached ${id}` })
        : Effect.fail(new CacheMiss()),
    ),
  )
// ---cut---
const getProduct = (id: number) =>
  Effect.race(fromCache(id), fetchProduct(id))

const program = Effect.gen(function* () {
  const [duration, product] = yield* Effect.timed(getProduct(1))
  console.log(product.title, Math.round(Duration.toMillis(duration)))
})

Effect.runPromise(program) // Cached 1, then about 50
```

The cache won. The API fetch was 50 milliseconds into its 300 when Effect
interrupted it, the same interrupt as `Fiber.interrupt` in
[Fibers](/learn/concurrency/02-fibers). You did not fork or join anything.

## A fast failure does not win

Ask for product 7, which the cache does not have.

```ts twoslash
import { Duration, Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
class CacheMiss extends Error {
  readonly _tag = 'CacheMiss'
}
const fromCache = (id: number) =>
  Effect.sleep('50 millis').pipe(
    Effect.andThen(
      id <= 3
        ? Effect.succeed<Product>({ id, title: `Cached ${id}` })
        : Effect.fail(new CacheMiss()),
    ),
  )
const getProduct = (id: number) =>
  Effect.race(fromCache(id), fetchProduct(id))
// ---cut---
const program = Effect.gen(function* () {
  const [duration, product] = yield* Effect.timed(getProduct(7))
  console.log(product.title, Math.round(Duration.toMillis(duration)))
})

Effect.runPromise(program) // Product 7, then about 300
```

The cache finished first, with a failure, and `race` kept waiting. It returns
the first success. A side that fails drops out and the other side carries on.
The race fails only when both sides fail.

That is why the error type still holds `CacheMiss`.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
class CacheMiss extends Error {
  readonly _tag = 'CacheMiss'
}
const fromCache = (id: number) =>
  Effect.sleep('50 millis').pipe(
    Effect.andThen(
      id <= 3
        ? Effect.succeed<Product>({ id, title: `Cached ${id}` })
        : Effect.fail(new CacheMiss()),
    ),
  )
// ---cut---
const product = Effect.race(fromCache(7), fetchProduct(7))
//    ^?
```

The error type of a race is every error from both sides. The stand-in
`fetchProduct` cannot fail, so here the race cannot either, but the type does
not know which side will lose.

## Timeout

A race against the clock has its own function. `Effect.timeout` gives an effect
a time limit.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
// ---cut---
const limited = fetchProduct(1).pipe(Effect.timeout('100 millis'))
//    ^?
```

If the fetch is not done in 100 milliseconds, Effect interrupts it and
`limited` fails with a `TimeoutError`. The new failure is in the type, so the
code that calls `limited` has to deal with it or pass it on. You can catch it
by its tag, like any error from the Basic Effect track.

When you would rather have a stand-in value than an error, use
`Effect.timeoutOrElse`.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
// ---cut---
const placeholder: Product = { id: 0, title: 'Loading' }

const withFallback = fetchProduct(1).pipe(
  Effect.timeoutOrElse({
    duration: '100 millis',
    orElse: () => Effect.succeed(placeholder),
  }),
)

Effect.runPromise(withFallback).then((product) => console.log(product.title))
// Loading
```

`orElse` returns an effect, so the fallback can be another fetch as easily as
a constant.

## Both together

Race the cache against the API, and give the pair one second in total.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
const fetchProduct = (id: number) =>
  Effect.sleep('300 millis').pipe(
    Effect.map((): Product => ({ id, title: `Product ${id}` })),
  )
class CacheMiss extends Error {
  readonly _tag = 'CacheMiss'
}
const fromCache = (id: number) =>
  Effect.sleep('50 millis').pipe(
    Effect.andThen(
      id <= 3
        ? Effect.succeed<Product>({ id, title: `Cached ${id}` })
        : Effect.fail(new CacheMiss()),
    ),
  )
// ---cut---
const getProduct = (id: number) =>
  Effect.race(fromCache(id), fetchProduct(id)).pipe(
    Effect.timeout('1 second'),
  )
```

The timeout wraps the race, so when it fires it interrupts the race, and the
race interrupts both of its sides. Nothing is left running.

## The part people get wrong

Expecting `race` to return whatever finishes first. It returns the first
success, and a failure only drops that side out. When you want the first side
to finish, success or failure, that is `Effect.raceFirst`. With `raceFirst`,
product 7 fails with `CacheMiss` after 50 milliseconds and the API fetch is
interrupted, which is the wrong behaviour for a cache and the right one for
"stop as soon as anything goes wrong".

The loser is interrupted partway through. That is harmless for a read. Do not
race two effects that write, because the losing write may have happened, or
half happened, by the time it is stopped.

## Next

Nine lookups now go to the cache and the API at once. How many did the cache
win? Counting that means nine fibers writing to one number, which is the
subject of [Ref](/learn/concurrency/04-ref).
