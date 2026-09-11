---
title: Testing
order: 10
slug: 10-testing
summary: Swapping the layer, swapping the clock, and the one case where a network mocking library still earns its place.
---

Chapter seven claimed that services make code testable. This chapter cashes
that claim, against the same service the demo page calls.

The tests described here are real. They live in
`src/effect-demo/products.test.ts` and `products.msw.test.ts`, and
`bun run test` runs them.

## The stub is just an object

Here is a whole test double.

```ts twoslash
import { Context, Effect, Layer, Schema } from 'effect'
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', { detail: Schema.String }) {}
class Fetcher extends Context.Service<Fetcher, {
  request(url: string): Effect.Effect<Response, NetworkError>
}>()('learning/Fetcher') {}
const oneProduct = [{ id: 1, title: 'Backpack' }]
// ---cut---
const stub = Layer.succeed(Fetcher)(
  Fetcher.of({ request: () => Effect.succeed(Response.json(oneProduct)) }),
)
```

No library, no patching of globals, no `vi.mock`, no resetting between tests.
It is an object that satisfies the shape, wrapped in a layer.

Provide it instead of the real one and the service under test is unchanged.

```ts twoslash
import { ConfigProvider, Context, Effect, Layer, Schema } from 'effect'
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', { detail: Schema.String }) {}
class Fetcher extends Context.Service<Fetcher, {
  request(url: string): Effect.Effect<Response, NetworkError>
}>()('learning/Fetcher') {}
class Attempts extends Context.Service<Attempts, {
  record(attempt: { n: number }): Effect.Effect<void>
}>()('learning/Attempts') {
  static readonly layer = Layer.succeed(Attempts)(Attempts.of({ record: () => Effect.void }))
}
class ProductsApi extends Context.Service<ProductsApi, {
  readonly list: Effect.Effect<ReadonlyArray<{ title: string }>>
}>()('learning/ProductsApi') {
  static readonly layerNoDeps: Layer.Layer<ProductsApi, never, Fetcher | Attempts> = Layer.succeed(ProductsApi)(ProductsApi.of({ list: Effect.succeed([]) }))
}
declare const stub: Layer.Layer<Fetcher>
const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ VITE_API_BASE_URL: 'https://api.test' }),
)
// ---cut---
const layer = ProductsApi.layerNoDeps.pipe(
  Layer.provide(Layer.mergeAll(stub, Attempts.layer)),
  Layer.provide(TestConfig),
)
```

Read what that says. The service still reads its base URL from config, still
decodes with the schema, still applies its retry policy. Only the one thing
that would have touched the network is different, and the config comes from an
object instead of a `.env` file, which is the same swap in a different place.

That is the difference between testing your code and testing your mocks.

## Time is a dependency too

The first version of these tests took twelve seconds. The retry policy waits
200 milliseconds, then 400, then 800, and the timeout test waits two seconds
per attempt, four times over. All of it real waiting, for no reason.

`Effect.sleep` does not call `setTimeout` directly. It asks the clock, and the
clock is a service like any other, so a test can hand over a fake one.

```ts twoslash
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
declare const listProducts: Effect.Effect<ReadonlyArray<string>>
// ---cut---
const program = Effect.gen(function* () {
  // Start it, but do not wait for it.
  const fiber = yield* listProducts.pipe(Effect.forkChild)

  // Wind the clock past every delay the policy could ask for.
  yield* TestClock.adjust('60 seconds')

  return yield* Fiber.join(fiber)
}).pipe(Effect.provide(TestClock.layer()))
```

Three lines and the twelve seconds became fourteen milliseconds. Same
assertions, same code under test, same number of attempts.

The forking is the part to understand. Under a fake clock the call would wait
forever, because the clock only moves when you move it. So start the work on
its own fiber, which is Effect's word for a task running alongside yours, then
move the clock, then collect the result.

Nothing in the service was written with this in mind. It got a controllable
clock for the same reason it got a stub Fetcher: it asked for what it needed
instead of reaching for a global.

## Test what the policy promises

With those two swaps in place, the interesting tests write themselves. The
retry rules from chapter nine were a claim, and this is the claim being
checked.

```ts twoslash
import { expect, test } from 'vitest'
declare const runFault: (
  fault: 'server-error' | 'not-found',
) => Promise<{ tag: string; attempts: number }>
// ---cut---
test('a 500 is tried again, up to the cap', async () => {
  const outcome = await runFault('server-error')

  expect(outcome.tag).toBe('ResponseError')
  // The first go plus three retries. Change the policy and this fails.
  expect(outcome.attempts).toBe(4)
})

test('a 404 is not tried again', async () => {
  const outcome = await runFault('not-found')

  expect(outcome.tag).toBe('ResponseError')
  expect(outcome.attempts).toBe(1)
})
```

Those two tests are the whole reason the errors were separate types. Same
error class, same code path, and the only difference is a status code that
`isRetryable` reads. If someone later decides 404 should retry, or removes the
cap, a test says so by name.

The fault injection the demo page uses is the same helper the tests use. One
set of broken responses, driving both the page you can click and the suite that
runs in CI.

## Where a stub stops being enough

A stub returns whatever you tell it to. It never checks that the service asked
for the right thing.

If the URL is built wrong, if a query parameter is missing, if a header is not
set, the stub answers cheerfully anyway and the test passes. That is the gap,
and it is where a network mocking library like MSW earns its place: it
intercepts at the network layer, so the real `fetch` runs and the request
itself becomes something you can inspect.

```ts twoslash
import { Effect } from 'effect'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { expect, test } from 'vitest'

const server = setupServer()
const baseUrl = 'https://api.test'
const product = { id: 1, title: 'Backpack' }
declare const list: Effect.Effect<{
  tag: string
  products: ReadonlyArray<{ title: string }>
}>
// ---cut---
test('asks for the right URL and decodes the answer', async () => {
  let asked: string | undefined

  server.use(
    http.get(`${baseUrl}/products`, ({ request }) => {
      asked = request.url
      return HttpResponse.json([product])
    }),
  )

  const outcome = await Effect.runPromise(list)

  expect(asked).toBe(`${baseUrl}/products`)
  expect(outcome.tag).toBe('ok')
})
```

The setup is three lines and one rule worth copying.

```ts twoslash
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'
// ---cut---
const server = setupServer()

// An unhandled request means the service asked for a URL nobody expected, and
// that should fail the test rather than quietly hit the internet.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

`onUnhandledRequest: 'error'` is the setting that matters. Without it a typo in
a URL means the test reaches the real internet, and then your suite is slow,
flaky, and green for the wrong reason.

Note what is not swapped here. The real `Fetcher` layer is provided, so the
real `fetch` runs. MSW answers it. The service is exercised end to end apart
from the wire itself.

## Choosing between them

Both files test the same service, and neither is the correct one.

| Question | Answer with |
| --- | --- |
| Does the retry policy do what chapter nine said | Layer swap |
| Does a schema mismatch fail the way we want | Layer swap |
| Is the URL built correctly | MSW |
| Do we send the header the API needs | MSW |
| Does a real 500 response behave like our fake one | MSW |

The layer swap is faster and has less to go wrong, so most tests are that. MSW
is for the handful of tests about the request itself, which is exactly the part
a stub cannot see.

Start with the layer swap. Add MSW when you catch yourself asserting on
something the stub was told to say.

## A note on what you are not testing

Do not write a test that checks `Effect.succeed(1)` succeeds. The compiler
already knows.

The tests worth having in an Effect codebase are the ones about decisions:
which failures retry, what the schema rejects, what happens when config is
missing, which branch a caller takes. Those are decisions a person made, and a
person can change them by accident.

Everything the types already guarantee is not worth a test, and this course
spent nine chapters moving as much as possible into that category.

## Next

Chapter eleven is the last one, and it is the shortest to use: the mistakes
this course has now made possible, each one paired with the chapter it comes
from and the fix.
