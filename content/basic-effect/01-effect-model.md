---
title: The Effect model
order: 1
slug: 01-effect-model
summary: Why an Effect is a description of work rather than work already underway, shown against a public API that answers a missing product with a 404 the function never looks at.
---

Here is an ordinary function that reads one product from
[mockstore-api.rangga.site](https://mockstore-api.rangga.site). Put it in `index.ts`.

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
  const response = await fetch(`https://mockstore-api.rangga.site/products/${id}`)
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
TypeError: undefined is not an object (evaluating 'product.title.toUpperCase')
```

Under node:

```sh
TypeError: Cannot read properties of undefined (reading 'toUpperCase')
```

The wording differs and the crash is the same. The server did answer, and it
answered honestly: `404`, and a JSON body of
`{"_tag":"ProductNotFound","productId":999,"message":"product 999 not found"}`.
`fetch` resolves on a 404, because a 404 is a response and only a missing
network is a failure. `response.json()` parses that body without complaint.
`as Product` then tells the compiler it is a product. `product.title` is
`undefined`, and the program falls over one line after the mistake and a long
way from its cause.

Read the signature again. `Promise<Product>` mentions none of this.

Four things are happening in those five lines that the type does not say:

- `fetch` rejects when the network is gone, and nothing in `Promise<Product>`
  says so.
- `fetch` does not reject on a 404 or a 500. `response.status` is the only
  signal, and nothing forces you to read it. The same goes for
  `response.json()`, which rejects on a body that is not JSON. This API's `400`
  for `/products/abc` has zero bytes.
- `as Product` is an assertion. Nobody checked. The error body passed through
  it without complaint and only became a problem one line later.
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
    try: () => fetch(`https://mockstore-api.rangga.site/products/${id}`),
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
status 404
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
    try: () => fetch(`https://mockstore-api.rangga.site/products/${id}`),
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
no JSON yet, no `Product`, and `999` still comes back as an ordinary `Response`
with status `404`. The `ApiError`
class is a placeholder with one tag and no detail.

Three things are missing, and they are the next three chapters. Chapter two
composes the parse onto the fetch and adds the timeout and the retry that a
network call should have had from the start. Chapter three replaces `ApiError`
with errors that say which thing went wrong, including the 404 you saw
above. Chapter four is where `as Product` finally goes away.

The order matters. Every one of them is a thing you can only add cheaply
because the work is a value sitting still, rather than a Promise that already
left.
