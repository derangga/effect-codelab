---
title: Typed errors and recovery
order: 3
slug: 03-typed-errors
summary: Replace one catch-all error class with named failures that carry what a caller needs, including the 404 that mockstore-api returns for a product that does not exist, then handle them by tag until the channel is empty.
---

`ApiError` covers a dead network, a 500 from the server, and a product that
does not exist. A caller who catches it knows something went wrong and nothing
else. It cannot retry the first, log the second, and show a friendly page for
the third, because it cannot tell them apart.

The error channel is a type. It can hold as much detail as you are willing to
put there.

## An error that is a value

```ts twoslash
// index.ts, replacing both error classes from chapter two
import { Schema } from 'effect'

class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()(
  'ApiUnavailable',
  {
    status: Schema.optional(Schema.Number),
    message: Schema.String,
  },
) {}

class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  {
    id: Schema.Number,
    message: Schema.String,
  },
) {}
```

Three properties of that declaration are doing work.

The tag, `'ApiUnavailable'`, is a literal string on every instance. That is what
makes a union of errors discriminable, and it is what `catchTag` matches on.

The fields are a schema, so the error is a real value rather than a sentence.
`ProductNotFound` carries the id that was missing. A handler that wants to log
it, or put it in a response body, has it without parsing a string.

`message` is a field like any other, and it is for humans. It is not the place
to record which error this is. That is the tag's job.

Name the type after the reason, not the response. `ProductNotFound` says what
happened. A shared `NotFoundError` used for products, orders and users tells
the caller nothing and forces a second field to say which.

## Failing on purpose

A `Schema.TaggedError` instance is itself an Effect that fails, so inside a
generator you yield it.

```ts twoslash
import { Effect, Schema } from 'effect'
class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  { id: Schema.Number, message: Schema.String },
) {}
declare const request: (path: string) => Effect.Effect<Response>
// ---cut---
const orFail = (id: number) =>
  Effect.gen(function* () {
    const response = yield* request(`/products/${id}`)

    if (response.status === 404) {
      return yield* new ProductNotFound({
        id,
        message: `no product has id ${id}`,
      })
    }

    return response
  })
```

`Effect.fail(error)` does the same and reads better inside a `pipe`. In a
generator, yielding the error directly is the shorter form.

## Looking at the status first

Chapter one showed what happens when nothing looks at the status. The 404 body
parsed as JSON, `as Product` waved it through, and the crash arrived a line
later. The status is where a missing product announces itself, so the check
goes before the body is read at all.

The two things that can go wrong before there is a status are the request and
the read.

```ts twoslash
// index.ts, replacing request and readJson
import { Effect, Schema } from 'effect'
class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()(
  'ApiUnavailable',
  { status: Schema.optional(Schema.Number), message: Schema.String },
) {}
// ---cut---
const request = (path: string) =>
  Effect.tryPromise({
    try: () => fetch(`https://mockstore-api.rangga.site${path}`),
    catch: () => new ApiUnavailable({ message: 'the request never completed' }),
  })

const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new ApiUnavailable({ message: 'the body was not JSON' }),
  })
```

Both rejections are `ApiUnavailable` with no status, because neither of them
got far enough to have one. A `fetch` that never completed and a body that
could not be parsed are the same thing to a caller. The server did not give an
answer worth reading.

## Three outcomes

```ts twoslash
// index.ts
import { Effect, Schema } from 'effect'
interface Product { id: number; title: string; price: number }
class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()(
  'ApiUnavailable',
  { status: Schema.optional(Schema.Number), message: Schema.String },
) {}
class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  { id: Schema.Number, message: Schema.String },
) {}
const request = (path: string) =>
  Effect.tryPromise({
    try: () => fetch(`https://mockstore-api.rangga.site${path}`),
    catch: () => new ApiUnavailable({ message: 'the request never completed' }),
  })
const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new ApiUnavailable({ message: 'the body was not JSON' }),
  })
// ---cut---
const findById = (id: number) =>
//    ^?
  Effect.gen(function* () {
    const response = yield* request(`/products/${id}`)

    if (response.status === 404) {
      return yield* new ProductNotFound({
        id,
        message: `no product has id ${id}`,
      })
    }

    if (!response.ok) {
      return yield* new ApiUnavailable({
        status: response.status,
        message: `mockstore-api answered ${response.status}`,
      })
    }

    return (yield* readJson(response)) as Product
  })
```

The type now lists both failures by name. Nobody declared that union either. It
is the sum of what the body of the generator can do, collected at each `yield*`
and at each thrown error.

The `as Product` is still a lie, and it is the last one. Chapter four removes
it.

## Handling by tag

```ts twoslash
import { Effect, Schema } from 'effect'
interface Product { id: number; title: string; price: number }
class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()(
  'ApiUnavailable',
  { status: Schema.optional(Schema.Number), message: Schema.String },
) {}
class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  { id: Schema.Number, message: Schema.String },
) {}
declare const findById: (
  id: number,
) => Effect.Effect<Product, ApiUnavailable | ProductNotFound>
// ---cut---
const describe = (id: number) =>
//    ^?
  findById(id).pipe(
    Effect.map((product) => product.title),
    Effect.catchTags({
      ApiUnavailable: (error) => Effect.succeed(`unavailable: ${error.message}`),
      ProductNotFound: (error) => Effect.succeed(`not found: ${error.message}`),
    }),
  )
```

`never` in the error channel. That is the whole point of the chapter in one
word. This Effect cannot fail any more, and the compiler knows it because every
tag in the union was named and answered.

Each handler gets its own error, fully typed. Inside the `ProductNotFound`
branch, `error.id` is a number and the compiler knows it. Inside the other,
`error.status` is there when the server answered and absent when the network
did not.

Take one handler out and the channel is no longer `never`. Add a fourth error
somewhere deep in the stack and every `catchTags` that does not cover it stops
compiling. That is the failure mode worth having, because the alternative is
the one from chapter one, where a new way to fail is discovered by a user.

### The mistake

`Effect.catch` also makes the channel `never`, and it will happily do it to
errors you had no plan for.

```ts twoslash
import { Effect, Schema } from 'effect'
interface Product { id: number; title: string }
class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()(
  'ApiUnavailable',
  { status: Schema.optional(Schema.Number), message: Schema.String },
) {}
class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  { id: Schema.Number, message: Schema.String },
) {}
declare const findById: (
  id: number,
) => Effect.Effect<Product, ApiUnavailable | ProductNotFound>
// ---cut---
const careless = (id: number) =>
  findById(id).pipe(Effect.catch(() => Effect.succeed('something broke')))
```

This compiles and it will keep compiling after you add three more failure
modes, silently turning each of them into the same string. `Effect.catch` is right
when you genuinely mean any failure at all, usually at the very top of a
program. Anywhere else, name the tags.

The other half of the mistake is catching too early. Handle an error at the
point that knows what to do about it. `findById` does not know whether a
missing product is a 404 or an empty list, so it should not decide. It reports.

## Where the file stands

```ts twoslash
// index.ts
import { Effect, Schema } from 'effect'

interface Rating {
  rate: number
  count: number
}

interface Product {
  id: number
  title: string
  price: number
  description: string
  category: string
  image: string
  rating: Rating
}

class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()(
  'ApiUnavailable',
  {
    status: Schema.optional(Schema.Number),
    message: Schema.String,
  },
) {}

class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  {
    id: Schema.Number,
    message: Schema.String,
  },
) {}

const request = (path: string) =>
  Effect.tryPromise({
    try: () => fetch(`https://mockstore-api.rangga.site${path}`),
    catch: () => new ApiUnavailable({ message: 'the request never completed' }),
  })

const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new ApiUnavailable({ message: 'the body was not JSON' }),
  })

const findById = (id: number) =>
  Effect.gen(function* () {
    const response = yield* request(`/products/${id}`)

    if (response.status === 404) {
      return yield* new ProductNotFound({
        id,
        message: `no product has id ${id}`,
      })
    }

    if (!response.ok) {
      return yield* new ApiUnavailable({
        status: response.status,
        message: `mockstore-api answered ${response.status}`,
      })
    }

    return (yield* readJson(response)) as Product
  })

const describe = (id: number) =>
  findById(id).pipe(
    Effect.map((product) => product.title),
    Effect.catchTags({
      ApiUnavailable: (error) => Effect.succeed(`unavailable: ${error.message}`),
      ProductNotFound: (error) => Effect.succeed(`not found: ${error.message}`),
    }),
  )

const main = Effect.gen(function* () {
  console.log(yield* describe(1))
  console.log(yield* describe(999))
})

Effect.runPromise(main)
```

```sh
Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops
not found: no product has id 999
```

The 404 that crashed chapter one is now a sentence, and it got there by being a
value with a name the compiler checked.

One lie is left. `readJson(response)` returns `unknown` and `as Product` still asserts a shape nobody
verified, and every field on `Product` is a promise this code has no way to
keep. Chapter four makes the shape something that is checked at runtime, and
the file gets too long to stay one file.
