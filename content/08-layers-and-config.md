---
title: Layers and Config
order: 8
slug: 08-layers-and-config
summary: Building implementations, wiring them together so R goes back to never, and reading configuration without touching process.env.
---

Chapter seven left a program that cannot run. It needs a `Products`, the
compiler knows it, and the run functions refuse to start until somebody hands
one over.

This chapter is the handing over.

## A layer is a recipe

A **layer** is a recipe for building a service. Not the service itself, a
description of how to make one, which is the same lazy idea as an Effect.

Two ways to write one, and you pick based on whether building it takes any
work.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const TestProducts = Layer.succeed(Products)(
  Products.of({ list: Effect.succeed(['Backpack']) }),
)
```

`Layer.succeed` takes a value you already have. Nothing to run, nothing to
fail, nothing to clean up. Test doubles are usually this.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const LiveProducts = Layer.effect(
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
```

`Layer.effect` takes an Effect that produces the service. That Effect is where
setup goes: reading config, opening a connection, asking for another service.

The body runs once, when the layer is built, not on every call. Anything you
compute there, such as a base URL, is computed once and closed over by the
functions you return.

## Providing, and watching R disappear

`Effect.provide` feeds a layer into a program.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
const TestProducts = Layer.succeed(Products)(
  Products.of({ list: Effect.succeed(['Backpack']) }),
)
// ---cut---
const needsProducts = Products.use((products) => products.list)
//    ^?

const runnable = Effect.provide(needsProducts, TestProducts)
//    ^?
```

Compare the two. `Products` was in the third slot, and now the third slot is
`never`. The requirement was met, so it left the type, and this program will
run.

That is the whole loop. Asking for a service puts it in `R`, providing a layer
takes it out, and in between the compiler will not let you forget.

## Layers need things too

Real services depend on other services. A layer says so the same way a program
does, and the dependency shows up in its own type.

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
class Clock extends Context.Service<Clock, {
  readonly now: Effect.Effect<number>
}>()('learning/Clock') {}
// ---cut---
const LiveProducts = Layer.effect(
  Products,
  Effect.gen(function* () {
    const clock = yield* Clock
    const started = yield* clock.now

    return Products.of({
      list: Effect.succeed([`built at ${started}`]),
    })
  }),
)
```

This layer builds a `Products`, and it needs a `Clock` to do it. `Layer.provide`
is how you satisfy that, and it is the layer level version of `Effect.provide`.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
class Clock extends Context.Service<Clock, {
  readonly now: Effect.Effect<number>
}>()('learning/Clock') {}
declare const LiveProducts: Layer.Layer<Products, never, Clock>
declare const LiveClock: Layer.Layer<Clock>
// ---cut---
const AppLayer: Layer.Layer<Products> = LiveProducts.pipe(
  Layer.provide(LiveClock),
)
```

Read the result: it provides `Products`, needs nothing, and `Clock` is gone
from the outside. The clock became an internal detail of building products,
which is usually what you want. Whoever uses `AppLayer` does not need to know a
clock was involved.

If you want the clock available to the rest of the program as well, use
`Layer.provideMerge` instead, which keeps both. The rule of thumb: `provide`
hides the dependency, `provideMerge` passes it along.

Merge independent layers with `Layer.mergeAll`.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>>
}>()('learning/Products') {}
class Users extends Context.Service<Users, {
  readonly list: Effect.Effect<Array<string>>
}>()('learning/Users') {}
declare const LiveProducts: Layer.Layer<Products>
declare const LiveUsers: Layer.Layer<Users>
// ---cut---
const AppLayer: Layer.Layer<Products | Users> = Layer.mergeAll(
  LiveProducts,
  LiveUsers,
)
```

One thing worth knowing before you worry about it: if two layers both need a
third, that third one is built once and shared, not built twice. Wiring a
diamond shaped dependency graph does not open two database connections.

## Config, and where values come from

Hard coding a URL inside a layer is better than hard coding it inside a
function, and it is still hard coding. `Config` is how a value gets read
instead of written.

```ts twoslash
import { Config, Effect } from 'effect'
// ---cut---
const baseUrl = Config.String('VITE_API_BASE_URL')
//    ^?
```

Look closely at that type. A `Config` **is** an Effect. You do not run it
specially, you `yield*` it like anything else, and if the value is missing or
the wrong shape it fails with `ConfigError` in the `E` channel, exactly like
every other failure in this course.

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class Products extends Context.Service<Products, {
  readonly list: Effect.Effect<Array<string>, 'RequestFailed'>
}>()('learning/Products') {}
// ---cut---
const LiveProducts = Layer.effect(
  Products,
  Effect.gen(function* () {
    const baseUrl = yield* Config.String('VITE_API_BASE_URL')

    return Products.of({
      list: Effect.tryPromise({
        try: () =>
          fetch(`${baseUrl}/products`).then(
            (r) => r.json() as Promise<Array<string>>,
          ),
        catch: () => 'RequestFailed' as const,
      }),
    })
  }),
)
```

The read happens once, at build time, and a missing value stops the layer from
being built at all. That is better than discovering it on the first request at
three in the morning.

Where does the value come from? A `ConfigProvider`, which is a service with a
default. On a server the default reads `process.env`, so nothing extra is
needed.

## The browser problem

In a Vite single page app there is no `process.env`. It does not exist in a
browser, so the default provider has nothing to read.

Vite exposes variables prefixed with `VITE_` on `import.meta.env` instead. So
build a provider over that object and install it as a layer.

```ts twoslash
import { ConfigProvider } from 'effect'
// ---cut---
const BrowserConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown(import.meta.env),
)
```

That is the whole adapter. `fromUnknown` builds a provider over a plain object,
and `ConfigProvider.layer` installs it, replacing the default. Provide it once
at the top and every `Config.String` below reads from it.

Nothing else in your code changes. The service still asks for
`VITE_API_BASE_URL` and does not know whether it came from an environment
variable, a JSON file, or a hard coded object in a test. That is the point of
the indirection, and it is why the test in the next chapter can point the same
service at a different host without touching it.

## Say the honest thing about .env

Here is where a lot of writing on this topic quietly misleads people, so read
this part twice.

Putting a value in `.env` as `VITE_API_BASE_URL` does not hide it. Vite
replaces `import.meta.env.VITE_API_BASE_URL` with the literal string when it
builds, and that string is sitting in the JavaScript bundle the browser
downloads. Anyone can open devtools and read it, and no amount of tooling
around it changes that.

So be clear about what you get:

- **You do get** one place to change the value, different values for
  development and production, a failure at build time if it is missing, and
  code that does not care where it came from.
- **You do not get** secrecy. Not a little bit of it.

An API key that must stay private cannot live in a browser app at all, in any
framework, under any name. It lives on a server you control, and the browser
calls that server. If a value would cause damage when read by a stranger, it
does not belong in front end code.

The base URL in the next chapter is fine to ship, because it is a public
address anyone could find by watching one network request.

## Next

Chapter nine puts all eight chapters together: a real service that fetches
products over the network, reads its base URL from config, decodes the response
with a schema, names every failure it can produce, and retries the ones worth
retrying. There is a live page to go with it where you can break the call on
purpose and watch each branch fire.
