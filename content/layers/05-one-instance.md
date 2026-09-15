---
title: One instance, or two
order: 5
slug: 05-one-instance
summary: Layers are memoized within one build, so two repositories over one database layer share one connection. Layer.fresh and the local option opt out.
---

Two repositories both owe a `Database`. There is one `Database.layer` and it
gets fed to both. So when the app starts, does it open one connection or two?

Guessing is how people end up with two connection pools in production and no
idea why. Run it instead.

## The whole graph, assembled

`FeedService` sits over both repositories and reads the page size from config.

```ts twoslash
// src/feed.ts
import { Config, Context, Effect, Layer } from 'effect'
interface Row { readonly id: string }
class AppConfig extends Context.Service<AppConfig>()('AppConfig', {
  make: Effect.gen(function* () {
    const databaseUrl = yield* Config.String('DATABASE_URL')
    const feedSize = yield* Config.Int('FEED_SIZE').pipe(Config.withDefault(20))
    return { databaseUrl, feedSize }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
class Database extends Context.Service<Database>()('Database', {
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
class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    return { findById: (id: string) => database.query(`users ${id}`) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
class ArticleRepo extends Context.Service<ArticleRepo>()('ArticleRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    return { listByAuthor: (id: string) => database.query(`articles ${id}`) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// ---cut---
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
```

Two `Layer.provide` calls, because there are two levels. The first satisfies
what `FeedService.make` yields. The second satisfies the `Database` that the
two repositories brought with them. Chaining like this is fine when the levels
are real; what you want to avoid is three chained calls where one call with an
array would do.

Run it against a program that calls `forUser` once:

```
[11:08:39.084] INFO (#1): opening sqlite://feed.db
[11:08:39.092] INFO (#1): sqlite://feed.db: users u1
[11:08:39.092] INFO (#1): sqlite://feed.db: articles u1
[11:08:39.093] INFO (#1): closing the connection
```

One open, two queries, one close. `Database.layer` appears once in the graph,
and both repositories got the same connection.

## Why, and how far it goes

Layers are memoized. Within one build, a layer that is reachable from several
places is constructed once and its output is shared by everyone who needed it.
The graph is a graph, not a tree, and Effect walks it accordingly.

This is the behaviour you want almost always. It is what makes a connection
pool a pool, a cache one cache, and an in-memory repository one repository. It
is also the reason the answer to "how many times will this run" is a property
of the build rather than of how many services asked for it.

The sharing extends across separate `Effect.provide` calls on the same fiber
too, so this opens one connection and not two:

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
class UserRepo extends Context.Service<
  UserRepo,
  { readonly findById: (id: string) => Effect.Effect<ReadonlyArray<string>> }
>()('UserRepo') {
  static readonly layer: Layer.Layer<UserRepo, never, Database> = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database
      return { findById: (id: string) => database.query(id) }
    }),
  )
}
declare const program: Effect.Effect<void, never, UserRepo>
// ---cut---
const runnable = program.pipe(
  Effect.provide(UserRepo.layer),
  Effect.provide(Database.layer),
)
```

Treat that as a safety net rather than a style. Composing the graph into one
layer and providing it once keeps the whole structure readable in one place,
and the type of that one layer is a description of your application.

## Asking for a second one

Sometimes you want two. A read replica alongside a primary, a scratch database
for one subsystem, a per-test instance that must not see another test's rows.
`Layer.fresh` marks a layer as exempt from sharing:

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
const second = Layer.fresh(Database.layer)
```

Wire one repository to `Database.layer` and the other to
`Layer.fresh(Database.layer)`, run the same program, and the log says what you
would expect:

```
[11:08:39.094] INFO (#10): opening sqlite://feed.db
[11:08:39.094] INFO (#11): opening sqlite://feed.db
[11:08:39.094] INFO (#9): sqlite://feed.db: users u1
[11:08:39.094] INFO (#9): sqlite://feed.db: articles u1
[11:08:39.094] INFO (#14): closing the connection
[11:08:39.094] INFO (#15): closing the connection
```

Two opens, two closes, and the two repositories are now reading from different
handles. That is either exactly what you asked for or a bug you will spend an
afternoon on, which is why `fresh` is a word you have to type.

For a whole subtree rather than one layer, `Effect.provide` takes an option:

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Harness extends Context.Service<
  Harness,
  { readonly reset: () => Effect.Effect<void> }
>()('Harness') {
  static readonly layer: Layer.Layer<Harness> = Layer.succeed(this, {
    reset: () => Effect.void,
  })
}
declare const program: Effect.Effect<void, never, Harness>
// ---cut---
const isolated = program.pipe(Effect.provide(Harness.layer, { local: true }))
```

`{ local: true }` gives that provide its own memoization, so nothing inside it
is shared with anything outside. The usual use is per-test resources, where
sharing across tests is the thing you are trying to prevent.

## What people get wrong

Building the layer inside the function that uses it.

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
declare const program: Effect.Effect<ReadonlyArray<string>, never, Database>
// ---cut---
const handleRequest = () =>
  Effect.runPromise(program.pipe(Effect.provide(Database.layer)))
```

Memoization is per build, and this builds every call. A thousand requests is a
thousand connections opened and a thousand closed, and if the service holds
state in a `Ref`, every request also gets its own empty one and nothing ever
accumulates. The symptom is a cache that never hits and a counter stuck at one.

Build the graph once at startup and run against it. In a server that is a
runtime constructed at boot; in a React app it is a runtime held in a memo and
rebuilt only when the chosen layer actually changes. The rule underneath both
is the same: providing is a startup operation, not a per-request one.

## Next

Building `AppConfig` can fail, and the type has been saying so since chapter
two. [Layers that fail, layers that clean
up](/learn/layers/06-failure-and-cleanup) deals with the second slot, and with
what happens to that open connection when something goes wrong.
