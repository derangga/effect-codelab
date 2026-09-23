---
title: The Todo in Schema
order: 2
slug: 02-the-todo-in-schema
summary: Describe a todo once, in the shared package, as something that is both a TypeScript type and a check that runs on real data.
---

A TypeScript type disappears when the code runs. You can write
`type Todo = { title: string }`, but when JSON arrives from the network,
nothing checks that `title` is really there, or really a string. The type is a
promise about the data, and nobody verifies the promise.

The server and the web page both need the promise kept. So the todo goes into
`packages/domain`, written as a **schema**: a description of data that is a
TypeScript type and a runtime check at the same time. You write the shape once
and get both. The [Schemas](/learn/basic-effect/04-schemas) chapter of Basic
Effect covers them in depth. Here we only need four pieces.

## An id that cannot be mixed up

Every todo gets a number as its id. A plain `number` would let you pass a page
number or a count where an id belongs, and TypeScript would not mind. A
**brand** fixes that. It is a label glued onto the type, so a `TodoId` is still
a number at runtime but TypeScript treats it as its own thing.

```ts twoslash
import { Schema } from "effect"
// ---cut---
// packages/domain/src/Todo.ts
export const TodoId = Schema.Int.pipe(Schema.brand("TodoId"))
export type TodoId = typeof TodoId.Type
//          ^?
```

`Schema.Int` checks that the value is a whole number. `Schema.brand` adds the
label. The second line pulls the TypeScript type out of the schema, so there is
no separate type to keep in sync.

## A title that cleans itself

A title typed into a form often comes with stray spaces, like `"  buy milk  "`.
It should also not be empty, and not a novel.

```ts twoslash
import { Schema } from "effect"
// ---cut---
export const TodoTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))
```

`Schema.Trim` removes spaces from both ends while reading the data. Then
`.check(...)` adds two rules on the cleaned text: at least one character, at
most two hundred. A title of only spaces becomes `""` after trimming, and the
first rule rejects it. Both rules run on the server when a request arrives, so
nobody can skip them.

## The todo itself

```ts twoslash
import { Schema } from "effect"
const TodoId = Schema.Int.pipe(Schema.brand("TodoId"))
const TodoTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))
// ---cut---
export class Todo extends Schema.Class<Todo>("Todo")({
  id: TodoId,
  title: TodoTitle,
  completed: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

type TodoOnTheWire = typeof Todo.Encoded
//   ^?
```

`Schema.Class` makes a real class, so a todo in your code is a `Todo` instance.
Every schema has two sides, and this is where you can see them.

- The **Type** side is what your code works with. `createdAt` is a proper date
  value from Effect's `DateTime` module.
- The **Encoded** side is what travels as JSON. `createdAt` is a plain string,
  like `"2026-09-23T16:24:45.183Z"`, because JSON has no date type.

`Schema.DateTimeUtcFromString` does the conversion both ways. Reading JSON
turns the string into a date, and sending JSON turns the date back into a
string. You never write that conversion yourself.

## What a request sends, and what can go wrong

Creating a todo only needs a title. The id and the timestamp come from the
server.

```ts twoslash
import { Schema } from "effect"
const TodoTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))
// ---cut---
export const CreateTodoPayload = Schema.Struct({ title: TodoTitle })
export type CreateTodoPayload = typeof CreateTodoPayload.Type
```

It reuses `TodoTitle`, so the rules for a title live in exactly one place.

The last piece is an error the server can return when the database fails:

```ts twoslash
import { Schema } from "effect"
// ---cut---
export class TodoPersistenceError extends Schema.TaggedError<TodoPersistenceError>()(
  "TodoPersistenceError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
```

`Schema.TaggedError` creates an error class with a `_tag` field set to
`"TodoPersistenceError"`. The tag is how code tells one error from another
without `instanceof`. Because it is a schema, the error can be sent as JSON and
rebuilt on the other side, so the browser receives the same typed error the
server raised. `httpApiStatus: 500` is the HTTP status to use when it happens.
It does nothing yet. The next chapter reads it.

## The whole file

Put the four pieces together in `packages/domain/src/Todo.ts`:

```ts twoslash
// packages/domain/src/Todo.ts
import { Schema } from "effect"

export const TodoId = Schema.Int.pipe(Schema.brand("TodoId"))
export type TodoId = typeof TodoId.Type

export const TodoTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))

export class Todo extends Schema.Class<Todo>("Todo")({
  id: TodoId,
  title: TodoTitle,
  completed: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export const CreateTodoPayload = Schema.Struct({ title: TodoTitle })
export type CreateTodoPayload = typeof CreateTodoPayload.Type

export class TodoPersistenceError extends Schema.TaggedError<TodoPersistenceError>()(
  "TodoPersistenceError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
```

And make `packages/domain/src/index.ts` export it, replacing the throwaway line
from last chapter:

```ts
// packages/domain/src/index.ts
export * from "./Todo.ts"
```

## Check it works

Make a scratch file, `packages/domain/try.ts`, and feed the payload schema some
real input:

```ts
// packages/domain/try.ts
import { Schema } from "effect"
import { CreateTodoPayload } from "./src/index.ts"

console.log(Schema.decodeUnknownSync(CreateTodoPayload)({ title: "  buy milk  " }))

try {
  Schema.decodeUnknownSync(CreateTodoPayload)({ title: "   " })
} catch (error) {
  console.log(String(error))
}
```

**Decoding** means reading unknown data through a schema: check it, clean it,
and hand back the typed value. Run it:

```sh
cd packages/domain
bun try.ts
```

```
{
  title: "buy milk",
}
SchemaError(Expected a value with a length of at least 1
  at ["title"])
```

The spaces are gone from the first title, and the blank one is rejected with a
message that says which field failed and why. Delete `try.ts` and run
`bun run typecheck` to confirm the package is clean.

## What people get wrong

**Trimming only works one way.** `Schema.Trim` cleans text while decoding,
when data comes *in*. When data goes *out*, called **encoding**, it expects
text that is already clean, and it refuses anything else:

```ts
Schema.encodeSync(CreateTodoPayload)({ title: "  buy milk  " })
// SchemaError(Expected a string with no leading or trailing whitespace
//   at ["title"])
```

This looks like a detail now. It comes back in [the React
page](/learn/fullstack-monorepo/09-the-react-page), because the typed client
encodes before it sends, and a title straight from an input box has spaces in
it.

**Writing the type by hand next to the schema.** A separate
`type Todo = { ... }` compiles fine and slowly drifts from the schema. Always
take the type from the schema with `typeof X.Type`.

## Next

There is a todo. [Declaring the API as a
Value](/learn/fullstack-monorepo/03-declaring-the-api) describes the two
endpoints that carry it, still inside `domain`, still without a server.
