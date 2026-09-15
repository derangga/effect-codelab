---
title: Layers that fail, layers that clean up
order: 6
slug: 06-failure-and-cleanup
summary: The middle type parameter is a startup failure. Layer.catchTag falls back, Layer.orDie gives up, and acquireRelease decides what happens to an open connection.
---

`AppConfig.layer` has had `ConfigError` in its second slot since chapter two,
and every layer built on top of it inherited that. So far we have read it and
moved on. This chapter is about what it actually means and what you can do
about it.

## A failure that happens once

A layer's error is not a request failure. It happens while the service is being
constructed, which is once, at startup, before anything has served anybody.
That changes what a sensible response looks like.

A query that fails gets retried, or turns into a 500. A missing `DATABASE_URL`
does neither. Either you have a reasonable thing to do without it, or the
process should stop and tell an operator which variable is missing. Both are
decisions, and both belong at the layer.

```ts twoslash
import { Config, Context, Effect, Layer } from 'effect'

class Mailer extends Context.Service<
  Mailer,
  { readonly send: (to: string) => Effect.Effect<void> }
>()('Mailer') {}

const makeMailer = Effect.gen(function* () {
  const key = yield* Config.String('MAIL_KEY')
  return { send: (to: string) => Effect.log(`mailing ${to} with ${key}`) }
})

const mailerLayer = Layer.effect(Mailer, makeMailer)
//    ^?
```

`ConfigError` in the middle. This layer can be built or it can fail, and until
you say which you want, that possibility travels with every layer that depends
on it, right up to the app root.

## Falling back

`Layer.catchTag` matches one tagged error and replaces the layer with another
one. A tagged error is an error class carrying a `_tag` string that identifies
it, which is what lets the match be typed rather than a string comparison you
wrote yourself.

```ts twoslash
import { Context, Effect, Layer, Schema } from 'effect'
class Mailer extends Context.Service<
  Mailer,
  { readonly send: (to: string) => Effect.Effect<void> }
>()('Mailer') {}
// ---cut---
class SecretMissing extends Schema.TaggedError<SecretMissing>()(
  'SecretMissing',
  { message: Schema.String },
) {}

const strict = Layer.effect(
  Mailer,
  Effect.fail(new SecretMissing({ message: 'MAIL_KEY is not set' })),
)

const logOnly = (reason: string) =>
  Layer.succeed(Mailer, {
    send: (to: string) => Effect.log(`${reason}, skipping mail to ${to}`),
  })

const recovered: Layer.Layer<Mailer> = strict.pipe(
  Layer.catchTag('SecretMissing', (error) => logOnly(error.message)),
)
```

`Layer.Layer<Mailer>` is the short way to write `Layer<Mailer, never, never>`,
and it is an annotation rather than a reveal, so the build fails if it is
wrong. `never` in the second slot now. The failure is handled inside the layer, so
nothing above it has to think about mail keys. Running a program against
`recovered` prints the fallback and carries on:

```
[11:03:29.701] INFO (#4): MAIL_KEY is not set, skipping mail to a@b.c
```

This is the shape worth copying for anything optional. Mail in local
development, a tracing exporter, a feature that degrades. The fallback is a
real implementation of the same service that does less, which means no caller
learns that mail is off.

`Layer.catchCause` is the same idea with the full cause, so it also catches
defects and interruption. Use it when you are writing the last line of defence
and cannot assume the failure was typed.

## Giving up on purpose

When there is no sensible fallback, say that too. `Layer.orDie` turns a typed
failure into a defect, which removes it from the type and crashes the fiber if
it happens.

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
const orDie = mailerLayer.pipe(Layer.orDie)
//    ^?
```

A clean second slot, and a process that stops at startup when the variable is
absent. For a secret with no offline mode, that is honest and correct: the
alternative is an app that starts, looks healthy, and fails on the first user
who triggers an email.

Do this at the root, deliberately, on failures you have decided are fatal. Do
not do it in a service's own layer to make the type tidy, because you have then
taken the fallback decision away from whoever assembles the app, and they are
the only one with enough context to make it.

## What happens to the open connection

`Database` opens a connection with `Effect.acquireRelease`, and the release
runs when the scope that owns it closes. For a layer, that scope is the
lifetime of the build, so the connection closes when the program that provided
the layer finishes.

It closes on every ending, which is the part that matters. The run in the
previous chapter ended normally:

```
[11:08:39.093] INFO (#1): closing the connection
```

The same line appears when the program fails, when it is interrupted, and when
a later layer in the graph fails to build. That last one is the case people do
not think about, so here it is with a `Cache` over the database and a `Mailer`
that fails after both are up:

```
[11:16:12.481] INFO (#2): acquire Database
[11:16:12.483] INFO (#2): acquire Cache
[11:16:12.484] INFO (#3): about to fail Mailer
[11:16:12.485] INFO (#5): release Cache
[11:16:12.485] INFO (#5): release Database
```

Nothing was left open. Releases run in reverse order of acquisition, so the
cache goes before the database it was built on, which is the only order that
never tears down something another finalizer still needs.

You get this for free as long as the acquisition goes through
`Effect.acquireRelease` inside `Layer.effect`. You lose it the moment you open
the connection outside a scope, which is the real cost of the `Effect.runSync`
shortcut from chapter one.

## What people get wrong

Handling a layer's failure by wrapping the program instead of the layer.

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
declare const program: Effect.Effect<void, never, Mailer>
// ---cut---
const handled = program.pipe(
  Effect.provide(strict),
  Effect.catchTag('SecretMissing', () => Effect.log('mail is off')),
)
```

This compiles and it looks equivalent. It is not. The program no longer runs at
all when the layer fails, because there was never a `Mailer` to run it with, so
the log line is the only thing that happens and every request the program was
going to serve is gone. Recovering at the layer supplies a working service and
the program runs; recovering at the program supplies nothing and the program
stops.

The rule is short: recover where the thing you need can still be produced.

## Next

The graph builds, it can fail, and it cleans up after itself. What it does not
do is tell you anything while it happens. [Tapping a
layer](/learn/layers/07-tapping) is how you watch a build without changing what
it produces.
