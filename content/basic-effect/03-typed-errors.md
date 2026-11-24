---
title: Typed errors and recovery
order: 3
slug: 03-typed-errors
summary: Replace one catch-all error class with named errors, including one for the empty body fakestoreapi returns for a missing product, then handle each error by its tag until the error channel is empty.
---

`ApiError` covers a dead network, a 500 from the server, and a product that
does not exist. A caller that catches it knows something went wrong and nothing
more. It cannot retry the first, log the second, and show a friendly page for
the third, because it cannot tell them apart.

The error channel lists how an Effect can fail. It is a type, so it can hold as
much detail as you put in it.

## Tagged errors as values

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

This declaration has three parts that matter.

The first is the tag, such as `'ApiUnavailable'`. A tag is a fixed string on
each error class that tells errors apart. Every instance carries it, so code
can tell the errors in a union apart, and `catchTag` matches on it.

The second is the fields, which you declare with a schema. The error is a real
value, not a sentence. `ProductNotFound` carries the id of the missing product,
so a handler can log it or put it in a response body without parsing a string.

The third is `message`. It is a field like any other, and it is for humans. Do
not use it to record which error this is. The tag does that.

Name the type after the reason, not the response. `ProductNotFound` says what
happened. A shared `NotFoundError` for products, orders and users tells the
caller nothing, and it forces you to add a second field to say which.

## Failing on purpose

A `Schema.TaggedError` instance is itself an Effect that fails. Inside a
generator, you yield it.

```ts twoslash
import { Effect, Schema } from 'effect'
class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  { id: Schema.Number, message: Schema.String },
) {}
declare const readBody: Effect.Effect<string>
// ---cut---
const orFail = (id: number) =>
  Effect.gen(function* () {
    const body = yield* readBody

    if (body === '') {
      return yield* new ProductNotFound({
        id,
        message: `no product has id ${id}`,
      })
    }

    return body
  })
```

`Effect.fail(error)` does the same and reads better inside a `pipe`. In a
generator, yielding the error directly is shorter.

## Reading the body as text first

[The Effect model](/learn/basic-effect/01-effect-model) showed why
`response.json()` is the wrong place to find out
that a product is missing. On an empty body, bun returns `null` and node
throws. The same response gives two different results, depending on the
runtime.

Read the body as text instead. An empty string is the same in both runtimes.

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
    try: () => fetch(`https://fakestoreapi.com${path}`),
    catch: () => new ApiUnavailable({ message: 'the request never completed' }),
  })

const readBody = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: () => new ApiUnavailable({ message: 'the body could not be read' }),
  })
```

Both rejections become `ApiUnavailable` with no status, because neither got far
enough to have one. A `fetch` that never completed and a body that could not be
read look the same to a caller. Both are network problems, not server problems.

## Three checks, three outcomes

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
    try: () => fetch(`https://fakestoreapi.com${path}`),
    catch: () => new ApiUnavailable({ message: 'the request never completed' }),
  })
const readBody = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: () => new ApiUnavailable({ message: 'the body could not be read' }),
  })
// ---cut---
const findById = (id: number) =>
//    ^?
  Effect.gen(function* () {
    const response = yield* request(`/products/${id}`)

    if (!response.ok) {
      return yield* new ApiUnavailable({
        status: response.status,
        message: `fakestoreapi answered ${response.status}`,
      })
    }

    const body = yield* readBody(response)

    if (body === '') {
      return yield* new ProductNotFound({
        id,
        message: `no product has id ${id}`,
      })
    }

    return JSON.parse(body) as Product
  })
```

The type now lists both errors by name. Nobody wrote that union. Effect builds
it from everything the generator body can do, collecting the failures at each `yield*`.

The `as Product` cast still asserts a shape that nothing checks. It is the last
one, and the next chapter removes it.

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

The error channel of `describe` is now `never`. This Effect cannot fail any
more. The compiler knows it, because every tag in the union has a handler.

Each handler receives its own error, fully typed. In the `ProductNotFound`
handler, `error.id` is a number. In the `ApiUnavailable` handler,
`error.status` is present when the server answered and absent when the network
did not.

Remove one handler and its error stays in the channel, so `describe` is no
longer `Effect<string, never>`. The same happens when someone adds a third
error deep in the code that `findById` calls. A `catchTags` that does not cover
it still compiles. The new error flows on to the first place that expects
`never`, such as a function whose return type promises it cannot fail. That
place stops compiling. This is the failure you want. Without it, a user finds the new way to fail, as in the Effect model chapter.

### The mistake

`Effect.catch` also sets the error channel to `never`. It does this for every
error, including ones you never planned for.

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

This compiles. It keeps compiling after you add three more failure modes, and
it turns each of them into the same string with no warning. `Effect.catch` is
right when you mean any failure at all, usually at the top of a program.
Everywhere else, name the tags.

Catching too early is a second mistake. Handle an error where the code knows
what to do about it. `findById` does not know whether a missing product should
be a 404 or an empty list, so it should not decide. It reports the error.

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
    try: () => fetch(`https://fakestoreapi.com${path}`),
    catch: () => new ApiUnavailable({ message: 'the request never completed' }),
  })

const readBody = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: () => new ApiUnavailable({ message: 'the body could not be read' }),
  })

const findById = (id: number) =>
  Effect.gen(function* () {
    const response = yield* request(`/products/${id}`)

    if (!response.ok) {
      return yield* new ApiUnavailable({
        status: response.status,
        message: `fakestoreapi answered ${response.status}`,
      })
    }

    const body = yield* readBody(response)

    if (body === '') {
      return yield* new ProductNotFound({
        id,
        message: `no product has id ${id}`,
      })
    }

    return JSON.parse(body) as Product
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

The crash from the Effect model chapter is now a readable message. The error became a
named value, and the compiler checks that every name has a handler.

One unchecked assumption is left. `JSON.parse(body) as Product` asserts a shape
that nobody verified. Every field on `Product` is a promise this code cannot
keep. [Schemas and domain modeling](/learn/basic-effect/04-schemas) checks the
shape at runtime. The file also grows too long to stay as one file.
