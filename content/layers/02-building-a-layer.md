---
title: Building a layer
order: 2
slug: 02-building-a-layer
summary: Layer.succeed, Layer.sync, Layer.effect and Layer.effectDiscard, and how to read the three type parameters a layer carries.
---

The previous chapter ended on a construction that `Effect.provideService` would
not accept, because building a database connection is work and `provideService`
wants a finished value. A layer is the type that holds the work.

## Three parameters, and you know two of them

A layer is written `Layer<ROut, E, RIn>`, and it lines up with `Effect<A, E, R>`
almost exactly:

| Layer | Effect | Meaning |
| --- | --- | --- |
| `ROut` | `A` | what it puts into context when it is built |
| `E` | `E` | how building it can fail |
| `RIn` | `R` | what has to already be in context for it to build |

The one difference is the first slot. An Effect produces a value you use; a
layer produces a service other code can ask for by name. Everything else reads
the same way, including the rule that a full `RIn` means it is not ready to run
yet.

Say that out loud for a moment, because it is the sentence the rest of the
track hangs on. `Layer<Database, ConfigError, AppConfig>` is "give me an
`AppConfig` and I will try to produce a `Database`, and I might fail with a
`ConfigError` while I do".

## A value you already have

When there is nothing to build, say so. `Layer.succeed` wraps a value that
already exists.

```ts twoslash
import { Context, Effect, Layer } from 'effect'

class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (name: string) => string }
>()('Greeter') {}

const greeterLayer = Layer.succeed(Greeter, { greet: (name) => `hello ${name}` })
//    ^?
```

No failure, no requirement. `Layer.sync` is the same with the value computed
lazily by a function, which matters only if computing it is expensive or if you
want it deferred to build time rather than module load.

## Construction that is an effect

`Layer.effect` takes the service and the Effect that produces it. This is the
one you will write most.

Here is the first real file in the app. `AppConfig` reads two settings out of
the environment:

```ts twoslash
// src/config.ts
import { Config, Context, Effect, Layer } from 'effect'

export class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

Two things changed from the `Greeter` above. `Context.Service` is now called
with a `make`, which is the Effect that builds the service, and the class holds
a `static layer` built from it.

That second one is a convention rather than a rule, and it is worth adopting
before you have a reason to. The service and the knowledge of how to build it
live in the same file, so nothing outside has to learn the recipe. Later
chapters add dependencies to this layer and no caller changes.

Pull the layer out into a plain value and look at what it says:

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {}
// ---cut---
const configLayer = Layer.effect(AppConfig, AppConfig.make)
//    ^?
```

`ConfigError` arrived in the middle slot without being asked for, and it is the
first useful thing a layer type has told us. `Config.String('DATABASE_URL')`
fails when the variable is missing, so building this layer can fail, so the
layer says so. Nothing runs yet, and TypeScript already knows your app has a
startup failure mode. [Layers that fail, layers that clean
up](/learn/layers/06-failure-and-cleanup) is about what to do with it.

`Config.Int` fails when the variable is present but not an integer, rather than
handing you `NaN`, and `Config.withDefault` makes `FEED_SIZE` optional.

## Setup that provides nothing

Occasionally something has to happen at startup that is not a service. A
migration, a warm-up, a log line proving which build is running.
`Layer.effectDiscard` runs an effect and provides nothing:

```ts twoslash
import { Effect, Layer } from 'effect'
// ---cut---
const banner = Layer.effectDiscard(Effect.log('feed service starting'))
//    ^?
```

`never` in the first slot, which reads correctly: it puts nothing into context.
It still composes with everything else, so merging it into your root layer runs
it at startup and it disappears from the type.

## A layer is a description

Writing `Layer.effect(AppConfig, AppConfig.make)` reads no environment
variables. It builds a description, the same way `Effect.gen` builds a
description. Nothing happens until something provides the layer, and it happens
once per build rather than once per file.

This is worth checking your intuition on, because the failure mode is quiet. If
you expect the line above to throw on a missing `DATABASE_URL`, you will put it
in a try block, see nothing, and conclude the config is fine.

## What people get wrong

Using `Layer.succeed` for something that owns state or a resource.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Counter extends Context.Service<
  Counter,
  { readonly next: () => Effect.Effect<number> }
>()('Counter') {}
// ---cut---
let count = 0
const counterLayer = Layer.succeed(Counter, {
  next: () => Effect.sync(() => (count += 1)),
})
```

`Layer.succeed` takes an already built value, so `count` was created once, when
this module loaded, and every provision of `counterLayer` shares it. Two tests
providing this layer see each other's numbers, and the failures look like
flakiness rather than like the shared variable they are.

`Layer.effect` gives each build its own, because `make` runs again each time:

```ts twoslash
import { Context, Effect, Layer, Ref } from 'effect'
class Counter extends Context.Service<
  Counter,
  { readonly next: () => Effect.Effect<number> }
>()('Counter') {}
// ---cut---
const counterLayer = Layer.effect(
  Counter,
  Effect.gen(function* () {
    const count = yield* Ref.make(0)
    return { next: () => Ref.updateAndGet(count, (n) => n + 1) }
  }),
)
```

Reach for `Layer.succeed` when the value is a constant or a stub that remembers
nothing. Reach for `Layer.effect` for everything else.

## Next

`AppConfig` has an empty `RIn`, so it is ready to run. The `Database` that
needs it is not, and closing that gap is what `Layer.provide` does.
[Providing, and where the requirement goes](/learn/layers/03-providing) follows
a single requirement as it moves.
