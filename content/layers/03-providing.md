---
title: Providing, and where the requirement goes
order: 3
slug: 03-providing
summary: Layer.provide closes a requirement inside the layer, Effect.provide closes it at the edge, and the type tells you which one you just did.
---

`AppConfig` is ready to run: nothing has to be in context before it builds. The
`Database` that reads its url from `AppConfig` is a different story, and
watching one requirement move is the clearest way to see what providing does.

## A service that needs another service

Here is the second file. `Database` yields `AppConfig`, opens a connection with
`Effect.acquireRelease` so that closing is guaranteed, and hands back a `query`
method.

```ts twoslash
// src/database.ts
import { Config, Context, Effect, Layer } from 'effect'
class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
interface Row {
  readonly id: string
  readonly title: string
}
// ---cut---
export class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    const config = yield* AppConfig

    const connection = yield* Effect.acquireRelease(
      Effect.gen(function* () {
        yield* Effect.log(`opening ${config.databaseUrl}`)
        return { url: config.databaseUrl }
      }),
      () => Effect.log('closing the connection'),
    )

    const query = Effect.fn('Database.query')(function* (sql: string) {
      yield* Effect.log(`${connection.url}: ${sql}`)
      return [] as ReadonlyArray<Row>
    })

    return { query }
  }),
}) {}
```

`Effect.acquireRelease` pairs an acquire with a release, and Effect runs the
release when the surrounding scope closes, on success, on failure and on
interruption alike. A scope is the lifetime something is tied to. You do not
have to create one here, because `Layer.effect` supplies a scope for the
construction and ties it to however long the layer stays built.

## The requirement moves, it does not vanish

Wrap `make` in a layer without doing anything else and read the result:

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    return { databaseUrl, feedSize: 20 }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    const config = yield* AppConfig
    const query = Effect.fn('Database.query')(function* (sql: string) {
      yield* Effect.log(`${config.databaseUrl}: ${sql}`)
      return [] as ReadonlyArray<string>
    })
    return { query }
  }),
}) {}
// ---cut---
const leaky = Layer.effect(Database, Database.make)
//    ^?
```

`AppConfig` is in the third slot. The requirement that `make` had did not
disappear when it became a layer, it moved out one level. Anyone who wants this
layer now has to know a config service exists and supply one, which is the
parameter passing from chapter one wearing different clothes.

## Layer.provide closes it

`Layer.provide` feeds one layer into another's requirements and keeps only the
outer layer's output.

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    return { databaseUrl, feedSize: 20 }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    const config = yield* AppConfig
    const query = Effect.fn('Database.query')(function* (sql: string) {
      yield* Effect.log(`${config.databaseUrl}: ${sql}`)
      return [] as ReadonlyArray<string>
    })
    return { query }
  }),
}) {}
// ---cut---
const leaky = Layer.effect(Database, Database.make)

const wired = leaky.pipe(Layer.provide(AppConfig.layer))
//    ^?
```

Two things changed and both are worth a sentence.

`AppConfig` left the third slot, which is the obvious one. Callers ask for a
`Database` and get the config underneath it without being told.

`ConfigError` arrived in the second slot, which is the one people miss. The
requirement did not evaporate, it was traded for the risk of building it.
Whoever provides this layer can no longer forget the config, and instead
inherits the possibility that the config is missing at startup. That is a
better problem, and it is still a problem.

`AppConfig` also stopped being visible in the output. `Layer.provide` returns
only what the outer layer produces, so nothing downstream can yield `AppConfig`
through this. When you want it to stay available, that is `Layer.provideMerge`,
and the next chapter is where it earns its place.

In the real file this goes on the class, where the rest of the app never has to
look at it:

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    return { databaseUrl, feedSize: 20 }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// ---cut---
export class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    const config = yield* AppConfig
    const query = Effect.fn('Database.query')(function* (sql: string) {
      yield* Effect.log(`${config.databaseUrl}: ${sql}`)
      return [] as ReadonlyArray<string>
    })
    return { query }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(AppConfig.layer),
  )
}
```

Add a second dependency to `make` next year and you add it to this one
`Layer.provide` call. Nothing outside the file changes, which is the entire
return on the `static layer` convention.

`Layer.provide` takes an array when there are several, and one call with an
array is better than three chained calls. Chaining nests the types, and deeply
nested layer types are the usual reason an Effect codebase starts feeling slow
in the editor.

## Effect.provide closes it at the edge

`Layer.provide` connects layers to each other. `Effect.provide` connects a
layer to the program, and it belongs at the outermost point, next to the runner.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<string>> }
>()('Database') {
  static readonly layer: Layer.Layer<Database> = Layer.succeed(this, {
    query: () => Effect.succeed([]),
  })
}
// ---cut---
const program = Effect.gen(function* () {
  const database = yield* Database
  return yield* database.query('select * from articles')
})

const runnable = program.pipe(Effect.provide(Database.layer))
//    ^?
```

`R` is `never`, which is what the runners require. Providing halfway down
instead compiles fine and throws away the reason `R` exists: once a function
has satisfied its own dependencies, nobody above it can substitute a different
implementation, and substitution is the entire mechanism behind testing without
mocks.

## What people get wrong

Leaving `RIn` open on a service's own layer and satisfying it at the call site.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class AppConfig extends Context.Service<
  AppConfig,
  { readonly databaseUrl: string }
>()('AppConfig') {
  static readonly layer: Layer.Layer<AppConfig> = Layer.succeed(this, {
    databaseUrl: 'sqlite://feed.db',
  })
}
class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    const config = yield* AppConfig
    return { query: () => Effect.succeed([config.databaseUrl]) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
declare const program: Effect.Effect<ReadonlyArray<string>, never, Database>
// ---cut---
const runnable = program.pipe(
  Effect.provide(Database.layer.pipe(Layer.provide(AppConfig.layer))),
)
```

This works, and it keeps working until a second place needs a `Database`. Now
two call sites each decide how to build the config, and the day they disagree,
the bug is that one half of your app is reading a different url. Wire a
service's dependencies in the service's own layer. The rule is easy to check:
a finished `static layer` has `never` in its third slot.

There is one honest exception. Infrastructure that is provided exactly once at
the root, such as a database client handed in by the platform, is often left in
`RIn` on purpose so that production and tests can supply different ones. That
is a decision you make per service, not a default.

## Next

One dependency, one provide. [Standing side by
side](/learn/layers/04-standing-side-by-side) adds a second repository, which
is where `merge`, `mergeAll` and `provideMerge` stop being three names for the
same thing.
