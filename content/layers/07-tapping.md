---
title: Tapping a layer
order: 7
slug: 07-tapping
summary: Layer.tap, tapError and tapCause run an effect when a layer builds or fails to, without changing what it provides.
---

Every run so far has printed `opening sqlite://feed.db` because the `Database`
service logs it from inside `make`. That works for a service you own. It does
nothing for the ones you do not, and it is the wrong place for anything that is
about startup rather than about the database.

A tap is the other option. It runs an effect at a point in a layer's life and
throws away the result, so the layer's output is untouched, and whoever is
assembling the app adds it without editing the service.

## Watching a build succeed

`Layer.tap` runs after the layer builds. The callback receives the context the
layer produced, and `Context.get` pulls a service out of it.

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
// @filename: src/database.ts
import { Context, Effect, Layer } from 'effect'
import { AppConfig } from './config'
export interface Row {
  readonly id: string
  readonly title: string
}
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
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(AppConfig.layer),
  )
  static readonly layerMemory = Layer.succeed(this, {
    query: (sql: string) => Effect.succeed([{ id: 'row-1', title: sql }]),
  })
  static readonly layerOrMemory: Layer.Layer<Database> = this.layer.pipe(
    Layer.catchTag('ConfigError', () => this.layerMemory),
  )
}
// @filename: src/main.ts
import { Context, Effect, Layer } from 'effect'
import { Database } from './database'
// ---cut---
// src/main.ts
const logReady = (context: Context.Context<Database>) =>
  Effect.log(`database ready: ${Context.get(context, Database).query !== undefined}`)

const observed = Database.layer.pipe(Layer.tap(logReady))
//    ^?
```

The output is unchanged: still a `Layer<Database, ConfigError, never>`. Building
it prints the service's own line and then yours, in that order.

```
[11:03:29.700] INFO (#3): opening sqlite://feed.db
[11:03:29.700] INFO (#3): database ready: true
```

The context argument is the thing that trips people the first time. It is not the
service, it is a bag of services keyed by name, so reaching for `context.query`
fails and `Context.get(context, Database)` is the way in. The reason for the
extra step is that a layer can provide several services at once, and a tap on a
merged layer can read any of them.

## Watching it fail

`Layer.tapError` runs when the build fails with a typed error, and the layer still
fails with that same error afterwards. It observes, it does not recover.

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
// @filename: src/database.ts
import { Context, Effect, Layer } from 'effect'
import { AppConfig } from './config'
export interface Row {
  readonly id: string
  readonly title: string
}
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
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(AppConfig.layer),
  )
  static readonly layerMemory = Layer.succeed(this, {
    query: (sql: string) => Effect.succeed([{ id: 'row-1', title: sql }]),
  })
  static readonly layerOrMemory: Layer.Layer<Database> = this.layer.pipe(
    Layer.catchTag('ConfigError', () => this.layerMemory),
  )
}
// @filename: src/main.ts
import { Config, Effect, Layer } from 'effect'
import { Database } from './database'
// ---cut---
// src/main.ts
const logFailure = (error: Config.ConfigError) =>
  Effect.logError(`database did not start: ${error.message}`)

const watched = Database.layer.pipe(Layer.tapError(logFailure))
//    ^?
```

`ConfigError` is still in the second slot, which is the whole point. Compare it
with the `Layer.catchTag` from the previous chapter: `catchTag` replaces the layer
and clears the error, `tapError` looks and steps aside. Reaching for the wrong one
is the difference between a logged startup failure and a silently swallowed one.

Pairing them reads well, because the log explains what the fallback is about to
do. This is the version of `layerOrMemory` worth shipping:

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
// @filename: src/database.ts
import { Context, Effect, Layer } from 'effect'
import { AppConfig } from './config'
export interface Row {
  readonly id: string
  readonly title: string
}
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
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(AppConfig.layer),
  )
  static readonly layerMemory = Layer.succeed(this, {
    query: (sql: string) => Effect.succeed([{ id: 'row-1', title: sql }]),
  })
  static readonly layerOrMemory: Layer.Layer<Database> = this.layer.pipe(
    Layer.catchTag('ConfigError', () => this.layerMemory),
  )
}
// @filename: src/main.ts
import { Config, Effect, Layer } from 'effect'
import { Database } from './database'
// ---cut---
// src/main.ts
const databaseOrMemory: Layer.Layer<Database> = Database.layer.pipe(
  Layer.tapError((error: Config.ConfigError) =>
    Effect.logWarning(`${error.message}, falling back to memory`),
  ),
  Layer.catchTag('ConfigError', () => Database.layerMemory),
)
```

`Layer.tapCause` is the third one. It receives the full cause, so it also sees
defects and interruption, which a typed error handler never will. That makes it
the right choice for the one tap at your app root whose job is to make sure no
startup failure goes unreported, and chapter eight puts it there.

## When a tap is the wrong tool

A tap runs once per build, not once per call. If you want a log line on every
query, it belongs in the `query` method, which is exactly where `Database` already
puts it. Putting it in a tap produces one line at startup that you then spend
twenty minutes wondering about.

The other case is work that the service genuinely owns. Warming a cache, running a
migration, registering a health check. All of that can go in a tap, and all of it
is better inside `make`, where the code that needs it and the code that does it
are in the same place and the service can hold onto whatever it produced.

That leaves taps for what they are good at: observation from outside, added by
whoever is assembling the app, on a layer they did not write. Timing a build in a
startup metric. Logging that a third party client connected. Printing the graph in
development and not in production. A tap is a decorator applied at the root, and it
reads best when the service underneath has no idea it is there.

`Layer.effectDiscard` from chapter two is the neighbouring tool: it runs an effect
as part of the graph without being attached to a particular layer. Use a tap when
the effect is about one layer, and `effectDiscard` when it is about startup in
general.

## What people get wrong

Expecting a tap to see requests.

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
// @filename: src/database.ts
import { Context, Effect, Layer } from 'effect'
import { AppConfig } from './config'
export interface Row {
  readonly id: string
  readonly title: string
}
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
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(AppConfig.layer),
  )
  static readonly layerMemory = Layer.succeed(this, {
    query: (sql: string) => Effect.succeed([{ id: 'row-1', title: sql }]),
  })
  static readonly layerOrMemory: Layer.Layer<Database> = this.layer.pipe(
    Layer.catchTag('ConfigError', () => this.layerMemory),
  )
}
// @filename: src/main.ts
import { Effect, Layer } from 'effect'
import { Database } from './database'
// ---cut---
// src/main.ts, one line at startup, not one per query
const counted = Database.layer.pipe(
  Layer.tap(() => Effect.log('a query happened')),
)
```

One line, at startup, no matter how many queries the app serves. The wording of
`Layer.tap` invites the mistake because tapping a stream or an effect does run per
item. A layer is not a stream of anything. It is built once, and everything
attached to it happens once.

## Next

The graph is assembled, observed and recoverable. [Swapping the
graph](/learn/layers/08-swapping-the-graph) is the payoff: replacing the database
in a wired application without touching the code that uses it, and the trap that
makes people think it does not work.
