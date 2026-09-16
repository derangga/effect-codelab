---
title: Layers that fail, layers that clean up
order: 6
slug: 06-failure-and-cleanup
summary: The middle type parameter is a startup failure. Give src/database.ts an in-memory fallback with Layer.catchTag, and see what happens to an open connection when a later layer fails.
---

`AppConfig.layer` has had `ConfigError` in its second slot since chapter two, and
every layer built on top of it inherited that, including `Database.layer` and
`FeedService.layer`. So far we have read it and moved on. This chapter is about
what it actually means and what you can do about it.

## A failure that happens once

A layer's error is not a request failure. It happens while the service is being
constructed, which is once, at startup, before anything has served anybody. That
changes what a sensible response looks like.

A query that fails gets retried, or turns into a 500. A missing `DATABASE_URL`
does neither. Either you have a reasonable thing to do without it, or the process
should stop and tell an operator which variable is missing. Both are decisions,
and both belong at the layer.

Delete `DATABASE_URL` from `.env` and run the app from the previous chapter, and
you get the second one by default:

```
ConfigError: SchemaError(Expected string
  at ["DATABASE_URL"])
```

Nothing started. That is a defensible choice for a database, and a bad one for
anything optional, so it should be a choice rather than the shape you happened
to end up with.

## An implementation that needs nothing

The reasonable thing to do without a url is to run against memory. That is a
second layer on the same class, and it is `Layer.succeed` because there is
nothing to open:

```ts
// src/database.ts, below the static layer
  static readonly layerMemory = Layer.succeed(this, {
    query: (sql: string) => Effect.succeed([{ id: 'row-1', title: sql }]),
  })
```

It provides the same `Database`, so nothing that yields the service can tell the
difference. That is the property the whole track keeps leaning on.

## Falling back

`Layer.catchTag` matches one tagged error and replaces the layer with another
one. A tagged error is an error class carrying a `_tag` string that identifies
it, which is what lets the match be typed rather than a string comparison you
wrote yourself. `ConfigError` is tagged `'ConfigError'`.

```ts
// src/database.ts, a third layer beside the other two
  static readonly layerOrMemory = this.layer.pipe(
    Layer.catchTag('ConfigError', () => this.layerMemory),
  )
```

Here is the whole file's set of layers together, which is the part worth copying:

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
// ---cut---
// src/database.ts, the three layers on the class
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
```

`Layer.Layer<Database>` is the short way to write
`Layer<Database, never, never>`, and it is an annotation rather than a reveal,
so the build fails if it is wrong. `never` in the second slot is the point: the
failure is handled inside the layer, so nothing above it has to think about
database urls.

Wire `layerOrMemory` in instead of `layer`, delete `DATABASE_URL` again, and the
app runs:

```
[
  {
    id: "row-1",
    title: "select * from articles where author = 'u1'",
  }
]
```

No connection opened, no startup failure, and a real feed came back. That is the
shape worth copying for anything optional. A tracing exporter, mail in local
development, a cache that can be skipped. The fallback is a real implementation
of the same service that does less, which means no caller learns that the real
one is missing.

`Layer.catchCause` is the same idea with the full cause, so it also catches
defects and interruption. Use it when you are writing the last line of defence
and cannot assume the failure was typed.

## Giving up on purpose

When there is no sensible fallback, say that too. `Layer.orDie` turns a typed
failure into a defect, which removes it from the type and crashes the fiber if it
happens.

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
}
// @filename: src/main.ts
import { Layer } from 'effect'
import { Database } from './database'
// ---cut---
// src/main.ts
const insist = Database.layer.pipe(Layer.orDie)
//    ^?
```

A clean second slot, and a process that stops at startup when the variable is
absent. For a production database with no offline mode, that is honest and
correct: the alternative is an app that starts, looks healthy, and fails on the
first user who triggers a query.

Do this at the root, deliberately, on failures you have decided are fatal. Do not
do it in a service's own layer to make the type tidy, because you have then taken
the fallback decision away from whoever assembles the app, and they are the only
one with enough context to make it.

## What happens to the open connection

`Database` opens its connection with `Effect.acquireRelease`, and the release runs
when the scope that owns it closes. For a layer, that scope is the lifetime of
the build, so the connection closes when the program that provided the layer
finishes. You have seen that line at the end of every run so far:

```
[10:59:19.596] INFO (#8): closing the connection
```

It closes on every ending, which is the part that matters. The same line appears
when the program fails, when it is interrupted, and when a later layer in the
graph fails to build. That last one is the case people do not think about, so
here it is with a cache layered over the database and a third layer that fails
after both are up:

```
[11:16:12.481] INFO (#2): acquire Database
[11:16:12.483] INFO (#2): acquire Cache
[11:16:12.484] INFO (#3): about to fail
[11:16:12.485] INFO (#5): release Cache
[11:16:12.485] INFO (#5): release Database
```

Nothing was left open. Releases run in reverse order of acquisition, so the cache
goes before the database it was built on, which is the only order that never
tears down something another finalizer still needs.

You get this for free as long as the acquisition goes through
`Effect.acquireRelease` inside `Layer.effect`. You lose it the moment you open the
connection outside a scope, which is the real cost of the `Effect.runSync`
shortcut from chapter one.

## What people get wrong

Handling a layer's failure by wrapping the program instead of the layer.

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
}
// @filename: src/repos.ts
import { Context, Effect, Layer } from 'effect'
import { Database } from './database'
export class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    const findById = Effect.fn('UserRepo.findById')(function* (id: string) {
      return yield* database.query(`select * from users where id = '${id}'`)
    })
    return { findById }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
export class ArticleRepo extends Context.Service<ArticleRepo>()('ArticleRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    const listByAuthor = Effect.fn('ArticleRepo.listByAuthor')(function* (
      id: string,
    ) {
      return yield* database.query(
        `select * from articles where author = '${id}'`,
      )
    })
    return { listByAuthor }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: src/feed.ts
import { Context, Effect, Layer } from 'effect'
import { AppConfig } from './config'
import { Database } from './database'
import { ArticleRepo, UserRepo } from './repos'
export class FeedService extends Context.Service<FeedService>()('FeedService', {
  make: Effect.gen(function* () {
    const users = yield* UserRepo
    const articles = yield* ArticleRepo
    const config = yield* AppConfig
    const forUser = Effect.fn('FeedService.forUser')(function* (id: string) {
      yield* users.findById(id)
      const found = yield* articles.listByAuthor(id)
      return found.slice(0, config.feedSize)
    })
    return { forUser }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide([UserRepo.layer, ArticleRepo.layer, AppConfig.layer]),
    Layer.provide(Database.layer),
  )
}
// @filename: src/main.ts
import { Effect } from 'effect'
import { FeedService } from './feed'
declare const program: Effect.Effect<void, never, FeedService>
// ---cut---
// src/main.ts, recovery that recovers nothing
const handled = program.pipe(
  Effect.provide(FeedService.layer),
  Effect.catchTag('ConfigError', () => Effect.log('running without a database')),
)
```

This compiles and it looks equivalent to `layerOrMemory`. It is not. The program
no longer runs at all when the layer fails, because there was never a
`FeedService` to run it with, so the log line is the only thing that happens and
every request the program was going to serve is gone. Recovering at the layer
supplies a working service and the program runs; recovering at the program
supplies nothing and the program stops.

The rule is short: recover where the thing you need can still be produced.

## Next

The graph builds, it can fail, it falls back, and it cleans up after itself. What
it does not do is tell you anything while it happens. [Tapping a
layer](/learn/layers/07-tapping) is how you watch a build without changing what it
produces.
