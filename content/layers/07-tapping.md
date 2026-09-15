---
title: Tapping a layer
order: 7
slug: 07-tapping
summary: Layer.tap, tapError and tapCause run an effect when a layer builds or fails to, without changing what it provides.
---

A server that starts silently is a server nobody can debug. You want a line
saying the database is up and which url it opened, a metric when startup takes
too long, a warning when the mail fallback kicked in. None of that is a service,
and none of it should change what the layer provides.

That is what tapping is. A tap runs an effect at a point in the layer's life and
throws away the result, so the layer's output is untouched.

## Watching a build succeed

`Layer.tap` runs after the layer builds. The callback receives the context the
layer produced, and `Context.get` pulls a service out of it.

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
// ---cut---
const logReady = (context: Context.Context<Database>) =>
  Effect.log(`ready: ${Context.get(context, Database).query !== undefined}`)

const observed = Database.layer.pipe(Layer.tap(logReady))
//    ^?
```

The output is unchanged: still `Layer<Database>`. Building it prints both lines
in order.

```
[11:03:29.700] INFO (#3): building the real Database
[11:03:29.700] INFO (#3): ready: true
```

The context argument is the thing that trips people the first time. It is not
the service, it is a bag of services keyed by name, so reaching for
`context.query` fails and `Context.get(context, Database)` is the way in. The
reason for the extra step is that a layer can provide several services at once,
and a tap on a merged layer can read any of them.

## Watching it fail

`Layer.tapError` runs when the build fails with a typed error, and the layer
still fails with that same error afterwards. It observes, it does not recover.

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'
class Mailer extends Context.Service<
  Mailer,
  { readonly send: (to: string) => Effect.Effect<void> }
>()('Mailer') {}
const mailerLayer = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const key = yield* Config.String('MAIL_KEY')
    return { send: (to: string) => Effect.log(`mailing ${to} with ${key}`) }
  }),
)
// ---cut---
const logFailure = (error: Config.ConfigError) =>
  Effect.logError(`mailer did not start: ${error.message}`)

const watched = mailerLayer.pipe(Layer.tapError(logFailure))
//    ^?
```

`ConfigError` is still in the second slot, which is the whole point. Compare it
with `Layer.catchTag` from the previous chapter: `catchTag` replaces the layer
and clears the error, `tapError` looks and steps aside. Reaching for the wrong
one is the difference between a logged startup failure and a silently swallowed
one.

Pairing them reads well, because the log explains what the fallback is about to
do:

```ts twoslash
import { Context, Effect, Layer, Schema } from 'effect'
class SecretMissing extends Schema.TaggedError<SecretMissing>()(
  'SecretMissing',
  { message: Schema.String },
) {}
class Mailer extends Context.Service<
  Mailer,
  { readonly send: (to: string) => Effect.Effect<void> }
>()('Mailer') {}
const strict: Layer.Layer<Mailer, SecretMissing> = Layer.effect(
  Mailer,
  Effect.fail(new SecretMissing({ message: 'MAIL_KEY is not set' })),
)
// ---cut---
const mailer = strict.pipe(
  Layer.tapError((error) => Effect.logWarning(error.message)),
  Layer.catchTag('SecretMissing', () =>
    Layer.succeed(Mailer, { send: () => Effect.void }),
  ),
)
```

`Layer.tapCause` is the third one. It receives the full cause, so it also sees
defects and interruption, which a typed error handler never will. That makes it
the right choice for the one tap at your app root whose job is to make sure no
startup failure goes unreported.

## When a tap is the wrong tool

A tap runs once per build, not once per call. If you want a log line on every
query, it belongs in the `query` method, not in a tap on the layer, and putting
it in the tap produces one line at startup that you then spend twenty minutes
wondering about.

The other case is work that the service genuinely owns. Warming a cache, running
a migration, registering a health check. All of that can go in a tap, and all of
it is better inside `make`, where the code that needs it and the code that does
it are in the same place and the service can hold onto whatever it produced.

That leaves taps for what they are good at: observation from outside, added by
whoever is assembling the app, on a layer they did not write. Logging that a
third party client connected. Timing a build in a startup metric. Printing the
graph in development and not in production. A tap is a decorator applied at the
root, and it reads best when the service underneath has no idea it is there.

`Layer.effectDiscard` from chapter two is the neighbouring tool: it runs an
effect as part of the graph without being attached to a particular layer. Use a
tap when the effect is about one layer, and `effectDiscard` when it is about
startup in general.

## What people get wrong

Expecting a tap to see requests.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Database extends Context.Service<Database>()('Database', {
  make: Effect.succeed({ query: (sql: string) => Effect.succeed([sql]) }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// ---cut---
const counted = Database.layer.pipe(
  Layer.tap(() => Effect.log('a query happened')),
)
```

One line, at startup, no matter how many queries the app serves. The wording of
`Layer.tap` invites the mistake because tapping a stream or an effect does run
per item. A layer is not a stream of anything. It is built once, and everything
attached to it happens once.

## Next

The graph is assembled, observed and recoverable. [Swapping the
graph](/learn/layers/08-swapping-the-graph) is the payoff: replacing one service
in a wired application without touching the code that uses it, and the trap that
makes people think it does not work.
