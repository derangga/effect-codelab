/**
 * The same service, tested one level lower down.
 *
 * The tests next door swap the Fetcher. These do not: the real Fetcher runs,
 * the real global fetch is called, and MSW intercepts the request at the
 * network layer. That covers the URL, the query, the headers and the status
 * handling, which a stub cannot check because a stub never sees them.
 */
import { ConfigProvider, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { Attempts, Fetcher, ProductsApi, type ProductsError } from './products'

const baseUrl = 'https://api.test'

const product = {
  id: 1,
  title: 'Backpack',
  price: 109.95,
  category: 'bags',
  image: `${baseUrl}/bag.png`,
  rating: { rate: 3.9, count: 120 },
}

const server = setupServer()

// An unhandled request means the service asked for a URL nobody expected, and
// that should fail the test rather than quietly hit the internet.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ VITE_API_BASE_URL: baseUrl }),
)

const layer = ProductsApi.layerNoDeps.pipe(
  Layer.provide(Layer.mergeAll(Fetcher.layer, Attempts.layer)),
  Layer.provide(TestConfig),
)

const list = Effect.gen(function* () {
  const fiber = yield* ProductsApi.use((api) => api.list).pipe(
    Effect.map((products) => ({ tag: 'ok' as const, products })),
    Effect.catch((error: ProductsError) =>
      Effect.succeed({ tag: error._tag, products: [] }),
    ),
    Effect.provide(layer),
    Effect.forkChild,
  )

  yield* TestClock.adjust('60 seconds')
  return yield* Fiber.join(fiber)
}).pipe(Effect.provide(TestClock.layer()))

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
  expect(outcome.products[0].title).toBe('Backpack')
})

test('retries a 500 and gives up with the failure named', async () => {
  let calls = 0

  server.use(
    http.get(`${baseUrl}/products`, () => {
      calls += 1
      return new HttpResponse(null, { status: 500 })
    }),
  )

  const outcome = await Effect.runPromise(list)

  expect(outcome.tag).toBe('ResponseError')
  expect(calls).toBe(4)
})

test('does not retry a 404', async () => {
  let calls = 0

  server.use(
    http.get(`${baseUrl}/products`, () => {
      calls += 1
      return new HttpResponse(null, { status: 404 })
    }),
  )

  const outcome = await Effect.runPromise(list)

  expect(outcome.tag).toBe('ResponseError')
  expect(calls).toBe(1)
})

test('a body that is not JSON is caught before the schema', async () => {
  server.use(
    http.get(`${baseUrl}/products`, () =>
      HttpResponse.html('<html>gateway error</html>'),
    ),
  )

  const outcome = await Effect.runPromise(list)

  expect(outcome.tag).toBe('MalformedJson')
})
