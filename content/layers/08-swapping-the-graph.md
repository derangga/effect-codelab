---
title: Swapping the graph
order: 8
slug: 08-swapping-the-graph
summary: Replace one service in a wired application, why providing a stub to a finished layer silently does nothing, and the app root that ties the track together.
---

Everything so far was in service of one thing. A test wants the real
`FeedService`, the real paging logic, the real repository code, and a database
that does not exist. Every piece is written once and the test swaps one node of
the graph.

Effect makes that possible, and it also has one trap sitting directly in front
of it that convinces people it does not work.

## The trap

Here is the obvious move. Take the wired `UserRepo.layer` and provide a stub
database to it.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    yield* Effect.log('building the real Database')
    return { query: (sql: string) => Effect.succeed([sql]) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    return { findById: (id: string) => database.query(`users ${id}`) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Database.layer),
  )
}
const databaseTest = Layer.succeed(Database, {
  query: (sql: string) => Effect.succeed([`stub ${sql}`]),
})
declare const program: Effect.Effect<ReadonlyArray<string>, never, UserRepo>
// ---cut---
const attempt = program.pipe(
  Effect.provide(UserRepo.layer.pipe(Layer.provide(databaseTest))),
)
```

It compiles. It runs. It uses the real database:

```
[11:03:29.687] INFO (#1): building the real Database
[ "users u1" ]
```

`UserRepo.layer` already satisfied its own `Database` requirement, so its third
slot is `never`. `Layer.provide` feeds a layer's requirements, and there are
none left to feed, so the call is a no-op. TypeScript is happy because
providing more than is needed is always allowed, and you are left staring at a
test that hits a real database while insisting it cannot.

This is the cost of the `static layer` convention, and it is worth paying, but
you have to know where the door is.

## The way through

Swap at the same level the wiring happened. `make` is still there, and it is
the unwired recipe:

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Database extends Context.Service<Database>()('Database', {
  make: Effect.gen(function* () {
    yield* Effect.log('building the real Database')
    return { query: (sql: string) => Effect.succeed([sql]) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    return { findById: (id: string) => database.query(`users ${id}`) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Database.layer),
  )
}
const databaseTest = Layer.succeed(Database, {
  query: (sql: string) => Effect.succeed([`stub ${sql}`]),
})
declare const program: Effect.Effect<ReadonlyArray<string>, never, UserRepo>
// ---cut---
const swapped = program.pipe(
  Effect.provide(
    Layer.effect(UserRepo, UserRepo.make).pipe(Layer.provide(databaseTest)),
  ),
)
```

```
[ "stub users u1" ]
```

The real `UserRepo` code ran, the query text is the real one, and nothing
touched a database. That is the property the whole track was building toward:
one node replaced, everything above it untouched, no mocking library involved.

## Naming the variants

Rebuilding from `make` at every test site gets old, so give the service a second
layer next to the first.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
interface Row { readonly id: string; readonly title: string }
class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<Row>> }
>()('Database') {
  static readonly layer: Layer.Layer<Database> = Layer.succeed(this, {
    query: () => Effect.succeed([]),
  })
}
// ---cut---
class UserRepo extends Context.Service<UserRepo>()('UserRepo', {
  make: Effect.gen(function* () {
    const database = yield* Database
    const findById = Effect.fn('UserRepo.findById')(function* (id: string) {
      return yield* database.query(`select * from users where id = '${id}'`)
    })
    return { findById }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)

  static readonly layerTest = Layer.succeed(this, {
    findById: () => Effect.succeed([{ id: 'u1', title: 'a memoir' }]),
  })
}
```

Both layers are on the same class, so production code that yields `UserRepo`
gets whichever one the root provided and never finds out which. `layer` for
production, `layerTest` for a double, `layerConfig` when one is built from
config values. Keeping the names boring is worth more than it sounds, because
the name is the only thing telling a reader at the app root what they are
looking at.

For a service with ten methods where the test exercises two, `Layer.mock`
implements the ones you name and leaves the rest as a defect if anything calls
them.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
interface Row { readonly id: string }
class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<ReadonlyArray<Row>>
    readonly migrate: () => Effect.Effect<void>
  }
>()('Database') {}
// ---cut---
const databaseMock = Layer.mock(Database, {
  query: () => Effect.succeed([{ id: 'a1' }]),
})
```

A test that calls `migrate` here fails loudly rather than quietly doing nothing,
which is the behaviour you want from a stub you did not finish writing.

## The root

The last file collects the graph and runs it. Everything below this line is
wiring that no other file has to know about.

```ts twoslash
// src/main.ts
import { Context, Effect, Layer } from 'effect'
interface Row { readonly id: string }
class FeedService extends Context.Service<
  FeedService,
  { readonly forUser: (id: string) => Effect.Effect<ReadonlyArray<Row>> }
>()('FeedService') {
  static readonly layer: Layer.Layer<FeedService> = Layer.succeed(this, {
    forUser: () => Effect.succeed([]),
  })
}
// ---cut---
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

Every operator in the track is in those eleven lines. `mergeAll` puts the
startup banner beside the service, `effectDiscard` runs it for its log line,
`tapCause` reports any failure to build, and `Effect.provide` closes the
requirement so the program can run at all.

For a service that is the whole application, such as an HTTP server, there is
one more. `Layer.launch` builds a layer and holds it open until it is
interrupted, instead of building it, running something, and tearing it down.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class HttpServer extends Context.Service<
  HttpServer,
  { readonly port: number }
>()('HttpServer') {
  static readonly layer: Layer.Layer<HttpServer> = Layer.succeed(this, {
    port: 3000,
  })
}
// ---cut---
const main = Layer.launch(HttpServer.layer)
```

The server is the layer, there is no program to run against it, and the process
stays up until something stops it. On interrupt the scope closes and every
release in the graph runs, in reverse.

## What people get wrong

Writing a second class for the test double.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
interface Row { readonly id: string }
// ---cut---
class UserRepoInMemory extends Context.Service<UserRepoInMemory>()('UserRepo', {
  make: Effect.succeed({ findById: () => Effect.succeed([{ id: 'u1' }]) }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

It works, because context is keyed by the string and `'UserRepo'` is the same
string. It works right up until somebody renames the real service, or types
`'UserRepoo'` here, at which point the two stop being the same slot and the
failure shows up as a missing requirement in a file neither of them is in. A
`static layerTest` on the real class cannot drift, because there is no string to
get wrong.

## Where to go next

Layers are the last piece of Effect that is structural rather than about any one
domain. From here the interesting problems are what you wire together.

[HTTP Auth API](/learn/http-auth-api) builds a server whose entire startup is
one layer graph, with a database, a token signer and a middleware that all get
assembled the way this track describes. [Fullstack
Monorepo](/learn/fullstack-monorepo) does the same across a workspace, where the
client and the server share one contract. And
[Services and layers](/learn/anti-patterns/04-services-and-layers) is the short
list of ways to undo all of it, which is worth ten minutes now that every item
on it will make sense.
