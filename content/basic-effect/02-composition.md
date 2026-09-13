---
title: Constructing and composing Effects
order: 2
slug: 02-composition
summary: Which constructor fits which kind of work, what Effect.gen actually does with each yield, and why service methods are written with Effect.fn instead.
---

One Effect on its own is not interesting. Real work is several steps where each
one needs the result of the last, and any of them might fail.

Written with plain callbacks that shape nests immediately. Effect gives you two
ways to write it flat, and a third thing that looks like the second but is not.
This chapter is about telling them apart.

## Choosing a constructor

Before composing anything you need Effects to compose. Four constructors cover
almost everything.

| The work you have | The constructor |
| --- | --- |
| A value you already hold | `Effect.succeed(value)` |
| Synchronous work that cannot throw | `Effect.sync(thunk)` |
| Synchronous work that can throw | `Effect.try({ try, catch })` |
| A Promise that can reject | `Effect.tryPromise({ try, catch })` |

The split that matters is the bottom half. `sync` promises the body cannot
throw, so `E` stays `never`. `try` admits it can, so you must say what the
failure becomes.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
class FeedParseError extends Error {
  readonly _tag = 'FeedParseError'
}

const parseFeed = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as ReadonlyArray<unknown>,
    catch: () => new FeedParseError(),
  })
```

The `catch` branch is where an untyped `unknown` from a `throw` becomes a value
your code can match on. Skip it, by calling `Effect.try(() => ...)` with one
argument, and Effect uses `UnknownError` instead. That compiles, but the caller
learns nothing about what went wrong.

`Effect.tryPromise` is how existing Promise code gets in. It belongs at the
edges of your system, next to the runners, not in the middle of a service.

## Chaining with map and flatMap

`Effect.map` is for a plain function. `Effect.flatMap` is for a function that
itself returns an Effect.

```ts twoslash
import { Effect } from 'effect'
declare const readFeed: Effect.Effect<string>
declare const parseFeed: (raw: string) => Effect.Effect<ReadonlyArray<unknown>>
// ---cut---
const products = readFeed.pipe(Effect.flatMap(parseFeed))
```

Reach for a third dependent step and you are writing a callback inside a
callback:

```ts twoslash
import { Effect } from 'effect'
declare const readFeed: Effect.Effect<string>
declare const parseFeed: (raw: string) => Effect.Effect<ReadonlyArray<unknown>>
declare const validate: (
  items: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<string>>
// ---cut---
const names = readFeed.pipe(
  Effect.flatMap((raw) =>
    parseFeed(raw).pipe(
      Effect.flatMap((items) =>
        validate(items).pipe(Effect.map((valid) => valid.length)),
      ),
    ),
  ),
)
```

That is the same shape callbacks had before Promises, and then Promises had
before `async`/`await`. Effect's answer to it is `Effect.gen`.

## Effect.gen

`Effect.gen` writes a sequence of Effects as ordinary top-to-bottom code. You
hand it a generator function, and it hands back one Effect describing the whole
sequence.

```ts twoslash
import { Effect } from 'effect'
declare const readFeed: Effect.Effect<string>
declare const parseFeed: (raw: string) => Effect.Effect<ReadonlyArray<unknown>>
declare const validate: (
  items: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<string>>
// ---cut---
const names = Effect.gen(function* () {
  const raw = yield* readFeed
  const items = yield* parseFeed(raw)
  const valid = yield* validate(items)
  return valid.length
})
```

Same work, read top to bottom.

`yield*` is the only new thing in that body. It runs one Effect and hands back
its success value, so `raw` is a `string` rather than an Effect wrapping one.
Read it everywhere in this course as "run this and give me the value".

Two things follow from that, and you get both without writing anything. If a
step fails, the lines after it do not run, and the failure leaves through the
`E` channel of the whole generator. And `names` was never annotated. Its `E`
and `R` are the unions of what the yielded Effects fail with and require, so
adding a `yield*` widens them on the line you wrote.

Compared to the `async` function you already know:

| In async/await | In Effect.gen |
| --- | --- |
| `async function` | `Effect.gen(function* () { ... })` |
| `await promise` | `yield* effect` |
| `throw` and `try`/`catch` | the `E` channel, handled with `catchTag` |
| Runs when called | Runs when something runs the Effect |
| Rejection type is `any` | Failure type is in the signature |

The resemblance is real and it is also the trap. An `async` function starts
working when you call it. `Effect.gen` returns a description that has done
nothing yet, no matter how many `yield*` lines are inside it.

### What you can put after yield*

Only an Effect. This is the rule that catches people moving from Effect v2 and
v3, because several types that used to be yieldable are not.

`Option`, `Result`, `Ref`, `Deferred`, and `Fiber` are plain values. They are
not Effects, so they do not go after `yield*`. Each has a function that turns
it into one, or reads it inside one.

```ts twoslash
import { Effect, Option, Ref } from 'effect'
declare const maybeName: Option.Option<string>
// ---cut---
const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0)
  const current = yield* Ref.get(counter)
  const name = yield* Effect.fromOption(maybeName)
  return `${name} ${current}`
})
```

`Ref.make` returns an Effect, so it is yielded. The `Ref` it produces is not,
so reading it goes through `Ref.get`. `Effect.fromOption` turns absence into a
failure, which is the only way an `Option` becomes part of a program's control
flow.

## Effect.fn, and how it differs from Effect.gen

`Effect.gen` builds one Effect. Most of the time you want something you can
call with different arguments, and that is a different thing.

The obvious move is to wrap the gen in an arrow function:

```ts twoslash
import { Effect } from 'effect'
declare const fetchProduct: (id: string) => Effect.Effect<{ name: string }>
// ---cut---
const describeProduct = (id: string) =>
  Effect.gen(function* () {
    const product = yield* fetchProduct(id)
    return product.name.toUpperCase()
  })
```

This works. `describeProduct('product-1')` builds a fresh Effect with that id
closed over. For a local helper it is fine.

`Effect.fn` does the same thing and adds two things you want the moment the
function lives in a service:

```ts twoslash
import { Effect } from 'effect'
declare const fetchProduct: (id: string) => Effect.Effect<{ name: string }>
// ---cut---
const describeProduct = Effect.fn('ProductCatalog.describe')(function* (
  id: string,
) {
  const product = yield* fetchProduct(id)
  return product.name.toUpperCase()
})
```

The generator now takes the parameters directly, and the string is a span name.
Every call opens a span called `ProductCatalog.describe` in the trace, so when
you turn tracing on later you get a timed tree of your own operation names
rather than an undifferentiated blob. `Effect.fn` also keeps the call site in
the stack trace, which a bare generator loses.

So the distinction to hold on to:

| | `Effect.gen` | `Effect.fn` |
| --- | --- | --- |
| What it returns | an Effect | a function that returns an Effect |
| Takes arguments | no | yes, on the generator |
| Creates a span | no | yes, named by you |
| Use it for | a program, a one-off step | every service method |

Name spans `Service.method`, matching where the code lives. A trace full of
`handler` and `run` tells you nothing at three in the morning. Use
`Effect.fnUntraced` when you deliberately want the argument handling without a
span, on a hot path called thousands of times.

Every service method in the rest of this course is written with `Effect.fn`.

## What people get wrong

Yielding something that is not an Effect. Usually an `Option`, because it feels
like it should work.

```ts twoslash
// @errors: 2345
import { Effect, Option } from 'effect'
// ---cut---
const program = Effect.gen(function* () {
  const value = yield* Option.some(1)
  return value
})
```

The message is long, and the last line of it is the whole point: an `Option` is
not an `Effect`. The fix is `Effect.fromOption`, which decides what absence
means in this program by turning it into a failure.

The second mistake is quieter, because nothing goes red. Calling a function
that returns an Effect and not yielding the result does nothing at all.

```ts twoslash
import { Effect } from 'effect'
declare const saveProduct: (name: string) => Effect.Effect<void>
// ---cut---
const program = Effect.gen(function* () {
  saveProduct('Desk mat')
  return 'saved'
})
```

`saveProduct` built a description and threw it away. The product was never
saved. In an `async` function the same line would at least have started the
work. Here, nothing happened. The Effect language service flags this one as a
floating Effect, which is a good reason to have it installed.

## Next

You can build Effects and compose them into programs. What none of these
examples did is fail in a way a caller could do anything about. [Typed errors
and recovery](/learn/basic-effect/03-typed-errors) fills in the `E` channel
properly: one type per failure, carrying the fields a handler needs, and
recovery the compiler can check is complete.
