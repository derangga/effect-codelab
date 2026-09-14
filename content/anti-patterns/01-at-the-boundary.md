---
title: At the boundary
order: 1
slug: 01-at-the-boundary
summary: Running early, promising code cannot throw, and casting untrusted data. Three ways to throw the type away before you had to.
---

## Running the program too early

From [The Effect model](/learn/basic-effect/01-effect-model). The whole idea is
that an Effect is a description, and this throws that away on the first line.

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

From [Constructing and composing Effects](/learn/basic-effect/02-composition).
`Effect.sync` and `Effect.promise` are promises you make to the compiler, and
it believes you.

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

`E` is `InvalidJson` now, so a caller can see the failure and decide what it
means. The fields are the ones a handler would want: keep whatever tells
somebody which input was bad.

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

A quieter version of the same mistake is decoding in the right place but
keeping the schema only for the fields you use today. That is fine, as long as
you remember the schema is a claim about what the server sends, and a
surprising `null` will now fail loudly rather than spread.
