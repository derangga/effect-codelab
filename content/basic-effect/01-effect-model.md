---
title: The Effect model
order: 1
slug: 01-effect-model
summary: Why an Effect is a description of work rather than work already underway, shown against a public API that answers 200 OK when the product does not exist.
---

Here is an ordinary function that reads one product from
[fakestoreapi.com](https://fakestoreapi.com). Put it in `index.ts`.

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

Run it and it prints a backpack. Nothing about it is unusual, and nothing about
it is wrong in the sense your editor can see.

```sh
Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops
```

## The signature is a claim, not a guarantee

`Promise<Product>` says you get a product. Ask for one that does not exist and
watch what you get instead. Change the last two lines:

```ts twoslash
interface Product { id: number; title: string }
declare function fetchProduct(id: number): Promise<Product>
// ---cut---
// index.ts, replacing the last line
fetchProduct(999).then((product) => console.log(product.title.toUpperCase()))
```

Under bun:

```sh
TypeError: null is not an object (evaluating 'product.title')
```

Under node:

```sh
SyntaxError: Unexpected end of JSON input
```

Same code, same response, two different crashes. The response itself is the
reason. fakestoreapi answers a missing product with `200 OK`, a
`content-type: application/json` header, and a body of zero bytes. `response.ok`
is `true`. Then `response.json()` has nothing to parse, and what it does about
that is a decision each runtime makes on its own. Bun hands you `null`. Node
throws.

Read the signature again. `Promise<Product>` mentions none of this.

Four things are happening in those five lines that the type does not say:

- `fetch` rejects when the network is gone, and nothing in `Promise<Product>`
  says so.
- `response.json()` fails on a body that is not JSON, including the empty one
  above.
- `as Product` is an assertion. Nobody checked. `null` passed through it
  without complaint and only became a problem one line later.
- By the time you hold the `Promise`, the request is already in flight. You
  cannot inspect it, retry it, or decide not to send it. It went the moment you
  called.

The first three are about errors going missing. The fourth is the one Effect
changes first, and the rest follow from it.

## A value that describes work

Calling a function gives you a description of the work. Running it is a
separate step you take on purpose.

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

`Effect.tryPromise` takes the Promise you would have awaited and the function
that turns a rejection into a value you chose. What comes back is not a request
in flight. It is a description of one.

```sh
nothing has been requested yet
status 200
```

The log prints before the request happens, and it prints because
`fetchProduct(999)` did nothing. `Effect.runPromise` is the line that sends it.
Delete that line and no traffic leaves your machine.

## Three channels

Hover `program` and read what it says about itself.

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

Three parameters, read left to right:

```
        ┌─── the value it produces
        │         ┌─── how it can fail
        │         │         ┌─── what it needs before it can run
        ▼         ▼         ▼
Effect<Response, ApiError, never>
```

`Promise<Product>` had one slot and used it to make a claim. This has three,
and the middle one is the one that was missing. `ApiError` is in the type
because `tryPromise` was told what a rejection becomes. It will stay in the
type until something handles it, and the compiler will keep bringing it up.

`never` in the third slot means this needs nothing from its surroundings to
run. Chapter seven is where that stops being `never`.

## What this version still gets wrong

It is honest about the request and silent about everything after it. There is
no JSON yet, no `Product`, and `999` still comes back `200`. The `ApiError`
class is a placeholder with one tag and no detail.

Three things are missing, and they are the next three chapters. Chapter two
composes the parse onto the fetch and adds the timeout and the retry that a
network call should have had from the start. Chapter three replaces `ApiError`
with errors that say which thing went wrong, including the empty body you saw
above. Chapter four is where `as Product` finally goes away.

The order matters. Every one of them is a thing you can only add cheaply
because the work is a value sitting still, rather than a Promise that already
left.
