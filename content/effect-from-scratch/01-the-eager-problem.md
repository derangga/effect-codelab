---
title: The eager problem
order: 1
slug: 01-the-eager-problem
summary: A function call does its work the moment you write it, so you cannot retry, time or skip it without editing the function itself.
---

Here is a function that loads a product. The network is faked so you can run it
anywhere, and it logs every request so you can see when one happens.

```ts twoslash
// index.ts
let requests = 0

async function fetchProduct(id: number): Promise<{ id: number; title: string }> {
  requests++
  console.log(`GET /products/${id}`)
  return { id, title: `product ${id}` }
}

const product = fetchProduct(1)
console.log('requests so far:', requests)
```

Run it with `bun index.ts`.

```sh
GET /products/1
requests so far: 1
```

Nobody awaited anything, and the request already went out. Calling the function
was the request.

## A call is a cooked meal

That is the normal contract of a function. You call it, it does the work, you
get the result. The call and the work are one step, which makes the result a
cooked meal. It is done, and nothing you do afterwards can change how it was
made.

Most of the time that is what you want. It stops being what you want the moment
you need to do something to the work itself. Say the request is flaky and you
want three tries. The natural first attempt is a helper that takes the call:

```ts
const product = await withRetry(3, fetchProduct(1))
```

This cannot work, and the reason is the whole track. By the time `withRetry`
runs, `fetchProduct(1)` has already been evaluated. The helper receives the
result, a Promise that has already started, and the only thing it can do with
it is wait. If that Promise rejects, retrying means awaiting the same rejected
Promise again.

The helper has to receive the work, not the result. That means a function:

```ts twoslash
// index.ts
async function fetchProduct(id: number): Promise<{ id: number; title: string }> {
  return { id, title: `product ${id}` }
}
// ---cut---
async function withRetry<A>(times: number, run: () => Promise<A>): Promise<A> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt >= times) throw error
    }
  }
}

const a = withRetry(3, () => fetchProduct(1))
const b = withRetry(3, () => fetchProduct(2))
const c = withRetry(3, () => fetchProduct(3))
```

It works, and it costs you something. Every call site has to wrap its call in
an arrow function, and nothing in `fetchProduct` says it is safe to retry. Want
a timeout as well? That is a second wrapper at the same three call sites.

## A recipe is a function you have not called

Move the arrow function into `fetchProduct` itself, so it returns the work
instead of doing it.

```ts twoslash
// index.ts
let requests = 0

const fetchProduct = (id: number) => async () => {
  requests++
  console.log(`GET /products/${id}`)
  return { id, title: `product ${id}` }
}

const recipe = fetchProduct(1)
console.log('requests so far:', requests)

recipe().then((product) => console.log('requests so far:', requests, product.title))
```

```sh
requests so far: 0
GET /products/1
requests so far: 1 product 1
```

`fetchProduct(1)` now gives back a recipe. Nothing ran, and `requests` is still
zero. The request goes out on the line `recipe()`, and not before.

A recipe can be doubled, retried, timed or never cooked. It can be handed to a
helper and the helper decides when, how often and whether to run it. That is
the property the rest of this track builds on, and it needs no library, only a
function that has not been called.

From here on a function you have not called yet is called an **effect**. It is
a value that holds work instead of doing it.

## The part people get wrong

`async` does not make anything lazy. An `async` function returns a Promise, and
the body starts running the moment you call it, up to its first `await`. The
first example in this chapter is `async` and fired its request on the spot.

A Promise is a meal that is still cooking, not a recipe. Laziness comes from
the extra function in front, the `() =>` that waits to be called.

## Try it

A module has this line at the top level, so importing the module prints a
message:

```ts
console.log('loaded the product module')
```

Change it so that importing the module prints nothing, and the message appears
only when a caller asks for it. The answer is the same move this chapter made:
put the work inside a function and let the caller decide when to call it.

[A value that holds work](/learn/effect-from-scratch/02-a-value-that-holds-work)
turns that function into a named type and starts `mini-effect.ts`.
