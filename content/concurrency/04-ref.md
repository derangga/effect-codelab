---
title: Ref
order: 4
slug: 04-ref
summary: Share mutable state between fibers with Ref, and see the lost update when a fiber reads, sleeps, then writes.
---

Nine lookups race the cache against the API. You want to know how many the
cache won. That is one number, and nine fibers write to it.

## Why not a let

The first thing to reach for is a variable outside the effect.

```ts
let hits = 0

const lookup = (id: number) =>
  Effect.race(
    fromCache(id).pipe(Effect.tap(() => Effect.sync(() => hits++))),
    fetchProduct(id),
  )
```

It counts. It also lives outside the program. An effect is a description you
can run more than once, and the second run starts with the first run's count.
Two tests that both run `lookup` share the number. Nothing in the type of
`lookup` says it touches anything.

## A Ref

A `Ref` is a mutable value that lives inside the program.

```ts twoslash
import { Effect, Ref } from 'effect'

const program = Effect.gen(function* () {
  const hits = yield* Ref.make(0)
  //    ^?
  yield* Ref.set(hits, 5)
  return yield* Ref.get(hits)
})

Effect.runPromise(program).then(console.log) // 5
```

`Ref.make` is an effect, so every run of `program` makes a new `Ref` that
starts at 0. Reading and writing are effects too. Like a fiber, a `Ref` is a
handle, so you read it with `Ref.get(hits)` and cannot yield it directly.

## Nine fibers, one counter

`Ref.update` takes a function from the old value to the new one.

```ts twoslash
import { Effect, Ref } from 'effect'
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
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9]
// ---cut---
const program = Effect.gen(function* () {
  const hits = yield* Ref.make(0)

  const lookup = (id: number) =>
    Effect.race(
      fromCache(id).pipe(Effect.tap(() => Ref.update(hits, (n) => n + 1))),
      fetchProduct(id),
    )

  yield* Effect.forEach(ids, lookup, { concurrency: 'unbounded' })
  return yield* Ref.get(hits)
})

Effect.runPromise(program).then(console.log) // 3
```

`fromCache` and `fetchProduct` are the stand-ins from
[Race and timeout](/learn/concurrency/03-race-and-timeout), where the cache
holds products 1 to 3. `Effect.tap` runs an extra effect when the cache
succeeds and leaves its result alone. Three lookups hit the cache, and the
counter says 3.

`Ref.update` reads the value and writes the new one as a single step. No other
fiber can run between the read and the write.

## The lost update

Now take the single step apart. Suppose each fiber reads the counter, does
some slow work, and then writes the counter back plus one.

```ts twoslash
import { Effect, Ref } from 'effect'

const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0)

  const bump = Effect.gen(function* () {
    const n = yield* Ref.get(counter)
    yield* Effect.sleep('10 millis')
    yield* Ref.set(counter, n + 1)
  })

  yield* Effect.all(Array.from({ length: 9 }, () => bump), {
    concurrency: 'unbounded',
  })
  return yield* Ref.get(counter)
})

Effect.runPromise(program).then(console.log) // 1
```

Nine fibers each added one, and the counter says 1. All nine read 0 before any
of them wrote, so all nine wrote 1. Eight updates are gone. Nothing failed and
nothing warned you.

A `Ref` does not prevent this. Each `Ref.get` and each `Ref.set` is safe by
itself. The pair is two steps, and the sleep between them gives every other
fiber time to run.

## Update and return something

Sometimes the update also has to hand a value back. Say each lookup gets a
ticket number, the next one in line. `Ref.modify` takes a function that returns
a pair. The first item is what `modify` returns to you and the second is the
new value to store.

```ts twoslash
import { Effect, Ref } from 'effect'

const program = Effect.gen(function* () {
  const next = yield* Ref.make(1)
  const ticket = Ref.modify(next, (n) => [`ticket-${n}`, n + 1] as const)
  //    ^?

  return yield* Effect.all([ticket, ticket, ticket], {
    concurrency: 'unbounded',
  })
})

Effect.runPromise(program).then(console.log)
// [ 'ticket-1', 'ticket-2', 'ticket-3' ]
```

Like `update`, it is one step. No two fibers get the same ticket.

## The part people get wrong

Writing `Ref.get`, then some logic, then `Ref.set`, because that is how the
same code reads with a plain variable. It works in every test that runs one
fiber and loses updates as soon as there are two.

When the new value depends on the old one, compute it inside `Ref.update` or
`Ref.modify`. The function you pass has to be a plain function that returns
the value at once.

That leaves the case where it cannot be. If the step between the read and the
write is itself an effect, a request or a sleep, it does not fit inside
`update`. Then the fibers have to take turns, and a `Ref` cannot make them.

## Next

Making fibers take turns is the job of a lock.
[Lock](/learn/concurrency/05-lock) builds one and fixes this counter.
