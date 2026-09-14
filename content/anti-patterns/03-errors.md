---
title: Errors
order: 3
slug: 03-errors
summary: One error type for everything, separate types named after status codes, and catching everything too early. Three ways to give back what the E channel was for.
---

## One error type with a message inside

From [Typed errors and recovery](/learn/basic-effect/03-typed-errors). This
looks tidy and it costs you everything that chapter was about.

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

The test is the retry decision from
[The ProductService capstone](/learn/basic-effect/08-capstone). If you cannot
write "retry this one, not that one" without reading a string, your errors are
not separate enough.

Give each failure its own tag and the fields a handler needs.

## Separate types that all say the same nothing

This one is subtler, and it survives a code review because it looks like the
fix for the mistake above. You did split the types. You named them after the
status code you were going to return.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  'NotFoundError',
  { message: Schema.String },
) {}

class BadRequestError extends Schema.TaggedError<BadRequestError>()(
  'BadRequestError',
  { message: Schema.String },
) {}
```

`catchTag` discriminates these perfectly well, so the compiler is happy. The
caller still is not. Three different lookups fail with `NotFoundError` and the
handler cannot tell a missing product from a missing customer, so it writes
"Not found" and someone opens a support ticket to find out which.

Name the failure after the thing that went missing, and carry what identifies
it.

```ts twoslash
import { Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
// ---cut---
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId },
) {}

class CustomerNotFoundError extends Schema.TaggedError<CustomerNotFoundError>()(
  'CustomerNotFoundError',
  { email: Schema.String },
) {}
```

The status code is a rendering decision, made once at the edge where the
response is built. It is not a name.

The test: can a handler write a message a person can act on, using only the
error it was given? If it needs a second lookup to find out what happened, the
error was named after the wrong thing.

## Catching everything, too early

From [Typed errors and recovery](/learn/basic-effect/03-typed-errors), which
has the short version. `Effect.catch` at the bottom of a helper is the same
mistake as a bare `catch {}` in ordinary code.

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
