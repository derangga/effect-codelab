---
title: Implementing the handlers
order: 5
slug: 05-implementing-the-handlers
summary: HttpApiBuilder connects each endpoint to the repository, and the compiler reports any endpoint you forget.
---

The API description in `domain` declares two endpoints. The repository can
list and insert todos. Something must connect the two. When `GET /api/todos`
arrives, it must call `findAll`. When `POST /api/todos` arrives, it must call
`insert`. That connector is a **handler**, a function that answers one
endpoint. Each endpoint needs one.

In a typical Node server, a forgotten handler leaves a route that answers
`404`. Nobody notices until a user clicks the button. Here the compiler
reports a type error instead.

## The compiler keeps the checklist

`HttpApiBuilder.group` takes the API, a group name, and a function. That
function adds one handler for each endpoint in the group. Try it with only one
handler:

```ts twoslash
// @allowImportingTsExtensions
// @noEmit
// @errors: 2345
// @filename: node_modules/@todo/domain/Todo.ts
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
// @filename: node_modules/@todo/domain/TodosApi.ts
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { CreateTodoPayload, Todo, TodoPersistenceError } from "./Todo.ts"

export const TodosGroup = HttpApiGroup.make("todos")
  .add(
    HttpApiEndpoint.get("list", "/todos", {
      success: Schema.Array(Todo),
      error: TodoPersistenceError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/todos", {
      payload: CreateTodoPayload,
      success: Todo.pipe(HttpApiSchema.status(201)),
      error: TodoPersistenceError,
    }),
  )

export const TodosApi = HttpApi.make("TodosApi").add(TodosGroup).prefix("/api")
// @filename: node_modules/@todo/domain/index.ts
export * from "./Todo.ts"
export * from "./TodosApi.ts"
// @filename: apps/server/src/TodoRepo.ts
import { type CreateTodoPayload, Todo, TodoPersistenceError } from "@todo/domain"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

// SQLite has no boolean column, so the row stores completed as 0 | 1.
const TodoRow = Schema.Struct({ ...Todo.fields, completed: Schema.BooleanFromBit })

const toTodo = (row: typeof TodoRow.Type) => new Todo(row)

const selectColumns = "id, title, completed, created_at as createdAt"

export class TodoRepo extends Context.Service<TodoRepo>()("TodoRepo", {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const selectAll = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TodoRow,
      execute: () => sql`select ${sql.literal(selectColumns)} from todos order by created_at desc, id desc`,
    })

    const insertOne = SqlSchema.findOne({
      Request: Schema.Struct({ title: Schema.String, createdAt: Schema.DateTimeUtcFromString }),
      Result: TodoRow,
      execute: ({ title, createdAt }) =>
        sql`insert into todos ${sql.insert({ title, completed: 0, created_at: createdAt })} returning ${sql.literal(selectColumns)}`,
    })

    const findAll = Effect.fn("TodoRepo.findAll")(
      function* () {
        const rows = yield* selectAll(undefined)
        return rows.map(toTodo)
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            SqlError: (e) => Effect.fail(new TodoPersistenceError({ message: e.message })),
            // a row that fails to decode is our bug, not the caller's problem
            SchemaError: Effect.die,
          }),
        ),
    )

    const insert = Effect.fn("TodoRepo.insert")(
      function* (payload: CreateTodoPayload) {
        const createdAt = yield* DateTime.now
        const row = yield* insertOne({ title: payload.title, createdAt })
        return toTodo(row)
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            SqlError: (e) => Effect.fail(new TodoPersistenceError({ message: e.message })),
            // insert ... returning always yields one row; anything else is a bug
            SchemaError: Effect.die,
            NoSuchElementError: Effect.die,
          }),
        ),
    )

    return { findAll, insert }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: apps/server/src/Http.ts
// ---cut---
import { TodosApi } from "@todo/domain"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { TodoRepo } from "./TodoRepo.ts"

const TodosHandlers = HttpApiBuilder.group(
  TodosApi,
  "todos",
  Effect.fnUntraced(function* (handlers) {
    const repo = yield* TodoRepo
    return handlers.handle("list", () => repo.findAll())
  }),
)
```

Read the end of that error: `"Endpoint not handled: create"`. The description
declares a `create` endpoint, so the server cannot be built without a handler
for it. The full error is long, as errors about large generic types often are.
The useful part is always the last quoted string.

## Both handlers

Add the second one:

```ts
return handlers.handle("list", () => repo.findAll()).handle("create", ({ payload }) => repo.insert(payload))
```

Each handler does very little:

- `list` takes no input and returns whatever `findAll` returns.
- `create` receives `payload`, which is already decoded. The endpoint declared
  `payload: CreateTodoPayload`, so the title is trimmed and checked before this
  function runs. The type of `payload` is the schema's type, not `unknown`.
- Both return a `Todo` or fail with `TodoPersistenceError`. These are exactly
  the success and error types the endpoints declared. If you return anything
  else, such as a plain object without `createdAt`, you get a type error.

The handlers contain no `JSON.parse`, no `res.status(201)`, no validation, and
no route matching. The description handles all of that. A handler only connects
a request to the repository.

`Effect.fnUntraced` is `Effect.fn` without the tracing name. It is used here
because this function runs only once, when the server starts, to build the
handlers. That is also when `yield* TodoRepo` asks for the repository. Every
request after that reuses the same one.

## Stacking the layers

Here is `apps/server/src/Http.ts` in full:

```ts twoslash
// @allowImportingTsExtensions
// @noEmit
// @filename: node_modules/@todo/domain/Todo.ts
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
// @filename: node_modules/@todo/domain/TodosApi.ts
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { CreateTodoPayload, Todo, TodoPersistenceError } from "./Todo.ts"

export const TodosGroup = HttpApiGroup.make("todos")
  .add(
    HttpApiEndpoint.get("list", "/todos", {
      success: Schema.Array(Todo),
      error: TodoPersistenceError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/todos", {
      payload: CreateTodoPayload,
      success: Todo.pipe(HttpApiSchema.status(201)),
      error: TodoPersistenceError,
    }),
  )

export const TodosApi = HttpApi.make("TodosApi").add(TodosGroup).prefix("/api")
// @filename: node_modules/@todo/domain/index.ts
export * from "./Todo.ts"
export * from "./TodosApi.ts"
// @filename: apps/server/src/TodoRepo.ts
import { type CreateTodoPayload, Todo, TodoPersistenceError } from "@todo/domain"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

// SQLite has no boolean column, so the row stores completed as 0 | 1.
const TodoRow = Schema.Struct({ ...Todo.fields, completed: Schema.BooleanFromBit })

const toTodo = (row: typeof TodoRow.Type) => new Todo(row)

const selectColumns = "id, title, completed, created_at as createdAt"

export class TodoRepo extends Context.Service<TodoRepo>()("TodoRepo", {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const selectAll = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TodoRow,
      execute: () => sql`select ${sql.literal(selectColumns)} from todos order by created_at desc, id desc`,
    })

    const insertOne = SqlSchema.findOne({
      Request: Schema.Struct({ title: Schema.String, createdAt: Schema.DateTimeUtcFromString }),
      Result: TodoRow,
      execute: ({ title, createdAt }) =>
        sql`insert into todos ${sql.insert({ title, completed: 0, created_at: createdAt })} returning ${sql.literal(selectColumns)}`,
    })

    const findAll = Effect.fn("TodoRepo.findAll")(
      function* () {
        const rows = yield* selectAll(undefined)
        return rows.map(toTodo)
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            SqlError: (e) => Effect.fail(new TodoPersistenceError({ message: e.message })),
            // a row that fails to decode is our bug, not the caller's problem
            SchemaError: Effect.die,
          }),
        ),
    )

    const insert = Effect.fn("TodoRepo.insert")(
      function* (payload: CreateTodoPayload) {
        const createdAt = yield* DateTime.now
        const row = yield* insertOne({ title: payload.title, createdAt })
        return toTodo(row)
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            SqlError: (e) => Effect.fail(new TodoPersistenceError({ message: e.message })),
            // insert ... returning always yields one row; anything else is a bug
            SchemaError: Effect.die,
            NoSuchElementError: Effect.die,
          }),
        ),
    )

    return { findAll, insert }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
// @filename: apps/server/src/Http.ts
// ---cut---
// apps/server/src/Http.ts
import { TodosApi } from "@todo/domain"
import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { TodoRepo } from "./TodoRepo.ts"

const TodosHandlers = HttpApiBuilder.group(
  TodosApi,
  "todos",
  Effect.fnUntraced(function* (handlers) {
    const repo = yield* TodoRepo
    return handlers.handle("list", () => repo.findAll()).handle("create", ({ payload }) => repo.insert(payload))
  }),
).pipe(Layer.provide(TodoRepo.layer))

// Requires SqlClient; the entry point decides which database backs it.
export const ApiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(TodosApi, { openapiPath: "/api/openapi.json" }),
  HttpApiScalar.layer(TodosApi, { path: "/api/docs" }),
).pipe(Layer.provide(TodosHandlers))
```

`TodosHandlers` is a layer, and so is everything around it. It already carries
its own repository: the `Layer.provide(TodoRepo.layer)` on the end gives the
handlers the `TodoRepo` they ask for. Now read `ApiLayer` from the top:

- `HttpApiBuilder.layer(TodosApi, ...)` turns the description into real
  routes. It also serves the OpenAPI document at `/api/openapi.json`. Effect
  generates that document from the description, like the one you printed in
  [Declaring the API as a value](/learn/fullstack-monorepo/03-declaring-the-api).
- `HttpApiScalar.layer` adds a documentation page at `/api/docs`. It uses that
  same document, and you can read and try every endpoint in the browser.
- `Layer.mergeAll` puts those two side by side.
- `Layer.provide(TodosHandlers)` gives the routes their handlers.

In this picture, each line needs the one below it:

```
ApiLayer          routes + docs page
  TodosHandlers   list, create
    TodoRepo      findAll, insert
      SqlClient   not provided yet
```

`SqlClient` is missing on purpose. `ApiLayer` does not decide which database it
uses. [Serving it](/learn/fullstack-monorepo/06-serving-it) gives it the real
SQLite file. [Testing the API](/learn/fullstack-monorepo/07-testing-the-api)
gives it an in-memory one. The [Layers](/learn/layers) track covers this kind
of wiring in more depth.

## Check it works

```sh
cd apps/server
bun run typecheck
```

```
$ tsc -p tsconfig.json
```

That line is `bun` echoing the script. `tsc` printed nothing after it, so the
package compiles. Now test the checklist yourself. Delete the
`.handle("create", ...)` part and run the typecheck again. Look for
`Endpoint not handled: create` in the error. Put the code back before you move
on.

## What people get wrong

Validating the payload again. Other frameworks teach you to check
`payload.title.length` inside the handler. Here the endpoint's schema already
made that check, and the handler never runs for a bad payload. A second check
can drift away from the schema.

Asking for the repository inside every handler. Writing `yield* TodoRepo`
inside each handler also works. It hides the dependency inside the request
code. Ask once, at the top of the build function, so it is clear what the
handlers need.

Providing the database here. It is tempting to add `Layer.provide(SqlLayer)`
to `ApiLayer` and be done. Then a test cannot swap in a different database
without rebuilding the whole stack. Leave the choice of database to the entry
point.

## Next

Everything is wired except the last two pieces: a database and a port.
[Serving it](/learn/fullstack-monorepo/06-serving-it) adds both and makes the
first real request.
