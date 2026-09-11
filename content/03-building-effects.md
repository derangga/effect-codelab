---
title: Building Effects
order: 3
slug: 03-building-effects
summary: Turning values, throwing code and Promises into Effects, then combining them.
---

Almost nothing you need is an Effect yet. Your codebase is full of plain
values, functions that throw, and Promises. This chapter is about getting them
in, and then joining them together.

## Getting in

There are five constructors worth learning first. Picking the right one is
mostly two questions: can this throw, and is it asynchronous.

### A value you already have

```ts twoslash
import { Effect } from 'effect'

const config = Effect.succeed({ retries: 3 })
//    ^?
```

`Effect.succeed` takes a value that already exists. It cannot fail, so `E` is
`never`.

### Synchronous code that cannot throw

```ts twoslash
import { Effect } from 'effect'

const now = Effect.sync(() => Date.now())
//    ^?
```

`Effect.sync` wraps a side effect. Reading the clock, generating a random
number, writing to the console. The function runs when the Effect runs, not
when you build it.

The promise you are making with `sync` is that the function will not throw. If
it does throw anyway, Effect treats it as a defect, which is the bug category
covered in chapter five. So use `sync` when you are sure, and `try` when you
are not.

### Synchronous code that can throw

```ts twoslash
import { Effect } from 'effect'

class InvalidJson {
  readonly _tag = 'InvalidJson'
  constructor(readonly cause: unknown) {}
}

const parse = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new InvalidJson(cause),
  })

const parsed = parse('{}')
//    ^?
```

`Effect.try` takes two functions. The first does the work. The second turns
whatever was thrown into your own error value.

That second function is the important half. `JSON.parse` throws `any`, which
tells you nothing. The `catch` function is where an unknown thrown thing
becomes a named failure that shows up in `E`. Look at the signature above: the
failure is `InvalidJson`, not `unknown`.

The little class with a `_tag` field is a placeholder. Chapter five replaces
it with the proper way to define errors. All that matters here is that the
error is a value you chose.

### A Promise that cannot reject

```ts twoslash
import { Effect } from 'effect'

const wait = Effect.promise(() => new Promise<void>((r) => setTimeout(r, 100)))
//    ^?
```

Same promise as `sync`, in the asynchronous case. Use it only when rejection
is genuinely impossible.

### A Promise that can reject

```ts twoslash
import { Effect } from 'effect'

class RequestFailed {
  readonly _tag = 'RequestFailed'
  constructor(readonly cause: unknown) {}
}

const fetchUsers = () =>
  Effect.tryPromise({
    try: () => fetch('https://example.com/users'),
    catch: (cause) => new RequestFailed(cause),
  })

const request = fetchUsers()
//    ^?
```

This is the one you will use most. Every `fetch`, every database call, every
third party client that hands back a Promise comes in through `tryPromise`.

Note that the function is not called when you build this. `fetchUsers` is a
description. Build it ten times and no request is made.

### Choosing between them

| Situation | Constructor |
| --- | --- |
| A value in hand | `Effect.succeed` |
| Sync, cannot throw | `Effect.sync` |
| Sync, can throw | `Effect.try` |
| Async, cannot reject | `Effect.promise` |
| Async, can reject | `Effect.tryPromise` |

When unsure, pick the `try` version. Being wrong with `try` costs you an error
in the type. Being wrong with `sync` or `promise` turns a normal failure into
a defect that nobody is expecting.

## Joining them together

Two combinators do most of the work.

`Effect.map` changes the success value, the same way `Array.prototype.map`
changes elements.

```ts twoslash
import { Effect } from 'effect'

const doubled = Effect.map(Effect.succeed(21), (n) => n * 2)
//    ^?
```

`Effect.flatMap` is for when the next step is itself an Effect.

```ts twoslash
import { Effect } from 'effect'

declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
declare const parse: (raw: string) => Effect.Effect<number, 'BadFormat'>

const loaded = Effect.flatMap(readFile('port.txt'), parse)
//    ^?
```

Both failures are in the type, and neither was written by hand.

The rule for choosing: if your function returns a plain value, use `map`. If
it returns an Effect, use `flatMap`. Using `map` where you needed `flatMap`
gives you an Effect inside an Effect, and the type will tell you so
immediately.

## Why pipe exists

Written the way above, each step wraps the previous one, so the code reads
inside out.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
declare const parse: (raw: string) => Effect.Effect<number, 'BadFormat'>
// ---cut---
const nested = Effect.map(
  Effect.flatMap(readFile('port.txt'), parse),
  (port) => port + 1,
)
```

The first thing that happens is buried in the middle. `pipe` turns that
around, so steps read top to bottom in the order they run.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string, 'NotFound'>
declare const parse: (raw: string) => Effect.Effect<number, 'BadFormat'>
// ---cut---
const piped: Effect.Effect<number, 'NotFound' | 'BadFormat'> = readFile(
  'port.txt',
).pipe(
  Effect.flatMap(parse),
  Effect.map((port) => port + 1),
)
```

That type annotation is not decoration. This page compiles every snippet, so
if the real type were anything else, the chapter would fail to build.

Read it as: start with the file, then parse it, then add one. Same program,
same type, but you can now read it in the order it happens.

This is why most Effect functions come in two forms. `Effect.map(effect, f)`
takes the Effect first, for when you have it. `Effect.map(f)` inside a `.pipe`
takes only the function and waits for the Effect to arrive. You almost always
want the second form.

## Next

Chapter four introduces `Effect.gen`, which lets you write these same programs
as ordinary looking sequential code, and covers when `pipe` is still the
better choice.
