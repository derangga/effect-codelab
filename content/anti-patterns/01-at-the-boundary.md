---
title: At the boundary
order: 1
slug: 01-at-the-boundary
summary: Running early, promising code cannot throw, and casting untrusted data. Three ways to throw the type away before you had to.
---

## Running the program too early

From [The Effect model](/learn/basic-effect/01-effect-model). An Effect is a
description of work, and this throws that away on the first line of the body.

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

The edge is wherever something that does not speak Effect calls in. That is a
click handler or a route in a browser app, and it is an HTTP request handler, a
queue consumer, a scheduled job, a CLI `main`, or a test written with plain `it`
instead of `it.effect`. Same idea either way: one place where the description
finally becomes work.

Everything inside that boundary hands back an Effect and lets the caller decide.
A `runPromise` in the middle of your code means a caller above it has lost the
type.

## Promising that code cannot throw

From [Constructing and composing Effects](/learn/basic-effect/02-composition).
`Effect.sync` and `Effect.promise` are promises you make to the compiler, and
it believes you.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
const parse = (raw: string) => Effect.sync(() => JSON.parse(raw) as unknown)
//    ^?
```

That says the parse cannot fail. `E` is `never`, so no caller handles a bad
string. When one arrives, `JSON.parse` throws, and the throw becomes a defect
that ends the fiber instead of a failure someone could recover from.

A throwing `Effect.sync` is not catchable with `Effect.catch`, only with
`Effect.catchDefect`. It skips right past your error handling.

Use `Effect.try` and name the failure. `Effect.promise` makes the same promise
about a rejection, and `Effect.tryPromise` is its fix.

```ts twoslash
import { Effect, Schema } from 'effect'
// ---cut---
class InvalidJson extends Schema.TaggedError<InvalidJson>()('InvalidJson', {
  detail: Schema.String,
}) {}

const parse = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new InvalidJson({ detail: String(cause) }),
  })
```

`E` is `InvalidJson` now, so a caller sees the failure in the type and decides
what it means. Keep in the error whatever tells somebody which input was bad.

## Casting at the border

From [Schemas and domain modeling](/learn/basic-effect/04-schemas), which
carries the short version of this. Here is the long one.

```ts twoslash
declare const response: Response
// ---cut---
const products = (await response.json()) as Array<{ title: string }>
```

The cast checks nothing. It is a comment that the compiler happens to believe.
When the API renames a field you find out in a component, several layers away
from the cause, with an error about `undefined`.

Decode once, at the edge, and pass typed values inward.

A quieter version is decoding in the right place with a schema that lists only
the fields you use today. That is fine, as long as you remember the schema is a
claim about what the server sends. When the server starts sending `null` for a
field you declared as a string, decoding fails at the edge and names the field,
instead of an `undefined` turning up three components later.
