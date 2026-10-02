---
title: Lock
order: 5
slug: 05-lock
summary: Make fibers take turns. A semaphore with one permit is a lock, and it stops the counter from losing updates.
---

The [Ref](/learn/concurrency/04-ref) chapter ended with a counter that nine
fibers each added one to, and that finished at 1. Every fiber read the counter,
did some slow work, and wrote back what it read plus one. `Ref.update` could
not help, because the slow work is an effect and does not fit inside it.

The fibers have to take turns. One does all three steps, then the next one
starts.

## The program to fix

Here it is again. The sleep stands for the slow work.

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

All nine fibers read 0 before any of them wrote, so all nine wrote 1.

## Make the lock

A lock is something only one fiber can hold at a time. Other languages call it
a mutex. In Effect you build one from a `Semaphore`.

A semaphore is a box of permits. `Semaphore.make(1)` makes a box with one
permit in it.

```ts twoslash
import { Effect, Semaphore } from 'effect'

const program = Effect.gen(function* () {
  const lock = yield* Semaphore.make(1)
  //    ^?
})
```

`Semaphore.make` is an effect, so you get the semaphore with `yield*`. Nothing
is locked yet. You have a box, and no work uses it.

## Hold the permit while the work runs

`lock.withPermits(1)` connects a piece of work to the box. It is easier to read
as two steps.

```ts twoslash
import { Effect, Semaphore } from 'effect'
declare const bump: Effect.Effect<void>
// ---cut---
const program = Effect.gen(function* () {
  const lock = yield* Semaphore.make(1)

  const holdOne = lock.withPermits(1)
  const lockedBump = holdOne(bump)
  //    ^?
})
```

`lock.withPermits(1)` returns a wrapper. Give the wrapper an effect and you get
a new effect that does three things in order. It waits until a permit is in the
box and takes it. It runs the original effect. It puts the permit back, and it
does that even when the work fails or is interrupted.

The box holds one permit, so while one fiber runs `lockedBump`, every other
fiber that tries is waiting at the first step.

Most code writes the two steps on one line, `lock.withPermits(1)(bump)`. The
two pairs of brackets are those two steps.

The two functions are easy to mix up, so here they are side by side.

|                 | `Semaphore.make(1)`                 | `lock.withPermits(1)`                      |
| --------------- | ----------------------------------- | ------------------------------------------ |
| What it does    | Makes the box of permits            | Wraps one piece of work so it holds a permit |
| How often       | Once                                | At every piece of work that needs the lock |
| What the 1 means | How many permits are in the box    | How many permits this work takes           |

## The fixed program

```ts twoslash
import { Effect, Ref, Semaphore } from 'effect'

const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0)
  const lock = yield* Semaphore.make(1)

  const bump = Effect.gen(function* () {
    const n = yield* Ref.get(counter)
    yield* Effect.sleep('10 millis')
    yield* Ref.set(counter, n + 1)
  })
  const lockedBump = lock.withPermits(1)(bump)

  yield* Effect.all(Array.from({ length: 9 }, () => lockedBump), {
    concurrency: 'unbounded',
  })
  return yield* Ref.get(counter)
})

Effect.runPromise(program).then(console.log) // 9
```

`bump` did not change. All nine fibers still start at once. Eight of them wait
for the permit, and each one reads the number the fiber before it wrote.

## Try it

Each token shows the number its fiber read, and then the number it wrote. Run
it without the lock and look at what all nine read. Then turn the lock on and
run it again.

```demo lock
```

The lock costs time. The nine sleeps no longer overlap, so the run takes nine
times as long. Put only the steps that must not overlap inside the lock.

## The part people get wrong

Wrapping the wrong thing. This takes the lock once, around all nine:

```ts twoslash
import { Effect, Ref, Semaphore } from 'effect'

const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0)
  const lock = yield* Semaphore.make(1)

  const bump = Effect.gen(function* () {
    const n = yield* Ref.get(counter)
    yield* Effect.sleep('10 millis')
    yield* Ref.set(counter, n + 1)
  })

  yield* lock.withPermits(1)(
    Effect.all(Array.from({ length: 9 }, () => bump), {
      concurrency: 'unbounded',
    }),
  )
  return yield* Ref.get(counter)
})

Effect.runPromise(program).then(console.log) // 1
```

One piece of work took the permit, and that piece of work was "run all nine at
once". Inside it nothing takes turns. The lock goes around the smallest thing
that must run alone, which here is one `bump`.

## Next

One permit lets one fiber in. A database pool with three connections can take
three. [Semaphore](/learn/concurrency/06-semaphore) puts more permits in the
same box.
