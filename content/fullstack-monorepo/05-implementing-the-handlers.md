---
title: Implementing the Handlers
order: 5
slug: 05-implementing-the-handlers
summary: HttpApiBuilder connects each declared endpoint to the repository, and the compiler will not let you forget one.
---

The API description in `domain` says there are two endpoints. The repository
knows how to list and insert todos. Something has to connect the two: when
`GET /api/todos` arrives, call `findAll`, and when `POST /api/todos` arrives,
call `insert`. That something is a **handler**, one per endpoint.

In a typical Node server, forgetting a handler means a route that answers
`404` and nobody notices until a user clicks the button. Here it is a type
error.

## The compiler keeps the checklist

`HttpApiBuilder.group` takes the API, the name of a group, and a function that
adds a handler for each endpoint in it. Try it with only one handler:

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
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
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
import { SqlClient, SqlSchema } from "effect/unstable/sql"

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
import { HttpApiBuilder } from "effect/unstable/httpapi"
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
said there is a `create` endpoint, so the server cannot be built without one.
The error is long, like most errors about big generic types, but the useful
part is always that last quoted string.

## Both handlers

Add the second one:

```ts
return handlers.handle("list", () => repo.findAll()).handle("create", ({ payload }) => repo.insert(payload))
```

Look at how little each handler does.

- `list` takes no input and returns whatever `findAll` returns.
- `create` receives `payload`, which is already decoded. The title is trimmed
  and checked before this function runs, because the endpoint declared
  `payload: CreateTodoPayload`. Its type is the schema's type, not `unknown`.
- Both return a `Todo` or fail with `TodoPersistenceError`, and those are
  exactly the success and error the endpoints declared. Return anything else,
  a plain object missing `createdAt` for example, and it is a type error.

There is no `JSON.parse`, no `res.status(201)`, no validation, and no route
matching. The description handles all of it. The handler only connects a
request to the repository.

`Effect.fnUntraced` is `Effect.fn` without the tracing name. It is used here
because this function only runs once, when the server starts, to build the
handlers. That is also when `yield* TodoRepo` asks for the repository. Every
request after that reuses the same one.

## Stacking the layers

Now `apps/server/src/Http.ts` in full:

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
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
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
import { SqlClient, SqlSchema } from "effect/unstable/sql"

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
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi"
import { TodoRepo } from "./TodoRepo.ts"

const TodosHandlers = HttpApiBuilder.group(
  TodosApi,
  "todos",
  Effect.fnUntraced(function* (handlers) {
    const repo = yield* TodoRepo
    return handlers.handle("list", () => repo.findAll()).handle("create", ({ payload }) => repo.insert(payload))
  }),
)

// Requires SqlClient; the entry point decides which database backs it.
export const ApiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(TodosApi, { openapiPath: "/api/openapi.json" }),
  HttpApiScalar.layer(TodosApi, { path: "/api/docs" }),
).pipe(Layer.provide(TodosHandlers), Layer.provide(TodoRepo.layer))
```

`TodosHandlers` is a layer, and so is everything around it. Reading
`ApiLayer` from the top:

- `HttpApiBuilder.layer(TodosApi, ...)` turns the description into real
  routes. It also serves the OpenAPI document at `/api/openapi.json`, generated
  from the description like the one you printed two chapters ago.
- `HttpApiScalar.layer` adds a documentation page at `/api/docs`, built from
  that same document, where you can read and try every endpoint in the
  browser.
- `Layer.mergeAll` puts those two side by side.
- `Layer.provide(TodosHandlers)` gives the routes their handlers.
- `Layer.provide(TodoRepo.layer)` gives the handlers their repository.

As a picture, each line needs the one below it:

```
ApiLayer          routes + docs page
  TodosHandlers   list, create
    TodoRepo      findAll, insert
      SqlClient   not provided yet
```

`SqlClient` is missing on purpose. `ApiLayer` does not decide which database it
talks to. The next chapter hands it the real SQLite file, and the test chapter
hands it an in-memory one. The [Layers](/learn/layers) track is all about this
kind of wiring if you want to go deeper.

## Check it works

```sh
cd apps/server
bun run typecheck
```

No output means it compiles. Then prove the checklist to yourself: delete the
`.handle("create", ...)` part, run the typecheck again, and look for
`Endpoint not handled: create` in the error. Put it back before moving on.

## What people get wrong

**Validating the payload again.** It is a habit from other frameworks to check
`payload.title.length` inside the handler. The endpoint's schema already did
it, and the handler never runs for a bad payload. A second check is code that
can drift from the schema.

**Asking for the repository inside every handler.** Writing
`yield* TodoRepo` inside each handler works too, but it hides the dependency
inside the request code. Asking once, at the top of the build function, makes
it obvious what the handlers need.

**Providing the database here.** It is tempting to add
`Layer.provide(SqlLayer)` to `ApiLayer` and be done. Then a test can no longer
swap in a different database without rebuilding the whole stack. Leave the
real-world choices to the entry point.

## Next

Everything is wired except the last two pieces: a database and a port.
[Serving It](/learn/fullstack-monorepo/06-serving-it) adds both and makes the
first real request.
