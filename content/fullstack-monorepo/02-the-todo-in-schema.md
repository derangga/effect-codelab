---
title: The todo in Schema
order: 2
slug: 02-the-todo-in-schema
summary: Describe a todo once, in the shared package, as something that is both a TypeScript type and a check that runs on real data.
---

A TypeScript type disappears when the code runs. You can write
`type Todo = { title: string }`. But when JSON arrives from the network, nothing
checks that `title` is there, or that it is a string. The type is a promise
about the data, and nobody verifies it.

The server and the web page both need that promise kept. So the todo goes into
`packages/domain`, written as a **schema**. A schema is a description of data
that works as a TypeScript type and as a check on real data. You write the shape
once and get both. The [Schemas and domain
modeling](/learn/basic-effect/04-schemas) chapter of Basic Effect covers them in
depth. Here you need only four pieces.

## An id that cannot be mixed up

Every todo gets a number as its id. With a plain `number`, you could pass a page
number or a count where an id belongs, and TypeScript would not complain. A
**brand** fixes that. It is a label attached to a type, so TypeScript treats
`TodoId` as its own type. When the code runs, it is still a number.

```ts twoslash
import { Schema } from "effect"
// ---cut---
// packages/domain/src/Todo.ts
export const TodoId = Schema.Int.pipe(Schema.brand("TodoId"))
export type TodoId = typeof TodoId.Type
//          ^?
```

`Schema.Int` checks that the value is a whole number. `Schema.brand` adds the
label. The second line takes the TypeScript type from the schema, so there is no
separate type to keep in sync.

## A title that cleans itself

A title typed into a form often has stray spaces, like `"  buy milk  "`. It
should not be empty, and it should not be very long.

```ts twoslash
import { Schema } from "effect"
// ---cut---
export const TodoTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))
```

`Schema.Trim` removes spaces from both ends while it reads the data. Then
`.check(...)` adds two rules for the cleaned text: at least one character, and
at most 200. A title of only spaces becomes `""` after trimming, so the first
rule rejects it. Both rules run on the server when a request arrives, so nobody
can skip them.

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
Every schema has two sides, and this code shows both.

- The **Type** side is what your code works with. `createdAt` is a date value
  from Effect's `DateTime` module.
- The **Encoded** side is what travels as JSON. `createdAt` is a plain string,
  like `"2026-09-23T16:24:45.183Z"`, because JSON has no date type.

`Schema.DateTimeUtcFromString` converts in both directions. Reading JSON turns
the string into a date. Sending JSON turns the date back into a string. You
never write that conversion yourself.

## What a request sends, and what can go wrong

Creating a todo needs only a title. The server provides the id and the
timestamp.

```ts twoslash
import { Schema } from "effect"
const TodoTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))
// ---cut---
export const CreateTodoPayload = Schema.Struct({ title: TodoTitle })
export type CreateTodoPayload = typeof CreateTodoPayload.Type
```

It reuses `TodoTitle`, so the rules for a title live in one place.

The last piece is an error that the server can return when the database fails:

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
`"TodoPersistenceError"`. The tag lets code tell one error from another without
`instanceof`. Because the error is a schema, it can be sent as JSON and rebuilt
on the other side. The browser then receives the same typed error that the
server raised. `httpApiStatus: 500` is the HTTP status to use when the error
happens. It does nothing yet. [Declaring the API as a
value](/learn/fullstack-monorepo/03-declaring-the-api) reads it.

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

Then make `packages/domain/src/index.ts` export it. This replaces the throwaway
line from [The workspace shape](/learn/fullstack-monorepo/01-the-workspace-shape):

```ts
// packages/domain/src/index.ts
export * from "./Todo.ts"
```

## Check it works

Make a scratch file, `packages/domain/try.ts`, and give the payload schema some
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

**Decoding** means reading unknown data through a schema. It checks the data,
cleans it, and returns the typed value. Run it:

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

The first title has lost its spaces. The blank one is rejected, with a message
that says which field failed and why. Delete `try.ts`, then run
`bun run typecheck` to confirm the package is clean.

## What people get wrong

Trimming works in one direction only. `Schema.Trim` cleans text while decoding,
when data comes in. When data goes out, that step is called **encoding**.
Encoding expects text that is already clean, and it refuses anything else:

```ts
Schema.encodeSync(CreateTodoPayload)({ title: "  buy milk  " })
// SchemaError(Expected a string with no leading or trailing whitespace
//   at ["title"])
```

This looks like a small detail now. It comes back in [The React
page](/learn/fullstack-monorepo/09-the-react-page). The typed client encodes
before it sends, and a title straight from an input box has spaces in it.

Writing the type by hand next to the schema also causes trouble. A separate
`type Todo = { ... }` compiles fine and slowly drifts from the schema. Always
take the type from the schema with `typeof X.Type`.

## Next

There is now a todo. [Declaring the API as a
value](/learn/fullstack-monorepo/03-declaring-the-api) describes the two
endpoints that carry it. It still lives in `domain`, and there is still no
server.
