---
title: Testing and retries
order: 5
slug: 05-testing-and-retries
summary: A test that only tests its own stub, and a retry policy that is not a policy.
---

## Tests that only test the stub

From [Effect-native testing and review](/learn/basic-effect/09-testing). The
test passes, and it proves nothing.

```ts twoslash
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', {
  detail: Schema.String,
}) {}
class Fetcher extends Context.Service<
  Fetcher,
  { readonly request: (url: string) => Effect.Effect<Response, NetworkError> }
>()('Fetcher') {}
declare const listProducts: Effect.Effect<
  ReadonlyArray<{ readonly title: string }>,
  NetworkError,
  Fetcher
>
const product = { title: 'Backpack' }
// ---cut---
const stub = Layer.succeed(Fetcher, {
  request: () => Effect.succeed(Response.json([product])),
})

describe('listProducts', () => {
  it.effect('returns the product', () =>
    Effect.gen(function* () {
      const products = yield* listProducts

      assert.strictEqual(products[0].title, 'Backpack')
    }).pipe(Effect.provide(stub)),
  )
})
```

You told the stub to say Backpack and then checked that it said Backpack. The
only real assertion hiding in there is that decoding worked.

Test the decisions instead: how many attempts a 500 causes, what a schema
mismatch does, which branch a 404 takes. And when the question is about the
request itself, the URL or the headers, a stub cannot answer it, so use MSW.

## Retrying because retrying sounds good

From [The ProductService capstone](/learn/basic-effect/08-capstone). Three
versions of the same misunderstanding.

```ts twoslash
import { Effect, Schedule } from 'effect'
declare const call: Effect.Effect<number>
// ---cut---
const everything = call.pipe(Effect.retry(Schedule.forever))
```

Retrying every failure means a 404 is asked four more times, and a body that
did not match the schema is decoded again with the same result. Retrying
forever turns a broken deploy into a self inflicted denial of service.
Retrying without jitter means every client in the fleet comes back at the same
instant.

A policy is three decisions: which failures, how long between, and when to stop.

The first decision is the one worth writing as its own function, because it is
the one that has to keep being right.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', {
  detail: Schema.String,
}) {}

class ResponseError extends Schema.TaggedError<ResponseError>()(
  'ResponseError',
  { status: Schema.Number },
) {}

class SchemaMismatch extends Schema.TaggedError<SchemaMismatch>()(
  'SchemaMismatch',
  { detail: Schema.String },
) {}

type CallError = NetworkError | ResponseError | SchemaMismatch

const isRetryable = (error: CallError): boolean => {
  switch (error._tag) {
    case 'ResponseError':
      return error.status >= 500
    case 'NetworkError':
      return true
    case 'SchemaMismatch':
      return false
  }
}
```

Note what is missing: there is no `default`. Add a fourth failure to
`CallError` and this stops compiling until somebody decides whether it is worth
retrying. A predicate written inline as `(error) => error.status >= 500` gives
that up, and quietly answers "no" for every failure that has no `status` at
all.

Then the other two decisions wrap the call.

```ts twoslash
import { Effect, Schedule, Schema } from 'effect'
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', {
  detail: Schema.String,
}) {}
class ResponseError extends Schema.TaggedError<ResponseError>()(
  'ResponseError',
  { status: Schema.Number },
) {}
class SchemaMismatch extends Schema.TaggedError<SchemaMismatch>()(
  'SchemaMismatch',
  { detail: Schema.String },
) {}
type CallError = NetworkError | ResponseError | SchemaMismatch
declare const isRetryable: (error: CallError) => boolean
declare const call: Effect.Effect<number, CallError>
// ---cut---
const sensible = call.pipe(
  Effect.retry({
    schedule: Schedule.exponential('200 millis').pipe(
      Schedule.jittered,
      Schedule.upTo({ times: 3 }),
    ),
    while: isRetryable,
  }),
)
```

Exponential so a struggling server is not hammered, jittered so a thousand
clients do not come back in the same millisecond, capped so a small problem
stays small.
