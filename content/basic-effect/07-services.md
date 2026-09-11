---
title: Services
order: 7
slug: 07-services
summary: The R channel, and why the things your code depends on should be in the type instead of hidden inside it.
---

Six chapters in, `R` has been `never` in every single type. This chapter is
where it stops being `never`.

Start with a function that has a problem.

```ts twoslash
import { Effect } from 'effect'

const loadProducts = Effect.tryPromise({
  try: () => fetch('https://fakestoreapi.com/products').then((r) => r.json()),
  catch: () => 'RequestFailed' as const,
})
```

Nothing here is wrong exactly, but two decisions got buried inside it. The URL
is fixed, and the way of making requests is fixed. To test this you need a real
server or a global `fetch` you have monkeypatched. To point it at staging you
edit the function.

The usual fix is to pass things in.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
const loadProducts = (baseUrl: string, http: typeof fetch) =>
  Effect.tryPromise({
    try: () => http(`${baseUrl}/products`).then((r) => r.json()),
    catch: () => 'RequestFailed' as const,
  })
```

That works, and it stops working the moment `loadProducts` is called four
levels deep. Every function in between has to accept `baseUrl` and `http` and
pass them along, without using either. Anyone who has threaded a database
handle through a call stack knows the shape of this.

`R` is the third way. Say what you need, do not say where it comes from, and
let the compiler keep the list.

## Defining a service

A **service** is a named bundle of functions that your program can ask for by
name. Define one with `Context.Service`.

```ts twoslash
import { Context, Effect } from 'effect'

class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
```

Three parts, and only the middle one is interesting.

The class name appears twice for the same reason it did with
`Schema.TaggedError`: TypeScript cannot refer to a class from inside its own
definition without help.

The second type parameter is the shape, and it is the actual content. It is the
promise this service makes, written as ordinary types. Anyone reading it knows
what they can call and what can go wrong, without opening the implementation.

The string is a unique identifier. Use something path shaped like
`learning/Products` so two services in different files never collide.

Notice what is missing: there is no implementation here at all. That is
deliberate, and it is the whole trick.

## Using it, and watching R appear

```ts twoslash
import { Context, Effect } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const titles = Effect.gen(function* () {
  const products = yield* Products
  const list = yield* products.list

  return list.length
})
```

`yield* Products` asks for the service. Now look at what that did to the type.

```ts twoslash
import { Context, Effect } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const titles: Effect.Effect<number, 'RequestFailed', Products> = Effect.gen(
  function* () {
    const products = yield* Products
    const list = yield* products.list

    return list.length
  },
)
```

`Products` is in the third slot. That annotation is compiled when this page
builds, so it is not a claim, it is checked.

Read `R` as a shopping list. This Effect needs a `Products` to run. It does not
know which one, and it does not care.

The list combines on its own, the same way `E` did. Use two services and both
appear.

```ts twoslash
import { Context, Effect } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
class Logger extends Context.Service<Logger, {
  info(message: string): Effect.Effect<void>
}>()('learning/Logger') {}
// ---cut---
const report: Effect.Effect<void, 'RequestFailed', Products | Logger> =
  Effect.gen(function* () {
    const products = yield* Products
    const logger = yield* Logger

    const list = yield* products.list
    yield* logger.info(`got ${list.length}`)
  })
```

Nobody wrote `Products | Logger` by hand. The compiler assembled it by watching
which services were asked for, in the same way it assembled the error union.

There is a shorter form when you only need one call.

```ts twoslash
import { Context, Effect } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const list = Products.use((products) => products.list)
//    ^?
```

`use` reaches for the service and calls one thing on it. Same result, less
ceremony.

## The requirement is enforced

Here is the part that makes `R` more than documentation. Try to run an Effect
that still needs something.

```ts twoslash
// @errors: 2345
import { Context, Effect } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const list = Products.use((products) => products.list)

Effect.runSync(list)
```

The run functions only accept an Effect whose `R` is `never`. A program with
outstanding requirements will not start, and you find that out at the keyboard
rather than at runtime.

This is the same bargain as chapter five. Failures stay in `E` until somebody
handles them, and requirements stay in `R` until somebody provides them.

## Writing an implementation

Implementations are attached as a **layer**, which is a recipe for building the
service. Chapter eight is about layers properly. For now, one example, so the
service is not just an idea.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
// ---cut---
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {
  static readonly layer = Layer.effect(
    Products,
    Effect.gen(function* () {
      const list = Effect.tryPromise({
        try: () =>
          fetch('https://fakestoreapi.com/products').then(
            (r) => r.json() as Promise<Array<string>>,
          ),
        catch: () => 'RequestFailed' as const,
      })

      return Products.of({ list })
    }),
  )
}
```

`Layer.effect` says: to build a `Products`, run this Effect. The Effect returns
`Products.of({ ... })`, which is an object matching the shape you declared. If
it does not match, the build fails here rather than at the call site.

Building it inside `Effect.gen` looks like extra work for this example, and it
pays off the moment the service needs something itself, such as a config value
or another service. That is chapter eight.

## The payoff is the second implementation

A service with one implementation is just an indirection. The point is that
nothing above depends on which one you get.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const TestProducts = Layer.succeed(Products)(
  Products.of({ list: Effect.succeed(['Backpack', 'Laptop']) }),
)
```

`Layer.succeed` is for when the service needs no setup, just a value.

Every function that asks for `Products` now works against this one, unchanged.
No mocking library, no patching of globals, no interception of `fetch`. The
test picks a different layer, and the code under test cannot tell.

That is what `R` buys, and it is why the third slot was worth carrying around
for six chapters.

## What not to make a service

Not everything belongs here. Pure functions do not: a service that formats a
date is a function wearing a costume.

Reach for a service when there is something behind it that a test would rather
not do for real. Network, clock, database, random numbers, config, file system.
If swapping the implementation is not something anyone will ever want, a plain
function is the lazier and better answer.

## Next

Chapter eight is about the other half: `Layer`, how implementations get built
and composed, and how `R` goes from a list of requirements back to `never` so
the program can actually run. It also covers `Config`, and the honest story
about `.env` files in a browser app.
