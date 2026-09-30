/**
 * The capstone. Everything the course taught, in one file that actually runs.
 *
 * A Schema for the payload, one tagged error per way this can go wrong, and a
 * retry policy that knows the difference between a server having a bad minute
 * and a request that was simply wrong.
 */
import {
  type Cause,
  Clock,
  Context,
  Effect,
  Layer,
  Ref,
  Schedule,
  Schema,
} from 'effect'

// ---------------------------------------------------------------------------
// What a product is
// ---------------------------------------------------------------------------

export const Product = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  price: Schema.Number,
  category: Schema.String,
  image: Schema.String,
  rating: Schema.Struct({
    rate: Schema.Number,
    count: Schema.Number,
  }),
})

export type Product = typeof Product.Type

const Products = Schema.Array(Product)

const decodeProducts = Schema.decodeUnknownEffect(Products)

const decodeProduct = Schema.decodeUnknownEffect(Product)

// ---------------------------------------------------------------------------
// Every way this can fail, each with its own tag
// ---------------------------------------------------------------------------

/** The request never completed. Wrong host, no network, blocked by the browser. */
export class NetworkError extends Schema.TaggedError<NetworkError>()(
  'NetworkError',
  { detail: Schema.String },
) {}

/** The server answered, and the answer was not a success. */
export class ResponseError extends Schema.TaggedError<ResponseError>()(
  'ResponseError',
  { status: Schema.Number },
) {}

/** The body was not JSON at all. An HTML error page, usually. */
export class MalformedJson extends Schema.TaggedError<MalformedJson>()(
  'MalformedJson',
  { detail: Schema.String },
) {}

/** Valid JSON, wrong shape. The API changed under us. */
export class SchemaMismatch extends Schema.TaggedError<SchemaMismatch>()(
  'SchemaMismatch',
  { detail: Schema.String },
) {}

/** The whole attempt took longer than we are willing to wait. */
export class RequestTimeout extends Schema.TaggedError<RequestTimeout>()(
  'RequestTimeout',
  { after: Schema.String },
) {}

export type ProductsError =
  | NetworkError
  | ResponseError
  | MalformedJson
  | SchemaMismatch
  | RequestTimeout

// ---------------------------------------------------------------------------
// Fetcher: the seam that makes the demo page possible
// ---------------------------------------------------------------------------

/**
 * The one impure thing in here, behind a service so it can be swapped. The
 * live layer is global fetch. The demo page provides a layer that breaks it on
 * purpose, and nothing below this line knows the difference.
 */
export const liveRequest = (
  url: string,
): Effect.Effect<Response, NetworkError> =>
  Effect.tryPromise({
    try: () => fetch(url),
    catch: (cause) => new NetworkError({ detail: String(cause) }),
  })

export class Fetcher extends Context.Service<
  Fetcher,
  { request(url: string): Effect.Effect<Response, NetworkError> }
>()('learning/Fetcher') {
  static readonly layer = Layer.succeed(Fetcher)(
    Fetcher.of({ request: liveRequest }),
  )
}

// ---------------------------------------------------------------------------
// Attempts: so retries are visible instead of merely described
// ---------------------------------------------------------------------------

export interface Attempt {
  readonly n: number
  readonly at: number
  readonly outcome: string
}

export class Attempts extends Context.Service<
  Attempts,
  { record(attempt: Attempt): Effect.Effect<void> }
>()('learning/Attempts') {
  /** Default for anyone who does not care. The demo page provides its own. */
  static readonly layer = Layer.succeed(Attempts)(
    Attempts.of({ record: () => Effect.void }),
  )
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * A 500 is worth another go. A 404 means the request was wrong, and asking the
 * same wrong question four more times only wastes the user's time. Timeouts
 * and network errors retry, because those are the transient ones.
 */
export const isRetryable = (error: ProductsError): boolean => {
  switch (error._tag) {
    case 'ResponseError':
      return error.status >= 500
    case 'NetworkError':
    case 'RequestTimeout':
      return true
    case 'MalformedJson':
    case 'SchemaMismatch':
      return false
  }
}

export const retryPolicy = Schedule.exponential('200 millis').pipe(
  // Without jitter every client in a bad minute retries at the same instant.
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
)

export const requestTimeout = '2 seconds'

/**
 * The catalog this demo reads. A public, unauthenticated API, so it is a
 * constant rather than config: there is nothing here to keep out of the
 * bundle and nothing to vary per deploy. The tests point MSW at this same
 * value. For config that does vary, see Repository state, layers, and config
 * in the Basic Effect track.
 */
export const baseUrl = 'https://fakestoreapi.com'

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export class ProductsApi extends Context.Service<
  ProductsApi,
  {
    readonly list: Effect.Effect<ReadonlyArray<Product>, ProductsError>
    readonly byId: (id: number) => Effect.Effect<Product, ProductsError>
  }
>()('learning/ProductsApi') {
  static readonly layerNoDeps: Layer.Layer<
    ProductsApi,
    never,
    Fetcher | Attempts
  > = Layer.effect(
    ProductsApi,
    Effect.gen(function* () {
      const fetcher = yield* Fetcher
      const attempts = yield* Attempts

      /**
       * One request, decoded, under a deadline. The URL and the expected shape
       * are the only things that differ between the two methods below, so they
       * are parameters instead of a second copy of this block.
       */
      const once = <A>(
        url: string,
        decode: (body: unknown) => Effect.Effect<A, Schema.SchemaError>,
      ) =>
        Effect.gen(function* () {
          const response = yield* fetcher.request(url)

          if (!response.ok) {
            return yield* new ResponseError({ status: response.status })
          }

          const body = yield* Effect.tryPromise({
            try: () => response.json() as Promise<unknown>,
            catch: (cause) => new MalformedJson({ detail: String(cause) }),
          })

          return yield* decode(body).pipe(
            Effect.mapError(
              (error) => new SchemaMismatch({ detail: error.message }),
            ),
          )
        }).pipe(Effect.timeout(requestTimeout), Effect.mapError(toProductsError))

      const listOnce = once(`${baseUrl}/products`, decodeProducts)

      const list = Effect.gen(function* () {
        // Built inside the gen, so each run of `list` gets its own counter and
        // the attempt log starts at one rather than continuing the last run.
        const counter = yield* Ref.make(0)

        const record = Effect.fn('ProductsApi.record')(function* (
          outcome: string,
        ) {
          const n = yield* Ref.get(counter)
          // The clock is a service, so the retry tests can wind it forward and
          // still get timestamps that agree with the delays they asserted.
          const at = yield* Clock.currentTimeMillis
          yield* attempts.record({ n, at, outcome })
        })

        const attempt = Effect.gen(function* () {
          yield* Ref.update(counter, (n) => n + 1)
          return yield* listOnce
        }).pipe(
          Effect.tapError((error) => record(describe(error))),
          Effect.tap(() => record('ok')),
        )

        return yield* attempt.pipe(
          Effect.retry({ schedule: retryPolicy, while: isRetryable }),
        )
      })

      /**
       * One product, same timeout and same retry policy as `list`. It records
       * nothing into Attempts: the demo page runs nine of these at once, and
       * nine interleaved retry logs would be noise rather than a lesson. Callers that want to watch a run watch it from outside.
       */
      const byId = (id: number) =>
        once(`${baseUrl}/products/${id}`, decodeProduct).pipe(
          Effect.retry({ schedule: retryPolicy, while: isRetryable }),
        )

      return ProductsApi.of({ list, byId })
    }),
  )

  /** Everything wired except the parts the caller chooses. */
  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(Fetcher.layer, Attempts.layer)),
  )
}

/** Effect.timeout adds its own TimeoutError. Fold it into our own taxonomy. */
const toProductsError = (
  error: ProductsError | Cause.TimeoutError,
): ProductsError =>
  error._tag === 'TimeoutError'
    ? new RequestTimeout({ after: requestTimeout })
    : error

export const describe = (error: ProductsError): string => {
  switch (error._tag) {
    case 'NetworkError':
      return `NetworkError: ${error.detail}`
    case 'ResponseError':
      return `ResponseError: HTTP ${error.status}`
    case 'MalformedJson':
      return 'MalformedJson: body was not JSON'
    case 'SchemaMismatch':
      return `SchemaMismatch: ${error.detail.split('\n')[0]}`
    case 'RequestTimeout':
      return `RequestTimeout: over ${error.after}`
  }
}
