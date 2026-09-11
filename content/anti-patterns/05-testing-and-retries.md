---
title: Testing and retries
order: 5
slug: 05-testing-and-retries
summary: A test that only tests its own stub, and a retry policy that is not a policy.
---

## Tests that only test the stub

From chapter ten. The test passes, and it proves nothing.

```ts twoslash
import { Context, Effect, Layer, Schema } from 'effect'
import { expect, test } from 'vitest'
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', { detail: Schema.String }) {}
class Fetcher extends Context.Service<Fetcher, {
  request(url: string): Effect.Effect<Response, NetworkError>
}>()('learning/Fetcher') {}
const product = { id: 1, title: 'Backpack' }
declare const runWith: (
  fetcher: Layer.Layer<Fetcher>,
) => Promise<ReadonlyArray<{ title: string }>>
// ---cut---
const stub = Layer.succeed(Fetcher)(
  Fetcher.of({ request: () => Effect.succeed(Response.json([product])) }),
)

test('returns the product', async () => {
  const products = await runWith(stub)
  expect(products[0].title).toBe('Backpack')
})
```

You told the stub to say Backpack and then checked that it said Backpack. The
only real assertion hiding in there is that decoding worked.

Test the decisions instead: how many attempts a 500 causes, what a schema
mismatch does, which branch a 404 takes. And when the question is about the
request itself, the URL or the headers, a stub cannot answer it, so use MSW.

## Retrying because retrying sounds good

From chapter nine. Three versions of the same misunderstanding.

```ts twoslash
import { Effect, Schedule } from 'effect'
declare const call: Effect.Effect<number, { readonly _tag: 'ResponseError'; readonly status: number }>
// ---cut---
const everything = call.pipe(Effect.retry(Schedule.forever))
```

Retrying every failure means a 404 is asked four more times, and a body that
did not match the schema is decoded again with the same result. Retrying
forever turns a broken deploy into a self inflicted denial of service.
Retrying without jitter means every client in the fleet comes back at the same
instant.

A policy is three decisions: which failures, how long between, and when to stop.

```ts twoslash
import { Effect, Schedule } from 'effect'
declare const call: Effect.Effect<number, { readonly _tag: 'ResponseError'; readonly status: number }>
// ---cut---
const sensible = call.pipe(
  Effect.retry({
    schedule: Schedule.exponential('200 millis').pipe(
      Schedule.jittered,
      Schedule.upTo({ times: 3 }),
    ),
    while: (error) => error.status >= 500,
  }),
)
```
