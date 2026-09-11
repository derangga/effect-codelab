---
title: Effect.gen
order: 4
slug: 04-effect-gen
summary: Writing effects as ordinary sequential code, and knowing when pipe is still better.
---

Chapter three built programs by chaining `flatMap`. That works, but it falls
apart as soon as a later step needs a value from an earlier one.

```ts twoslash
import { Effect } from 'effect'

declare const getUser: (id: number) => Effect.Effect<{ orgId: number }>
declare const getOrg: (id: number) => Effect.Effect<{ name: string }>
declare const getPlan: (orgId: number) => Effect.Effect<{ tier: string }>
// ---cut---
const summary = getUser(1).pipe(
  Effect.flatMap((user) =>
    getOrg(user.orgId).pipe(
      Effect.flatMap((org) =>
        getPlan(user.orgId).pipe(
          Effect.map((plan) => `${org.name} is on ${plan.tier}`),
        ),
      ),
    ),
  ),
)
```

Every step that needs an earlier value has to stay inside that value's
callback, so the nesting grows with each one. If you have written Node
callbacks, you have seen this shape before.

## The same thing with gen

```ts twoslash
import { Effect } from 'effect'

declare const getUser: (id: number) => Effect.Effect<{ orgId: number }>
declare const getOrg: (id: number) => Effect.Effect<{ name: string }>
declare const getPlan: (orgId: number) => Effect.Effect<{ tier: string }>
// ---cut---
const summary = Effect.gen(function* () {
  const user = yield* getUser(1)
  const org = yield* getOrg(user.orgId)
  const plan = yield* getPlan(user.orgId)

  return `${org.name} is on ${plan.tier}`
})
```

Same program, no nesting. `Effect.gen` takes a generator function, and inside
it `yield*` means "run this Effect and give me its result".

If you know `async` and `await`, the shape is familiar: `yield*` sits where
`await` would. The difference is that nothing is running. This is still a
description, built the same way as before, and it still does nothing until you
pass it to a run function.

Everything you already know still applies. Failures still collect in `E`.

```ts twoslash
import { Effect } from 'effect'

declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
declare const parse: (raw: string) => Effect.Effect<number, 'BadFormat'>
// ---cut---
const load: Effect.Effect<number, 'NotFound' | 'BadFormat'> = Effect.gen(
  function* () {
    const raw = yield* readFile('port.txt')
    const port = yield* parse(raw)

    return port + 1
  },
)
```

Both failure types are there, exactly as they were with `flatMap`. That
annotation is checked when this page is built, so if `gen` collected failures
differently the chapter would not compile. `gen` changes how the code looks,
not what it means.

## Ordinary control flow works

This is the real payoff. Inside `gen` you use the language you already know.

```ts twoslash
import { Effect } from 'effect'

declare const fetchPage: (n: number) => Effect.Effect<Array<string>>
// ---cut---
const firstThreePages = Effect.gen(function* () {
  const all: Array<string> = []

  for (let page = 1; page <= 3; page++) {
    const rows = yield* fetchPage(page)
    if (rows.length === 0) break
    all.push(...rows)
  }

  return all
})
```

Loops, `if`, `break`, `try` and `finally` all behave normally. Doing that with
combinators alone means reaching for a special function for each one.

## When pipe is still better

`gen` is the default, but it is not always the right tool. Reach for `pipe`
when there is no intermediate value to name.

A single transformation reads better piped.

```ts twoslash
import { Effect } from 'effect'
declare const getUser: (id: number) => Effect.Effect<{ name: string }>
// ---cut---
const name = getUser(1).pipe(Effect.map((user) => user.name))
```

Wrapping that in `gen` would take three lines to say the same thing.

Attaching behaviour to a program you already have is also piped, because these
functions wrap the whole Effect rather than producing a value you would name.

```ts twoslash
import { Effect, Schedule } from 'effect'
declare const fetchUsers: Effect.Effect<Array<string>, 'RequestFailed'>
// ---cut---
const resilient = fetchUsers.pipe(
  Effect.timeout('5 seconds'),
  Effect.retry(Schedule.exponential('100 millis')),
)
```

The two mix freely, and mixing them is normal. Use `gen` for the steps, then
pipe the result to add behaviour.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
declare const parse: (raw: string) => Effect.Effect<number, 'BadFormat'>
// ---cut---
const load = Effect.gen(function* () {
  const raw = yield* readFile('port.txt')
  return yield* parse(raw)
}).pipe(Effect.timeout('2 seconds'))
```

A short rule: `gen` for the steps, `pipe` for what happens to the whole thing.

## Effect.fn, for functions that return effects

When the thing you are writing is a function rather than a value, `Effect.fn`
is the version of `gen` to use.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
declare const parse: (raw: string) => Effect.Effect<number, 'BadFormat'>
// ---cut---
const loadPort = Effect.fn('loadPort')(function* (path: string) {
  const raw = yield* readFile(path)
  return yield* parse(raw)
})
```

It works like `Effect.gen`, but it takes arguments and you give it a name. The
name is not decoration: it improves stack traces and adds a tracing span, so
when this shows up in a trace later it is labelled `loadPort` rather than
being anonymous.

Use `Effect.fn` when you are writing a function, and `Effect.gen` when you are
building a single program. That is the whole distinction. It is a small thing,
not a fork in the road.

One catch worth knowing: do not use `.pipe` on the result of `Effect.fn`. Pass
the extra behaviour as further arguments instead.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
// ---cut---
const loadPort = Effect.fn('loadPort')(
  function* (path: string) {
    return yield* readFile(path)
  },
  Effect.timeout('2 seconds'),
)
```

## Next

Chapter five is about the `E` channel: how to define failures worth having,
how to handle them, and the difference between a failure you expected and a
bug.
