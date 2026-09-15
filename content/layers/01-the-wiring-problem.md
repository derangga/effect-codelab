---
title: The wiring problem
order: 1
slug: 01-the-wiring-problem
summary: Why handing over a finished service value runs out, and the four things a layer can do that Effect.provideService cannot.
---

A feed endpoint needs a user's articles. Articles come from a repository, the
repository needs a database connection, and the connection needs a url out of
the environment. Four things, and only the first one is what the endpoint is
about. Getting the other three into place is wiring, and every language has a
bad answer for it ready to go.

## The bad answer, written out

In plain TypeScript the connection travels down the call stack as an argument.

```ts twoslash
interface Database {
  readonly query: (sql: string) => Promise<ReadonlyArray<string>>
}

const listArticles = (database: Database, author: string) =>
  database.query(`select * from articles where author = '${author}'`)

const feedForUser = (database: Database, userId: string) =>
  listArticles(database, userId)
```

`feedForUser` never touches `database`. It takes the parameter because
something it calls needs it, and it passes it straight through. Add a cache and
every function on that path grows a second parameter it does not use. That is
the whole problem, and it gets worse in exactly the direction your codebase
grows.

## What Effect does instead

An `Effect<A, E, R>` carries three things: `A` is what it produces, `E` is how
it can fail, and `R` is what it needs before it can run. `R` is the interesting
one here, because it means the requirement can be recorded in the type instead
of threaded through the arguments.

A service is a capability your code asks for by name. `Context.Service`
declares one:

```ts twoslash
import { Context, Effect } from 'effect'

class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<string>> }
>()('Database') {}
```

Two arguments worth reading. The class is passed to itself so the type can
refer to its own instance, and the string `'Database'` is the name the context
is keyed by at runtime. The second type argument is the shape: one method
returning an Effect.

Now ask for it. `yield*` on the class means "get me the Database that is in
context".

```ts twoslash
import { Context, Effect } from 'effect'
class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<string>> }
>()('Database') {}
// ---cut---
const feedForUser: Effect.Effect<
  ReadonlyArray<string>,
  never,
  Database
> = Effect.gen(function* () {
  const database = yield* Database
  return yield* database.query('select * from articles')
})
```

`Database` is in the third slot. That annotation is checked, so if the effect
actually needed something else the page would fail to build rather than lie to
you. Nothing was passed anywhere, and nothing that
calls `feedForUser` has to know a database exists. The requirement is a fact
about the type rather than a parameter, and it propagates on its own: any
effect that yields this one inherits `Database` in its own `R`.

## Handing over a value

An effect with something in `R` cannot run. The runners refuse it, which is the
point. Something has to put a `Database` in context first, and the smallest way
to do that is `Effect.provideService`, which takes the finished value.

```ts twoslash
import { Context, Effect } from 'effect'
class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<string>> }
>()('Database') {}
const feedForUser = Effect.gen(function* () {
  const database = yield* Database
  return yield* database.query('select * from articles')
})
// ---cut---
const stub = { query: () => Effect.succeed(['a memoir', 'a recipe']) }

const runnable = feedForUser.pipe(Effect.provideService(Database, stub))
//    ^?
```

`R` is now `never`, and `never` is the precondition for running anything. For a
stub in a test, this is the right tool and there is nothing above it.

## Where that runs out

A real connection is not an object literal. Opening it reads a url from the
environment, which can fail. The open itself can fail. And when the program
ends, the connection has to be closed, whether the program ended by finishing,
by failing, or by being interrupted.

Every one of those is an effect. So the construction is an effect:

```ts twoslash
import { Effect } from 'effect'
// ---cut---
const makeDatabase = Effect.gen(function* () {
  yield* Effect.log('opening the connection')
  return { query: () => Effect.succeed(['a memoir']) }
})
```

And `provideService` will not take it, because it wants the value, not a plan
for producing one:

```ts twoslash
// @errors: 2345
import { Context, Effect } from 'effect'
class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<string>> }
>()('Database') {}
declare const feedForUser: Effect.Effect<ReadonlyArray<string>, never, Database>
const makeDatabase = Effect.gen(function* () {
  yield* Effect.log('opening the connection')
  return { query: () => Effect.succeed(['a memoir']) }
})
// ---cut---
const wrong = feedForUser.pipe(
  Effect.provideService(Database, makeDatabase),
)
```

Read the error rather than skipping it. TypeScript is saying that an
`Effect<{ query: ... }>` has no `query` on it, which is exactly right: the
Effect is a description of work that will one day produce something with a
`query`, and it is not that thing.

## What is actually missing

Line up what the construction needs to be able to do, because the list is short
and it is the whole reason the next chapter exists.

It has to run effects while it builds, because opening a connection is work. It
has to be able to fail while it builds, because a missing `DATABASE_URL` is a
startup failure and not a query failure. It has to be able to ask for other
services while it builds, because the url comes from a config service that is
itself built. And it has to register cleanup, so the connection closes when the
program is done with it.

A value cannot do any of that. A recipe can. That recipe is a layer, and it is
the only new idea in this track.

## What people get wrong

Reaching for `Effect.runSync` to get a value that `provideService` will accept.

```ts twoslash
import { Effect } from 'effect'
declare const makeDatabase: Effect.Effect<{
  readonly query: () => Effect.Effect<ReadonlyArray<string>>
}>
// ---cut---
const database = Effect.runSync(makeDatabase)
```

It compiles, so people ship it. What it costs is everything the effect was
carrying: the failure is now a thrown exception instead of a typed error,
nothing will ever close the connection because no scope owns it, and the
construction happens at module load, which means importing the file connects to
your database. If a service needs building, do not build it early to make an
older tool fit.

## Next

[Building a layer](/learn/layers/02-building-a-layer) writes the recipe, and
reads its three type parameters against the three you already know from
`Effect`.
