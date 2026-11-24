---
title: Constructing and composing Effects
order: 2
slug: 02-composition
summary: Join the JSON parse to the fetch with pipe and with gen, then add a timeout and a retry to the same Effect, which a Promise cannot accept after it starts.
---

The previous chapter ended with a `Response`. The products are in its body, and
reading them is a second step that can fail on its own. This chapter joins the two steps into one Effect.

## Two steps that can each fail

Give the parse its own error class and its own function. Put both in
`index.ts`, and replace the `ApiError` block from the previous chapter.

```ts twoslash
// index.ts, replacing the ApiError class from chapter one
class ApiError extends Error {
  readonly _tag = 'ApiError'
}

class JsonError extends Error {
  readonly _tag = 'JsonError'
}
```

```ts twoslash
// index.ts
import { Effect } from 'effect'
class ApiError extends Error {
  readonly _tag = 'ApiError'
}
class JsonError extends Error {
  readonly _tag = 'JsonError'
}
// ---cut---
const request = Effect.tryPromise({
  try: () => fetch('https://fakestoreapi.com/products'),
  catch: () => new ApiError(),
})

const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: () => new JsonError(),
  })
```

`request` is an Effect. `readJson` is a function that returns an Effect. This
difference decides which operator joins them.

## flatMap for a step that returns an Effect

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
class ApiError extends Error {
  readonly _tag = 'ApiError'
}
class JsonError extends Error {
  readonly _tag = 'JsonError'
}
const request = Effect.tryPromise({
  try: () => fetch('https://fakestoreapi.com/products'),
  catch: () => new ApiError(),
})
const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: () => new JsonError(),
  })
// ---cut---
const listProducts = request.pipe(
//    ^?
  Effect.flatMap(readJson),
  Effect.map((json) => json as ReadonlyArray<Product>),
)
```

`Effect.map` changes the value inside an Effect. `Effect.flatMap` takes a
function that returns another Effect and joins the two into one. `pipe` stacks
the steps and reads from top to bottom.

Look at the error channel of `listProducts`. It shows `ApiError | JsonError`. Nobody wrote that union. The
compiler built it from the failures of both steps.

### The mistake

Use `map` where the function returns an Effect and you get this:

```ts twoslash
import { Effect } from 'effect'
class ApiError extends Error {
  readonly _tag = 'ApiError'
}
class JsonError extends Error {
  readonly _tag = 'JsonError'
}
const request = Effect.tryPromise({
  try: () => fetch('https://fakestoreapi.com/products'),
  catch: () => new ApiError(),
})
const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: () => new JsonError(),
  })
// ---cut---
const wrong = request.pipe(Effect.map(readJson))
//    ^?
```

This is an Effect that succeeds with another Effect. The inner Effect never
runs, so the request happens and the parse does not. Also, `JsonError` now sits
in the inner error channel, where no handler outside can reach it. The outer
type says the only possible failure is `ApiError`, and that is wrong.

This is the most common mistake in the course. You can spot it by the type
`Effect<Effect<...>>`. It means a `map` should have been a `flatMap`.

## The same steps with Effect.gen

`pipe` works well for two steps. At four steps it is harder to follow, and
every intermediate value needs a name inside a callback. `Effect.gen` is a
second syntax for the same composition.

```ts twoslash
// index.ts
import { Effect } from 'effect'
interface Product { id: number; title: string }
class ApiError extends Error {
  readonly _tag = 'ApiError'
}
class JsonError extends Error {
  readonly _tag = 'JsonError'
}
const request = Effect.tryPromise({
  try: () => fetch('https://fakestoreapi.com/products'),
  catch: () => new ApiError(),
})
const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: () => new JsonError(),
  })
// ---cut---
const listProducts = Effect.gen(function* () {
//    ^?
  const response = yield* request
  const json = yield* readJson(response)
  return json as ReadonlyArray<Product>
})
```

The type is identical. `yield*` takes the place of `await`, and it is where the
error channel collects the failures of each step. Use `gen` for a sequence of
steps that name their intermediate values. Use `pipe` to wrap one finished
Effect in one operator. This course uses both, and the next section uses
`pipe`.

## Add a timeout and a retry

`listProducts` has not run. It is a value that describes work, so you can add
rules to it later without changing the code inside it.

```ts twoslash
import { Effect } from 'effect'
interface Product { id: number; title: string }
class ApiError extends Error {
  readonly _tag = 'ApiError'
}
declare const listProducts: Effect.Effect<
  ReadonlyArray<Product>,
  ApiError,
  never
>
// ---cut---
const program = listProducts.pipe(
//    ^?
  Effect.timeout('2 seconds'),
  Effect.retry({ times: 3 }),
)
```

These two lines make a request that gives up after two seconds and is tried up
to three more times if it fails.

Check the type. `TimeoutError` joined the error union, because giving up after
two seconds is a new way to fail, and the type shows it without being asked.

`Effect.retry` takes options, and `{ times: 3 }` is the simplest one. The
`schedule` option takes a `Schedule`, which is a rule for when and how often to
retry. Use it when you want backoff, with growing waits between attempts,
instead of three immediate attempts.

Now try the same with the function from the previous chapter. You cannot. A
Promise is already running, so there is nothing left to wrap. To add a timeout,
you rewrite `fetchProduct` with an `AbortController`. To add a retry, you
rewrite it again with a loop. Both changes live inside the function, but the
call site is the code that knows which timeout and retry rules it needs.

## Where the file stands

```ts twoslash
// index.ts
import { Effect } from 'effect'

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

class ApiError extends Error {
  readonly _tag = 'ApiError'
}

class JsonError extends Error {
  readonly _tag = 'JsonError'
}

const request = Effect.tryPromise({
  try: () => fetch('https://fakestoreapi.com/products'),
  catch: () => new ApiError(),
})

const readJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: () => new JsonError(),
  })

const listProducts = Effect.gen(function* () {
  const response = yield* request
  const json = yield* readJson(response)
  return json as ReadonlyArray<Product>
})

const program = listProducts.pipe(
  Effect.timeout('2 seconds'),
  Effect.retry({ times: 3 }),
  Effect.map((products) => products.length),
)

Effect.runPromise(program).then(console.log)
```

```sh
20
```

The program prints the number of products, 20. It has a timeout and a retry,
and its error channel lists every way it can fail.

Two problems remain. First, `as ReadonlyArray<Product>` is the same unchecked
assertion the previous chapter criticised. It is still there, and it gives a
wrong type if the shape changes. Second, `ApiError` covers a dead network, a
500, and a missing product with one tag and no detail. With one tag and no detail, a caller cannot tell the three cases apart.

[Typed errors and recovery](/learn/basic-effect/03-typed-errors) fixes the
second problem. [Schemas and domain modeling](/learn/basic-effect/04-schemas)
fixes the first.
