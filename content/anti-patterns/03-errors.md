---
title: Errors
order: 3
slug: 03-errors
summary: One error type for everything, and catching everything too early. Both give back what the E channel was for.
---

## One error type with a message inside

From [Errors](/learn/basic-effect/03-typed-errors). This looks tidy and it costs you
everything that chapter was about.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  message: Schema.String,
}) {}
```

Every failure is now the same type, so `catchTag` has nothing to discriminate
and the compiler cannot tell you which cases you have handled. Sooner or later
somebody writes `if (error.message.includes('404'))`, and that is string
matching on prose.

The test is the retry function from
[The Capstone](/learn/basic-effect/08-capstone). If you cannot write "retry
this one, not that one" without reading a string, your errors are not separate
enough.

Give each failure its own tag and the fields a handler needs.

## Catching everything, too early

From [Errors](/learn/basic-effect/03-typed-errors). `Effect.catch` at the bottom of
a helper is the same mistake
as a bare `catch {}` in ordinary code.

```ts twoslash
import { Effect } from 'effect'
declare const load: Effect.Effect<number, 'NotFound' | 'BadFormat'>
// ---cut---
const port = load.pipe(Effect.catch(() => Effect.succeed(8080)))
//    ^?
```

The type says this cannot fail, which is now a lie the compiler will defend.
The caller cannot tell a missing file from a corrupt one, and cannot decide to
retry the one that is worth retrying.

Catch at the edge, where something has to become a screen or a response. In
between, let failures accumulate.

The same warning covers `Effect.orDie`. It is for failures you have genuinely
ruled out, not for making a red squiggle go away.
