---
title: One instance, or two
order: 5
slug: 05-one-instance
summary: Write src/feed.ts, run the whole graph, and count the connections. Layers are memoized within one build, and Layer.fresh opts out.
---

Two repositories both owe a `Database`. There is one `Database.layer` and it
gets fed to both. So when the app starts, does it open one connection or two?

Guessing is how people end up with two connection pools in production and no
idea why. Run it instead.

## The service over both

`FeedService` sits over the two repositories and reads the page size from
config. This is the fourth file:

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
// ---cut---
// src/feed.ts
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
```

Two `Layer.provide` calls, because there are two levels. The first satisfies
what `make` yields. The second satisfies the `Database` that the two
repositories brought with them. Chaining like this is fine when the levels are
real; what you want to avoid is three chained calls where one call with an array
would do.

## The root, and the answer

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
// ---cut---
// src/main.ts
import { Effect } from 'effect'
import { FeedService } from './feed'

const program = Effect.gen(function* () {
  const feed = yield* FeedService
  return yield* feed.forUser('u1')
})

Effect.runPromise(program.pipe(Effect.provide(FeedService.layer))).then(
  console.log,
)
```

`bun run src/main.ts`:

```
[10:59:19.587] INFO (#2): opening sqlite://feed.db
[10:59:19.595] INFO (#1): sqlite://feed.db: select * from users where id = 'u1'
[10:59:19.595] INFO (#1): sqlite://feed.db: select * from articles where author = 'u1'
[10:59:19.596] INFO (#8): closing the connection
[]
```

One open, two queries, one close. `Database.layer` appears once in the graph,
and both repositories got the same connection. The empty array is the stand-in
query returning no rows, which is the only part of this that is not real.

## Why, and how far it goes

Layers are memoized. Within one build, a layer that is reachable from several
places is constructed once and its output is shared by everyone who needed it.
The graph is a graph, not a tree, and Effect walks it accordingly.

This is the behaviour you want almost always. It is what makes a connection pool
a pool, a cache one cache, and an in-memory repository one repository. It is also
the reason the answer to "how many times will this run" is a property of the
build rather than of how many services asked for it.

The sharing extends across separate `Effect.provide` calls on the same fiber
too, so this opens one connection and not two:

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
// @filename: src/main.ts
import { Effect } from 'effect'
import { Database } from './database'
import { UserRepo } from './repos'
declare const program: Effect.Effect<void, never, UserRepo>
// ---cut---
// src/main.ts
const runnable = program.pipe(
  Effect.provide(UserRepo.layer),
  Effect.provide(Database.layer),
)
```

Treat that as a safety net rather than a style. Composing the graph into one
layer and providing it once, the way `FeedService.layer` does, keeps the whole
structure readable in one place, and the type of that one layer is a description
of your application.

## Asking for a second one

Sometimes you want two. A read replica alongside a primary, a scratch database
for one subsystem, a per-test instance that must not see another test's rows.
`Layer.fresh` marks a layer as exempt from sharing. Wire one repository to
`Database.layer` and the other to a fresh copy:

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
import { Effect, Layer } from 'effect'
import { AppConfig } from './config'
import { Database } from './database'
import { FeedService } from './feed'
import { ArticleRepo, UserRepo } from './repos'
// ---cut---
// src/main.ts, two connections on purpose
const twoConnections = Layer.effect(FeedService, FeedService.make).pipe(
  Layer.provide([
    Layer.effect(UserRepo, UserRepo.make).pipe(Layer.provide(Database.layer)),
    Layer.effect(ArticleRepo, ArticleRepo.make).pipe(
      Layer.provide(Layer.fresh(Database.layer)),
    ),
    AppConfig.layer,
  ]),
)
```

Run the same program against that and the log says what you would expect:

```
[11:03:40.158] INFO (#2): opening sqlite://feed.db
[11:03:40.159] INFO (#3): opening sqlite://feed.db
[11:03:40.160] INFO (#1): sqlite://feed.db: select * from users where id = 'u1'
[11:03:40.160] INFO (#1): sqlite://feed.db: select * from articles where author = 'u1'
[11:03:40.160] INFO (#6): closing the connection
[11:03:40.160] INFO (#7): closing the connection
```

Two opens, two closes, and the two repositories are now reading from different
handles. That is either exactly what you asked for or a bug you will spend an
afternoon on, which is why `fresh` is a word you have to type.

For a whole subtree rather than one layer, `Effect.provide` takes an option:

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
// src/main.ts
const isolated = program.pipe(
  Effect.provide(FeedService.layer, { local: true }),
)
```

`{ local: true }` gives that provide its own memoization, so nothing inside it is
shared with anything outside. The usual use is per-test resources, where sharing
across tests is the thing you are trying to prevent.

## What people get wrong

Building the layer inside the function that uses it.

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
// src/main.ts, one connection per request
const handleRequest = () =>
  Effect.runPromise(program.pipe(Effect.provide(FeedService.layer)))
```

Memoization is per build, and this builds every call. A thousand requests is a
thousand connections opened and a thousand closed, and if the service holds
state in a `Ref`, every request also gets its own empty one and nothing ever
accumulates. The symptom is a cache that never hits and a counter stuck at one.

Build the graph once at startup and run against it. In a server that is a
runtime constructed at boot; in a React app it is a runtime held in a memo and
rebuilt only when the chosen layer actually changes. The rule underneath both is
the same: providing is a startup operation, not a per-request one.

## Next

Building `AppConfig` can fail, and the type has been saying so since chapter
two. [Layers that fail, layers that clean
up](/learn/layers/06-failure-and-cleanup) deals with the second slot, and with
what happens to that open connection when something goes wrong.
