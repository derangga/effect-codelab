---
title: Services and layers
order: 4
slug: 04-services-and-layers
summary: A service for something that is not a dependency, a bare key used for logic you build yourself, and a layer rebuilt on every call.
---

## A service for something that is not a dependency

From [Services with Context.Service](/learn/basic-effect/06-services), and
[Design the product service](/learn/basic-effect/05-design) has the short
version. Once services click, everything looks like one.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
// ---cut---
class Formatter extends Context.Service<Formatter>()('Formatter', {
  make: Effect.succeed({
    currency: (amount: number) => Effect.succeed(`$${amount.toFixed(2)}`),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

Count what that bought. A `make`, a layer, a static to hang it on, `Formatter`
in every `R` that touches money, and a layer to provide in every test that
renders a price. Nothing in there needs swapping and nothing in there can fail.

It is a function. Write a function.

```ts twoslash
const currency = (amount: number) => `$${amount.toFixed(2)}`
```

Ask whether a test would rather not do this for real. Network, clock, database,
randomness, config, file system: yes. Formatting a number: no.

## The bare key, used for logic you build yourself

`Context.Service` has a second form that declares the shape and stops there,
with no `make`.

```ts twoslash
import { Context, Effect } from 'effect'
interface Product {
  readonly id: string
}
// ---cut---
class ProductRepository extends Context.Service<
  ProductRepository,
  { readonly list: () => Effect.Effect<ReadonlyArray<Product>> }
>()('ProductRepository') {}
```

That is the right tool in three places: a snippet that only needs the shape, a
static test double, and infrastructure handed to you at runtime rather than
constructed, such as a worker binding.

It is the wrong tool for anything you build yourself. Without a `make` there is
no single home for the construction, so every caller assembles the
implementation and provides it, and the day the repository starts needing a
config value, every one of those call sites has to learn about it. Give it a
`make` and a `static layer`, as the `Formatter` above does, and the wiring
lives in one place.

## Rebuilding the layer on every call

From [Repository state, layers, and config](/learn/basic-effect/07-layers).
This one is easy to write and hard to notice, because the program is correct,
only wasteful.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Api extends Context.Service<
  Api,
  { readonly fetchCount: () => Effect.Effect<number> }
>()('Api') {
  static readonly layer: Layer.Layer<Api> = Layer.succeed(this, {
    fetchCount: () => Effect.succeed(1),
  })
}
// ---cut---
const program = Effect.gen(function* () {
  const api = yield* Api
  return yield* api.fetchCount()
})

const call = () => Effect.runPromise(program.pipe(Effect.provide(Api.layer)))
```

Layers are shared within one build, not across builds. I measured it: calling
that three times builds the service three times. If building it opens a
connection, reads config, or starts something, you now do that per call. A
service holding a `Ref` is worse than wasteful, because each call gets its own
state and nothing accumulates.

Build the layer once, at the top, and run against it. In this app that is the
`ManagedRuntime` the demo page keeps in a `useMemo`, rebuilt only when the
chosen layer actually changes.
