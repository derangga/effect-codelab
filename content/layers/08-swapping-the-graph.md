---
title: Swapping the graph
order: 8
slug: 08-swapping-the-graph
summary: Run the real feed against an in-memory database, find out why providing a stub to a finished layer silently does nothing, and finish src/main.ts.
---

Everything so far was in service of one thing. You want the real `FeedService`,
the real paging logic, the real repository code, and a database that does not
exist. Every piece is written once and one node of the graph gets replaced.

`Database.layerMemory` from chapter six is already that node. Effect makes the
swap possible, and it also has one trap sitting directly in front of it that
convinces people it does not work.

## The trap

Here is the obvious move. Take the wired `FeedService.layer` and provide the
in-memory database to it.

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
import { Database } from './database'
import { FeedService } from './feed'
declare const program: Effect.Effect<unknown, never, FeedService>
// ---cut---
// src/main.ts, the swap that does not swap
const attempt = program.pipe(
  Effect.provide(FeedService.layer.pipe(Layer.provide(Database.layerMemory))),
)
```

It compiles. It runs. It uses the real database:

```
[10:59:42.236] INFO (#1): opening sqlite://feed.db
[10:59:42.238] INFO (#1): sqlite://feed.db: select * from users where id = 'u1'
[10:59:42.239] INFO (#1): sqlite://feed.db: select * from articles where author = 'u1'
[10:59:42.239] INFO (#1): closing the connection
[]
```

`FeedService.layer` already satisfied its own `Database` requirement back in
chapter five, so its third slot is `never`. `Layer.provide` feeds a layer's
requirements, and there are none left to feed, so the call is a no-op.
TypeScript is happy because providing more than is needed is always allowed, and
you are left staring at a test that hits a real database while insisting it
cannot.

This is the cost of the `static layer` convention, and it is worth paying, but
you have to know where the door is.

## The way through

Swap at the same level the wiring happened. `make` is still there, and it is the
unwired recipe:

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
declare const program: Effect.Effect<unknown, never, FeedService>
// ---cut---
// src/main.ts, the same graph with one node replaced
const feedInMemory = Layer.effect(FeedService, FeedService.make).pipe(
  Layer.provide([UserRepo.layer, ArticleRepo.layer, AppConfig.layerTest]),
  Layer.provide(Database.layerMemory),
)

const swapped = program.pipe(Effect.provide(feedInMemory))
```

```
[
  {
    id: "row-1",
    title: "select * from articles where author = 'u1'",
  }
]
```

The real `FeedService` code ran, the real `ArticleRepo` built the real query
string, `AppConfig.layerTest` capped the page at three, and nothing opened a
connection. No log lines at all, because neither stand-in has anything to say.
That is the property the whole track was building toward: one node replaced,
everything above it untouched, no mocking library involved.

Notice that `feedInMemory` is the same four lines as `FeedService.layer` with two
names changed. When a service is worth swapping often, that belongs on the class
as a `layerTest` next to `layer`, the way `AppConfig` and `Database` already do
it. `layer` for production, `layerTest` for a double, `layerConfig` when one is
built from config values. Keeping the names boring is worth more than it sounds,
because the name is the only thing telling a reader at the root what they are
looking at.

## A double you did not finish writing

`Database.layerMemory` implements the one method the service has. For a service
with ten methods where the test exercises two, `Layer.mock` implements the ones
you name and leaves the rest as a defect if anything calls them.

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
// src/main.ts
const databaseMock = Layer.mock(Database, {
  query: (sql: string) => Effect.succeed([{ id: 'row-1', title: sql }]),
})
```

Anything calling a method you left out fails loudly rather than quietly doing
nothing, which is the behaviour you want from a stub that is deliberately
partial.

## The root

The last file collects the graph and runs it. Everything in it is an operator
from an earlier chapter:

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
// src/main.ts, finished
import { Effect, Layer } from 'effect'
import { FeedService } from './feed'

const banner = Layer.effectDiscard(Effect.log('feed service starting'))

const AppLive = Layer.mergeAll(FeedService.layer, banner).pipe(
  Layer.tapCause((cause) => Effect.logError(`startup failed: ${cause}`)),
)

const program = Effect.gen(function* () {
  const feed = yield* FeedService
  return yield* feed.forUser('u1')
})

Effect.runPromise(program.pipe(Effect.provide(AppLive))).then(console.log)
```

`mergeAll` puts the startup banner beside the service, `effectDiscard` runs it for
its log line, `tapCause` reports any failure to build including defects, and
`Effect.provide` closes the requirement so the program can run at all. Five files,
five services, one connection.

## What people get wrong

Writing a second class for the test double instead of a second layer on the real
one.

```ts twoslash
// @filename: src/database.ts
import { Context, Effect, Layer } from 'effect'
// ---cut---
// src/database.ts, a second class with the same key
export class DatabaseInMemory extends Context.Service<DatabaseInMemory>()(
  'Database',
  { make: Effect.succeed({ query: () => Effect.succeed([]) }) },
) {
  static readonly layer = Layer.effect(this, this.make)
}
```

It works, because context is keyed by the string and `'Database'` is the same
string the real service uses. It works right up until somebody renames the real
service, or types `'Databse'` here, at which point the two stop being the same
slot and the failure shows up as a missing requirement in a file neither of them
is in. A `static layerMemory` on the real class cannot drift, because there is no
string to get wrong.

## Where to go next

Layers are the last piece of Effect that is structural rather than about any one
domain. From here the interesting problems are what you wire together.

[HTTP Auth API](/learn/http-auth-api) builds a server whose entire startup is one
layer graph, with a database, a token signer and a middleware that all get
assembled the way this track describes. [Fullstack
Monorepo](/learn/fullstack-monorepo) does the same across a workspace, where the
client and the server share one contract. And [Services and
layers](/learn/anti-patterns/04-services-and-layers) is the short list of ways to
undo all of it, which is worth ten minutes now that every item on it will make
sense.
