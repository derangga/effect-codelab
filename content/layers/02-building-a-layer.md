---
title: Building a layer
order: 2
slug: 02-building-a-layer
summary: Write src/config.ts, meet Layer.succeed, Layer.effect and Layer.effectDiscard, and read the three type parameters a layer carries.
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

## The config file

`src/database.ts` needs a url, and hardcoding it means editing code to point at
a different database. So the second file of the app reads two settings from the
environment. This is the first file in the project with a layer on it:

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

Two things are new since the `Database` declaration in chapter one.
`Context.Service` is now called with a `make`, which is the Effect that builds
the service, and the class holds a `static layer` built from it.

`Layer.effect` takes the service and the Effect that produces it. This is the
constructor you will write most.

The `static layer` is a convention rather than a rule, and it is worth adopting
before you have a reason to. The service and the knowledge of how to build it
live in the same file, so nothing outside has to learn the recipe. Later
chapters add dependencies to this layer and no caller changes.

`Config.Int` fails when the variable is present but not an integer, rather than
handing you `NaN`, and `Config.withDefault` makes `FEED_SIZE` optional. Put
both in `.env`:

```sh
DATABASE_URL=sqlite://feed.db
FEED_SIZE=20
```

## What the layer says about itself

Pull the layer out into a plain value for a moment and look at what its type
tells you:

```ts twoslash
// @filename: src/config.ts
import { Config, Context, Effect, Layer } from 'effect'
export class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {}
// ---cut---
// src/config.ts, the static layer written out longhand
const configLayer = Layer.effect(AppConfig, AppConfig.make)
//    ^?
```

`ConfigError` arrived in the middle slot without being asked for, and it is the
first useful thing a layer type has told us. `Config.String('DATABASE_URL')`
fails when the variable is missing, so building this layer can fail, so the
layer says so. Nothing has run yet, and TypeScript already knows your app has a
startup failure mode. [Layers that fail, layers that clean
up](/learn/layers/06-failure-and-cleanup) is about what to do with it.

## A value you already have

When there is nothing to build, say so. `Layer.succeed` wraps a value that
already exists. A fixed config is exactly that, so it goes in the same file
next to the real one:

```ts twoslash
// @filename: src/config.ts
import { Config, Context, Effect, Layer } from 'effect'
// ---cut---
// src/config.ts, a second layer on the same class
export class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)

  static readonly layerTest = Layer.succeed(this, {
    databaseUrl: 'memory://feed',
    feedSize: 3,
  })
}
```

```ts twoslash
// @filename: src/config.ts
import { Config, Context, Effect, Layer } from 'effect'
export class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
  static readonly layerTest = Layer.succeed(this, {
    databaseUrl: 'memory://feed',
    feedSize: 3,
  })
}
// ---cut---
// src/config.ts, what the test layer's type says
const fixed = AppConfig.layerTest
//    ^?
```

No failure and no requirement, because nothing is read and nothing is built.
Both layers provide the same `AppConfig`, so code that yields it never finds out
which one was supplied. That is the whole mechanism behind
[Swapping the graph](/learn/layers/08-swapping-the-graph), and it costs five
lines here.

`Layer.sync` is the same as `Layer.succeed` with the value computed lazily by a
function, which matters only when computing it is expensive or when you want it
deferred to build time rather than module load.

## Setup that provides nothing

Occasionally something has to happen at startup that is not a service. A
migration, a warm-up, a log line proving which build is running.
`Layer.effectDiscard` runs an effect and provides nothing, and the app's
`main.ts` gets one:

```ts twoslash
// @filename: src/main.ts
// ---cut---
// src/main.ts
import { Effect, Layer } from 'effect'

const banner = Layer.effectDiscard(Effect.log('feed service starting'))
//    ^?
```

`never` in the first slot, which reads correctly: it puts nothing into context.
It still composes with everything else, so merging it into the root layer runs
it at startup and it disappears from the type.

## A layer is a description

Writing `Layer.effect(AppConfig, AppConfig.make)` reads no environment
variables. It builds a description, the same way `Effect.gen` builds a
description. Nothing happens until something provides the layer, and it happens
once per build rather than once per file.

This is worth checking your intuition on, because the failure mode is quiet. If
you expect that line to throw on a missing `DATABASE_URL`, you will wrap it in a
try block, see nothing, and conclude the config is fine.

## What people get wrong

Using `Layer.succeed` for something that owns state or a resource. It is the
right tool for `layerTest` above, and it will be the wrong tool for the
`Database` that chapter three builds, because that one holds an open connection.

```ts twoslash
// @filename: src/database.ts
import { Context, Effect, Layer } from 'effect'
export interface Row {
  readonly id: string
  readonly title: string
}
export class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<Row>> }
>()('Database') {}
// ---cut---
// src/database.ts, the version chapter three does not write
let opened = false

export const databaseLayer = Layer.succeed(Database, {
  query: (sql) =>
    Effect.sync(() => {
      opened = true
      return [{ id: 'a1', title: sql }]
    }),
})
```

`Layer.succeed` takes an already built value, so `opened` was created once, when
this module loaded, and every provision of `databaseLayer` shares it. Two tests
providing this layer see each other's state, and the failures look like
flakiness rather than like the shared variable they are.

`Layer.effect` gives each build its own, because `make` runs again every time it
is built. Reach for `Layer.succeed` when the value is a constant or a stub that
remembers nothing, and `Layer.effect` for everything else.

## Next

`AppConfig` has an empty `RIn`, so it is ready to run. The `Database` that needs
it is not, and closing that gap is what `Layer.provide` does.
[Providing, and where the requirement goes](/learn/layers/03-providing) rewrites
`src/database.ts` and follows a single requirement as it moves.
