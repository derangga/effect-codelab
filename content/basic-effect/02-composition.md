---
title: Constructing and composing Effects
order: 2
slug: 02-composition
summary: Chain the JSON parse onto the fetch with pipe and with gen, then wrap a timeout and a retry around the same value, which is the thing a Promise cannot be given after the fact.
---

Chapter one left you holding a `Response`. The products are in its body, and
getting them out is a second piece of work that can fail on its own. So the
question is how two Effects become one.

## Two failures, one value

Give the parse its own error and its own function. Both of these go in
`index.ts`, replacing the `ApiError` block from chapter one.

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

`request` is an Effect. `readJson` is a function that returns one. That
difference decides which operator joins them.

## flatMap, because the second step is itself an Effect

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

`Effect.map` transforms the value inside. `Effect.flatMap` takes a function
that returns another Effect and joins the two into one. `pipe` is how you stack
them, reading top to bottom.

Look at the error channel. It says `ApiError | JsonError`. Nobody wrote that
union. It is the sum of what the two steps can do, and it grew by itself when
the second step joined.

### The mistake

Reach for `map` where the function returns an Effect and you get this:

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

An Effect that succeeds with another Effect. The inner one never runs, so the
request happens and the parse does not. Worse, `JsonError` is now in the inner
error channel, where no handler on the outside can reach it. The outer type
claims the only thing that can go wrong is `ApiError`, and it is wrong.

This is the most common mistake in the whole course, and the tell is always the
same. An `Effect<Effect<...>>` in a hover means a `map` that should have been a
`flatMap`.

## The same thing, written as a generator

`pipe` is fine for two steps. At four it starts reading backwards from how you
think about it, and every intermediate value needs a name inside a callback.
`Effect.gen` is the other syntax for the same composition.

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

Identical type. `yield*` is what `await` would have been, and it is where the
error channel gets collected. The rule for choosing is short. Sequences of
steps that name their intermediate values read better as `gen`. Wrapping one
finished Effect in one operator reads better as `pipe`. This course uses both,
and the next section is a `pipe`.

## What the description buys you

Here is the part that is hard to get any other way. `listProducts` has not run.
It is a value. So you can wrap policy around it after the fact, without
touching the code that describes the work.

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

Two lines. A request that gives up after two seconds and is tried up to three
more times if it fails.

Notice what happened to the type. `TimeoutError` joined the union, because
giving up after two seconds is a new way for this to fail and the type says so
without being asked. `Effect.retry` takes options, and `{ times: 3 }` is the
simplest of them. A `schedule` option takes a `Schedule` when you want backoff
rather than three immediate attempts.

Now write the same thing with the function from chapter one. You cannot. A
Promise is already running, so there is nothing left to wrap. Adding a timeout
means rewriting `fetchProduct` with an `AbortController`, and adding a retry
means rewriting it again with a loop, and both of those live inside the
function rather than at the call site that actually knows what the policy
should be.

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

Twenty products, with a timeout and a retry, and the error channel listing
every way it can go wrong.

Two things are still wrong with it. `as ReadonlyArray<Product>` is the same
unchecked assertion chapter one complained about, still there, still lying if
the shape changes. And `ApiError` covers a dead network, a 500, and a missing
product with one tag and no detail, which means a caller cannot tell them
apart. Chapter three fixes the second. Chapter four fixes the first.
