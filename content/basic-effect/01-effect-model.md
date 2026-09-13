---
title: The Effect model
order: 1
slug: 01-effect-model
summary: Why an Effect is a description of work rather than work already underway, and how its three type parameters put success, failure, and dependencies where you can read them.
---

Here is an ordinary function that loads a product catalog.

```ts twoslash
declare const readFeed: () => Promise<string>
// ---cut---
async function loadCatalog(): Promise<ReadonlyArray<unknown>> {
  const raw = await readFeed()
  return JSON.parse(raw)
}
```

The type says you get an array of products. It does not say that `JSON.parse`
throws on a malformed feed, or that `readFeed` touches the network, or what a
caller should do about either. And by the time you hold the `Promise`, the work
is already underway. You cannot inspect it, retry it, or decide not to run it.
It went the moment you called.

Effect changes one thing first, and everything else follows from it. Calling a
function gives you a description of work. Running it is a separate step you
take on purpose.

## A value that describes work

The same load, written as an Effect:

```ts twoslash
declare const readFeedSync: () => string
// ---cut---
import { Effect } from 'effect'

class FeedParseError extends Error {
  readonly _tag = 'FeedParseError'
}

const loadCatalog = Effect.try({
  try: () => JSON.parse(readFeedSync()) as ReadonlyArray<unknown>,
  catch: () => new FeedParseError(),
})
```

`loadCatalog` is a value. Defining it read nothing and parsed nothing. You can
pass it around, store it in an array, hand it to a function that will run it
twice. None of that does any work.

Look at what the type carries. It is not `Effect<ReadonlyArray<unknown>>`. It
has three parameters, and the second one is the reason this is worth your time.

## Three channels

Every Effect is `Effect<A, E, R>`, always in that order.

`A` is what you get when it succeeds. `E` is the failure you are expected to
handle. `R` is what has to be supplied before it can run at all.

For `loadCatalog` those are `ReadonlyArray<unknown>`, `FeedParseError`, and
`never`. Read that as: it produces an array, it can fail with a parse error,
and it needs nothing from its environment.

`never` in a channel means that channel is empty. An Effect typed
`Effect<number, never, never>` cannot fail in a way you are meant to handle,
and depends on nothing.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
const catalogSize = Effect.succeed(2)
//    ^?
```

The three channels are not documentation. They are the type, so they move when
the code moves. Add a step that can fail and `E` widens whether or not you
remember to mention it in a comment. Remove the last step that needs a
database and `R` goes back to `never` on its own.

This is the trade the rest of the course builds on. You write more in the type
so you have to remember less.

## Nothing runs until something runs it

The laziness is worth proving rather than asserting.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
let reads = 0

const readCount = Effect.sync(() => {
  reads += 1
  return reads
})
```

After those lines `reads` is `0`. `Effect.sync` took the function and kept it.
It did not call it.

```ts twoslash
import { Effect } from 'effect'
let reads = 0
const readCount = Effect.sync(() => {
  reads += 1
  return reads
})
// ---cut---
const twice = Effect.gen(function* () {
  const first = yield* readCount
  const second = yield* readCount
  return [first, second] as const
})
```

`reads` is still `0`. `twice` is another description, built from the first one.
Running it evaluates the function twice and gives back `[1, 2]`, because each
`yield*` is a fresh execution of the same description rather than a cached
result.

A `Promise` does not work this way. A promise is a running operation with a
handle attached, so awaiting the same promise twice gives you the same value
twice. An Effect is the recipe, not the meal, and you can cook from it as many
times as you like.

## Running happens at the edge

Something does eventually have to run. The runners are how you leave Effect
and get back an ordinary value or promise.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
const program = Effect.succeed(2)

const size = Effect.runSync(program)
const later = Effect.runPromise(program)
```

The important part is where those calls belong, which is the outermost edge of
your application. An HTTP handler, a CLI entry point, a test. One call, at the
boundary.

Everything beneath that returns Effects. A function that runs an Effect
internally and hands back a plain value has thrown away the failure channel,
the dependency channel, and the ability of its caller to retry, time out, or
run it alongside something else. It has turned a description back into an
opaque call, which is what you started with.

That rule holds for every service you write in this course. None of them will
contain `Effect.runSync` or `Effect.runPromise`.

## Transforming a description

Because an Effect is a value, you build bigger ones out of smaller ones.
`Effect.map` changes what a success produces and leaves the other two channels
alone.

```ts twoslash
import { Effect } from 'effect'
declare const readFeedSync: () => string
class FeedParseError extends Error {
  readonly _tag = 'FeedParseError'
}
const loadCatalog = Effect.try({
  try: () => JSON.parse(readFeedSync()) as ReadonlyArray<unknown>,
  catch: () => new FeedParseError(),
})
// ---cut---
const catalogSize = loadCatalog.pipe(Effect.map((items) => items.length))
//    ^?
```

`A` went from an array to a number. `E` is still `FeedParseError`, because
counting an array cannot introduce a new way to fail and cannot remove the old
one. `R` is still `never`.

Reading the channels after each step is the habit this course is trying to
build. When a type changes in a way you did not expect, the code did something
you did not expect.

## What people get wrong

The compiler will not let you pretend a failure away. This is the first error
most people meet:

```ts twoslash
// @errors: 2322
import { Effect } from 'effect'
declare const readFeedSync: () => string
class FeedParseError extends Error {
  readonly _tag = 'FeedParseError'
}
const loadCatalog = Effect.try({
  try: () => JSON.parse(readFeedSync()) as ReadonlyArray<unknown>,
  catch: () => new FeedParseError(),
})
// ---cut---
const safe: Effect.Effect<ReadonlyArray<unknown>, never> = loadCatalog
```

`never` in the failure position is a promise that nothing can go wrong. The
parse can go wrong, so the assignment is rejected. In a `Promise` codebase the
equivalent claim is made silently, every time someone writes a return type and
forgets what the body throws.

The other mistake is eagerness in disguise:

```ts twoslash
import { Effect } from 'effect'
declare const expensiveCount: () => number
// ---cut---
const eager = Effect.succeed(expensiveCount())
const lazy = Effect.sync(() => expensiveCount())
```

`Effect.succeed` takes a value, so `expensiveCount()` runs on that line, before
any Effect exists. `Effect.sync` takes a function, so the work is deferred like
everything else. Use `succeed` for a value you already have, `sync` for work
that should happen each time the Effect runs.

## Next

You can now read an Effect type and say what it produces, how it fails, and
what it needs. [Constructing and composing
Effects](/learn/basic-effect/02-composition) is about building the descriptions:
which constructor fits which kind of work, and how to chain steps where each
one depends on the last.
