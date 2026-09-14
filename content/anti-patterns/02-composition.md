---
title: Composition
order: 2
slug: 02-composition
summary: Two mistakes that come from writing Effect as though it were ordinary async code.
---

## map where flatMap belonged

From [Constructing and composing Effects](/learn/basic-effect/02-composition),
and the type tells you immediately if you look.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string>
declare const parse: (raw: string) => Effect.Effect<number>
// ---cut---
const wrong = Effect.map(readFile('port.txt'), parse)
//    ^?
```

An Effect inside an Effect. Run it and you get back a description of the work
rather than the number, and the inner program never runs at all.

If your function returns an Effect, use `flatMap`, or `yield*` it inside
`Effect.gen`.

## try and catch inside gen

From the same chapter. `Effect.gen` looks like `async` and `await`, so people
reach for the tool that goes with it.

```ts twoslash
import { Effect, Schema } from 'effect'
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
declare const readFile: (path: string) => Effect.Effect<string, NotFound>
// ---cut---
const load = Effect.gen(function* () {
  try {
    return yield* readFile('port.txt')
  } catch {
    return 'default'
  }
})
```

The `catch` block never runs. I checked: an Effect failure goes to the `E`
channel and walks straight past `try` and `catch`, which only sees thrown
values.

Handle failures with the tools from
[Typed errors and recovery](/learn/basic-effect/03-typed-errors).

```ts twoslash
import { Effect, Schema } from 'effect'
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
declare const readFile: (path: string) => Effect.Effect<string, NotFound>
// ---cut---
const load = readFile('port.txt').pipe(
  Effect.catchTag('NotFound', () => Effect.succeed('default')),
)
```

`try` and `finally` are still useful inside `gen` for ordinary throwing code.
They are just not how Effect failures are handled.
