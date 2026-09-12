/**
 * Tests for the capstone service, with no network and no mocking library.
 *
 * Every one of these swaps the Fetcher layer. The service under test is the
 * real one, unchanged, and it cannot tell that anything is unusual.
 *
 * Time is swapped too. TestClock makes the retry backoff and the timeout
 * happen instantly, so the whole file runs in milliseconds rather than the
 * twelve seconds real waiting would cost.
 */
import { ConfigProvider, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, describe as suite, test } from 'vitest'
import { type Fault, fetcherLayer } from './faults'
import {
  type Attempt,
  Attempts,
  describe,
  Fetcher,
  NetworkError,
  ProductsApi,
  type ProductsError,
} from './products'

const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ VITE_API_BASE_URL: 'https://api.test' }),
)

const oneProduct = [
  {
    id: 1,
    title: 'Backpack',
    price: 109.95,
    category: 'bags',
    image: 'https://api.test/bag.png',
    rating: { rate: 3.9, count: 120 },
  },
]

/**
 * Runs `list` against one Fetcher and reports the outcome plus how many
 * attempts it took. Forked so the fake clock can be wound forward past every
 * sleep the retry policy asks for.
 */
const runWith = (fetcher: Layer.Layer<Fetcher>) => {
  const log: Array<Attempt> = []
  const recording = Layer.succeed(Attempts)(
    Attempts.of({
      record: (attempt) =>
        Effect.sync(() => {
          log.push(attempt)
        }),
    }),
  )

  const layer = ProductsApi.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(fetcher, recording)),
    Layer.provide(TestConfig),
  )

  const program = Effect.gen(function* () {
    const fiber = yield* ProductsApi.use((api) => api.list).pipe(
      Effect.map((products) => ({ tag: 'ok' as const, products })),
      Effect.catch((error: ProductsError) =>
        Effect.succeed({
          tag: error._tag,
          products: [],
          detail: describe(error),
        }),
      ),
      Effect.provide(layer),
      Effect.forkChild,
    )

    // Well past every delay the policy can ask for.
    yield* TestClock.adjust('60 seconds')

    const outcome = yield* Fiber.join(fiber)
    return { ...outcome, attempts: log.length }
  })

  return Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())))
}

const runFault = (fault: Fault) => runWith(fetcherLayer(fault))

suite('the happy path', () => {
  test('decodes what the server sent', async () => {
    // A Fetcher written by hand, which is all a stub needs to be.
    const stub = Layer.succeed(Fetcher)(
      Fetcher.of({ request: () => Effect.succeed(Response.json(oneProduct)) }),
    )

    const outcome = await runWith(stub)

    expect(outcome.tag).toBe('ok')
    expect(outcome.products).toHaveLength(1)
    expect(outcome.products[0].title).toBe('Backpack')
    // A number because the schema decoded it, not because we cast it.
    expect(outcome.products[0].rating.rate).toBe(3.9)
    expect(outcome.attempts).toBe(1)
  })
})

suite('failures that are worth retrying', () => {
  test('a 500 is tried again, up to the cap', async () => {
    const outcome = await runFault('server-error')

    expect(outcome.tag).toBe('ResponseError')
    // The first go plus three retries. Change the policy and this fails.
    expect(outcome.attempts).toBe(4)
  })

  test('a request that never lands is tried again', async () => {
    const unreachable = Layer.succeed(Fetcher)(
      Fetcher.of({
        request: () =>
          Effect.fail(new NetworkError({ detail: 'getaddrinfo ENOTFOUND' })),
      }),
    )

    const outcome = await runWith(unreachable)

    expect(outcome.tag).toBe('NetworkError')
    expect(outcome.attempts).toBe(4)
  })

  test('an attempt that runs long is cut off and tried again', async () => {
    const outcome = await runFault('slow')

    expect(outcome.tag).toBe('RequestTimeout')
    expect(outcome.attempts).toBe(4)
  })
})

suite('failures that retrying cannot fix', () => {
  test('a 404 is not tried again', async () => {
    const outcome = await runFault('not-found')

    expect(outcome.tag).toBe('ResponseError')
    expect(outcome.attempts).toBe(1)
  })

  test('a body that is not JSON is not tried again', async () => {
    const outcome = await runFault('malformed-json')

    expect(outcome.tag).toBe('MalformedJson')
    expect(outcome.attempts).toBe(1)
  })

  test('JSON in the wrong shape is not tried again', async () => {
    const outcome = await runFault('wrong-shape')

    expect(outcome.tag).toBe('SchemaMismatch')
    expect(outcome.attempts).toBe(1)
  })
})
