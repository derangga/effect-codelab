---
title: The Effect model
order: 1
slug: 01-effect-model
summary: Why an Effect describes work instead of starting it, shown against a public API that answers 200 OK when a product does not exist.
---

This function reads one product from [fakestoreapi.com](https://fakestoreapi.com).
Save it as `index.ts`.

```ts twoslash
// index.ts
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

async function fetchProduct(id: number): Promise<Product> {
  const response = await fetch(`https://fakestoreapi.com/products/${id}`)
  const json = await response.json()
  return json as Product
}

fetchProduct(1).then((product) => console.log(product.title))
```

Run it and it prints the name of a backpack. The code looks ordinary, and
TypeScript reports no errors.

```sh
Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops
```

## What the Promise type does not tell you

`Promise<Product>` says the call returns a product. Ask for one that does not
exist by replacing the last line of `index.ts`:

```ts twoslash
interface Product { id: number; title: string }
declare function fetchProduct(id: number): Promise<Product>
// ---cut---
// index.ts, replacing the last line
fetchProduct(999).then((product) => console.log(product.title.toUpperCase()))
```

With Bun, you get:

```sh
TypeError: null is not an object (evaluating 'product.title')
```

With Node, you get:

```sh
SyntaxError: Unexpected end of JSON input
```

The code and the response are the same, but the two runtimes crash in different
ways. For a missing product, fakestoreapi sends
`200 OK`, a `content-type: application/json` header, and a body of zero bytes.
So `response.ok` is `true`. Then `response.json()` has nothing to parse. Each
runtime handles that in its own way. Bun returns `null`. Node throws.

The signature `Promise<Product>` says nothing about any of this. Four things
happen in this code that the type does not show:

- `fetch` rejects when the network is down.
- `response.json()` fails when the body is not JSON, including the empty body
  above.
- `as Product` is a type assertion. Nobody checked the data. `null` passed
  through it without complaint and caused an error on the next line.
- When you hold the `Promise`, the request is already in flight. You cannot
  inspect it, retry it, or decide not to send it.

The first three items are errors that the type hides. Effect, the library this
course teaches, changes the fourth item first. The rest follow from that.

## An Effect is a description of work

An Effect is a value that describes work to do. Nothing runs until you run it.
Calling a function that returns an Effect gives you that description. Running it
is a separate step that you take on purpose.

```ts twoslash
// index.ts
import { Effect } from 'effect'

class ApiError extends Error {
  readonly _tag = 'ApiError'
}

const fetchProduct = (id: number) =>
  Effect.tryPromise({
    try: () => fetch(`https://fakestoreapi.com/products/${id}`),
    catch: () => new ApiError(),
  })

const program = fetchProduct(999)

console.log('nothing has been requested yet')

Effect.runPromise(program).then((response) => {
  console.log('status', response.status)
})
```

`Effect.tryPromise` takes two functions. The first returns the Promise you would
have awaited. The second turns a rejection into an error value that you choose.
The result describes the request. It is not a request in flight.

```sh
nothing has been requested yet
status 200
```

The log prints before the request happens, because `fetchProduct(999)` sent
nothing. `Effect.runPromise` runs the Effect and sends the request. Delete it and
no request leaves your machine.

## The three channels of an Effect

The code below shows the type of `program`. Your editor shows it when you hover
over `program`.

```ts twoslash
import { Effect } from 'effect'
class ApiError extends Error {
  readonly _tag = 'ApiError'
}
const fetchProduct = (id: number) =>
  Effect.tryPromise({
    try: () => fetch(`https://fakestoreapi.com/products/${id}`),
    catch: () => new ApiError(),
  })
// ---cut---
const program = fetchProduct(999)
//    ^?
```

The type has three parameters. Read them from left to right:

```
        ┌─── the value it produces
        │         ┌─── how it can fail
        │         │         ┌─── what it needs before it can run
        ▼         ▼         ▼
Effect<Response, ApiError, never>
```

Each parameter is a channel, which means one of the three type slots of an
Effect:

- `Response` is the success type, the value the Effect produces.
- `ApiError` is the failure type. This slot is the error channel.
- `never` is the requirement type, what the Effect needs before it can run.
  This slot is the requirement channel.

`Promise<Product>` had one slot, for the success value. The error channel is the
slot that was missing. `ApiError` is in it because you told `tryPromise` what a
rejection becomes. It stays in the type until some code handles it, and the
compiler keeps showing it.

`never` means this Effect needs nothing from its surroundings to run. In
[Repository state, layers, and config](/learn/basic-effect/07-layers), that slot
stops being `never`.

## What this version still gets wrong

This version covers the request only. It does not parse the JSON, it has no
`Product` type, and `999` still comes back `200`. The `ApiError` class is a
placeholder. It has one tag, a fixed string that tells errors apart, and no
other detail.

The next three chapters fix these gaps. In
[Constructing and composing Effects](/learn/basic-effect/02-composition), you
combine the fetch with the parse and add a timeout and a retry. In
[Typed errors and recovery](/learn/basic-effect/03-typed-errors), you replace
`ApiError` with errors that say what went wrong, including the empty body. In
[Schemas and domain modeling](/learn/basic-effect/04-schemas), `as Product` goes
away.

You can add each of these cheaply because an Effect has not started yet. A
Promise has already started by the time you hold it.
