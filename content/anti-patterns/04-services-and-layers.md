---
title: Services and layers
order: 4
slug: 04-services-and-layers
summary: A service for something that is not a dependency, and a layer rebuilt on every call.
---

## A service for something that is not a dependency

From chapter seven. Once services click, everything looks like one.

```ts twoslash
import { Context, Effect } from 'effect'
// ---cut---
class Formatter extends Context.Service<Formatter, {
  currency(amount: number): Effect.Effect<string>
}>()('learning/Formatter') {}
```

Nothing in there needs swapping and nothing in there can fail. All this bought
you is `Formatter` in every `R` that touches money, plus a layer to provide in
every test.

It is a function. Write a function.

```ts twoslash
const currency = (amount: number) => `$${amount.toFixed(2)}`
```

Ask whether a test would rather not do this for real. Network, clock, database,
randomness, config, file system: yes. Formatting a number: no.

## Rebuilding the layer on every call

From chapter eight. This one is easy to write and hard to notice, because the
program is correct, only wasteful.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Api extends Context.Service<Api, { readonly n: Effect.Effect<number> }>()('learning/Api') {
  static readonly layer = Layer.succeed(Api)(Api.of({ n: Effect.succeed(1) }))
}
// ---cut---
const call = () => Effect.runPromise(Api.use((api) => api.n).pipe(Effect.provide(Api.layer)))
```

Layers are shared within one build, not across builds. I measured it: calling
that three times builds the service three times. If building it opens a
connection, reads config, or starts something, you now do that per call.

Build the layer once, at the top, and run against it. In this app that is the
`ManagedRuntime` the demo page keeps in a `useMemo`, rebuilt only when the
chosen layer actually changes.
