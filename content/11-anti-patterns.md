---
title: Anti-patterns
order: 11
slug: 11-anti-patterns
summary: The mistakes this course makes easy to make, each with the chapter it comes from and the fix.
---

Everything here is a mistake you can only make once you know the material. They
are in chapter order, so if one of them stings you know where to reread.

This chapter is a reference. Skim it now, come back when something feels wrong.

## Running the program too early

From chapter one. The whole idea is that an Effect is a description, and this
throws that away on the first line.

```ts twoslash
import { Effect } from 'effect'
declare const fetchUser: (id: number) => Effect.Effect<{ name: string }, 'NotFound'>
// ---cut---
const getUser = async (id: number) => {
  const user = await Effect.runPromise(fetchUser(id))
  return user.name
}
```

Once you run it, the failure is gone from the type, the retry you were going to
add has nowhere to attach, and the caller is back to `try` and `catch`.

Run at the edge, once. Everywhere else, return the Effect.

```ts twoslash
import { Effect } from 'effect'
declare const fetchUser: (id: number) => Effect.Effect<{ name: string }, 'NotFound'>
// ---cut---
const getUser = (id: number): Effect.Effect<string, 'NotFound'> =>
  fetchUser(id).pipe(Effect.map((user) => user.name))
```

The failure is still in the type, where the caller can see it.

The rule: `runPromise` belongs at the edge of your program, and nowhere else.

The edge is wherever something that does not speak Effect calls in. That is a
click handler or a route in a browser app, and it is an HTTP request handler, a
queue consumer, a scheduled job, a CLI `main`, or the body of a test on a
server. Same idea either way: one place where the description finally becomes
work.

Everything inside that boundary should hand back an Effect and let the caller
decide. If `runPromise` shows up in the middle of your code, something is
wrong.

## Promising that code cannot throw

From chapter three. `Effect.sync` and `Effect.promise` are promises you make to
the compiler, and it believes you.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
const parse = (raw: string) => Effect.sync(() => JSON.parse(raw) as unknown)
//    ^?
```

That says the parse cannot fail. `E` is `never`, so nobody will ever handle a
bad string, and when one arrives it becomes a defect that crashes the program
instead of a failure someone could recover from.

I ran this to be sure: a throwing `Effect.sync` is not catchable with
`Effect.catch`, only with the defect handlers. It skips right past your error
handling.

Use `Effect.try` and name the failure.

```ts twoslash
import { Effect } from 'effect'
class InvalidJson {
  readonly _tag = 'InvalidJson'
  constructor(readonly cause: unknown) {}
}
// ---cut---
const parse = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new InvalidJson(cause),
  })
```

## map where flatMap belonged

From chapter three, and the type tells you immediately if you look.

```ts twoslash
import { Effect } from 'effect'
declare const readFile: (path: string) => Effect.Effect<string>
declare const parse: (raw: string) => Effect.Effect<number>
// ---cut---
const wrong = Effect.map(readFile('port.txt'), parse)
//    ^?
```

An Effect inside an Effect. Run it and you get back a description of the work
rather than the number, and the inner program never runs at all.

If your function returns an Effect, use `flatMap`, or `yield*` it inside
`Effect.gen`.

## try and catch inside gen

From chapter four. `Effect.gen` looks like `async` and `await`, so people reach
for the tool that goes with it.

```ts twoslash
import { Effect, Schema } from 'effect'
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
declare const readFile: (path: string) => Effect.Effect<string, NotFound>
// ---cut---
const load = Effect.gen(function* () {
  try {
    return yield* readFile('port.txt')
  } catch {
    return 'default'
  }
})
```

The `catch` block never runs. I checked: an Effect failure goes to the `E`
channel and walks straight past `try` and `catch`, which only sees thrown
values.

Handle failures with the tools from chapter five.

```ts twoslash
import { Effect, Schema } from 'effect'
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
declare const readFile: (path: string) => Effect.Effect<string, NotFound>
// ---cut---
const load = readFile('port.txt').pipe(
  Effect.catchTag('NotFound', () => Effect.succeed('default')),
)
```

`try` and `finally` are still useful inside `gen` for ordinary throwing code.
They are just not how Effect failures are handled.

## One error type with a message inside

From chapter five. This looks tidy and it costs you everything the chapter was
about.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  message: Schema.String,
}) {}
```

Every failure is now the same type, so `catchTag` has nothing to discriminate
and the compiler cannot tell you which cases you have handled. Sooner or later
somebody writes `if (error.message.includes('404'))`, and that is string
matching on prose.

The test is chapter nine's retry function. If you cannot write "retry this one,
not that one" without reading a string, your errors are not separate enough.

Give each failure its own tag and the fields a handler needs.

## Catching everything, too early

From chapter five. `Effect.catch` at the bottom of a helper is the same mistake
as a bare `catch {}` in ordinary code.

```ts twoslash
import { Effect } from 'effect'
declare const load: Effect.Effect<number, 'NotFound' | 'BadFormat'>
// ---cut---
const port = load.pipe(Effect.catch(() => Effect.succeed(8080)))
//    ^?
```

The type says this cannot fail, which is now a lie the compiler will defend.
The caller cannot tell a missing file from a corrupt one, and cannot decide to
retry the one that is worth retrying.

Catch at the edge, where something has to become a screen or a response. In
between, let failures accumulate.

The same warning covers `Effect.orDie`. It is for failures you have genuinely
ruled out, not for making a red squiggle go away.

## Casting at the border

From chapter six. This is the habit the whole chapter exists to break.

```ts twoslash
declare const response: Response
// ---cut---
const products = (await response.json()) as Array<{ title: string }>
```

The cast checks nothing. It is a comment that the compiler happens to believe.
When the API renames a field you find out in a component, several layers away
from the cause, with an error about `undefined`.

Decode once, at the edge, and pass typed values inward.

A quieter version of the same mistake is decoding in the right place but
keeping the schema only for the fields you use today. That is fine, as long as
you remember the schema is a claim about what the server sends, and a
surprising `null` will now fail loudly rather than spread.

## A service for something that is not a dependency

From chapter seven. Once services click, everything looks like one.

```ts twoslash
import { Context, Effect } from 'effect'
// ---cut---
class Formatter extends Context.Service<Formatter, {
  currency(amount: number): Effect.Effect<string>
}>()('learning/Formatter') {}
```

Nothing in there needs swapping and nothing in there can fail. All this bought
you is `Formatter` in every `R` that touches money, plus a layer to provide in
every test.

It is a function. Write a function.

```ts twoslash
const currency = (amount: number) => `$${amount.toFixed(2)}`
```

Ask whether a test would rather not do this for real. Network, clock, database,
randomness, config, file system: yes. Formatting a number: no.

## Rebuilding the layer on every call

From chapter eight. This one is easy to write and hard to notice, because the
program is correct, only wasteful.

```ts twoslash
import { Context, Effect, Layer } from 'effect'
class Api extends Context.Service<Api, { readonly n: Effect.Effect<number> }>()('learning/Api') {
  static readonly layer = Layer.succeed(Api)(Api.of({ n: Effect.succeed(1) }))
}
// ---cut---
const call = () => Effect.runPromise(Api.use((api) => api.n).pipe(Effect.provide(Api.layer)))
```

Layers are shared within one build, not across builds. I measured it: calling
that three times builds the service three times. If building it opens a
connection, reads config, or starts something, you now do that per call.

Build the layer once, at the top, and run against it. In this app that is the
`ManagedRuntime` the demo page keeps in a `useMemo`, rebuilt only when the
chosen layer actually changes.

## Retrying because retrying sounds good

From chapter nine. Three versions of the same misunderstanding.

```ts twoslash
import { Effect, Schedule } from 'effect'
declare const call: Effect.Effect<number, { readonly _tag: 'ResponseError'; readonly status: number }>
// ---cut---
const everything = call.pipe(Effect.retry(Schedule.forever))
```

Retrying every failure means a 404 is asked four more times, and a body that
did not match the schema is decoded again with the same result. Retrying
forever turns a broken deploy into a self inflicted denial of service.
Retrying without jitter means every client in the fleet comes back at the same
instant.

A policy is three decisions: which failures, how long between, and when to stop.

```ts twoslash
import { Effect, Schedule } from 'effect'
declare const call: Effect.Effect<number, { readonly _tag: 'ResponseError'; readonly status: number }>
// ---cut---
const sensible = call.pipe(
  Effect.retry({
    schedule: Schedule.exponential('200 millis').pipe(
      Schedule.jittered,
      Schedule.upTo({ times: 3 }),
    ),
    while: (error) => error.status >= 500,
  }),
)
```

## Tests that only test the stub

From chapter ten. The test passes, and it proves nothing.

```ts twoslash
import { Context, Effect, Layer, Schema } from 'effect'
import { expect, test } from 'vitest'
class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', { detail: Schema.String }) {}
class Fetcher extends Context.Service<Fetcher, {
  request(url: string): Effect.Effect<Response, NetworkError>
}>()('learning/Fetcher') {}
const product = { id: 1, title: 'Backpack' }
declare const runWith: (
  fetcher: Layer.Layer<Fetcher>,
) => Promise<ReadonlyArray<{ title: string }>>
// ---cut---
const stub = Layer.succeed(Fetcher)(
  Fetcher.of({ request: () => Effect.succeed(Response.json([product])) }),
)

test('returns the product', async () => {
  const products = await runWith(stub)
  expect(products[0].title).toBe('Backpack')
})
```

You told the stub to say Backpack and then checked that it said Backpack. The
only real assertion hiding in there is that decoding worked.

Test the decisions instead: how many attempts a 500 causes, what a schema
mismatch does, which branch a 404 takes. And when the question is about the
request itself, the URL or the headers, a stub cannot answer it, so use MSW.

## The pattern behind the anti-patterns

Read them together and most are one habit: taking something out of the type
before you had to.

Running early removes the failure. `sync` removes the failure. Catching early
removes the failure. Casting removes the check. One big error type removes the
distinction. A service for a pure function adds a requirement that buys
nothing.

The types were the point. Keep the information in them for as long as you can,
and hand it over only at the edge, on purpose.

## The end

That is the course. Eleven chapters, one service that really runs, and a page
where you can break it on purpose.

If you keep one thing, keep this: the reason all of it works is that a program
is a value, and its failures and its dependencies are written down in the type.
Everything else, the retries, the stubs, the fake clock, the schema at the
border, follows from those two facts.

Now take the smallest thing in your own codebase that talks to a network, and
give it a schema and two named errors. Not a rewrite. One function. That is
enough to find out whether these ideas hold up in your work.

There is one bonus chapter after this one, on designing a program before you
write it. It only makes sense now that you know what the three channels are,
which is why it sits outside the numbered course.
