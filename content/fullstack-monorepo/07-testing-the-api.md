---
title: Testing the API
order: 7
slug: 07-testing-the-api
summary: Run the real server in a test with an in-memory database, call it with a client made from the API description, and see why the tests run under Bun.
---

The curl commands in [Serving it](/learn/fullstack-monorepo/06-serving-it)
showed that the server works, once, on your machine. They do not run again when
someone changes the code next month. A test should do what curl did: start the
server, send real requests, and check the answers. It should do this without
touching the real database file.

## Same program, different parts

Look back at the stack from [Serving it](/learn/fullstack-monorepo/06-serving-it).
The handlers ask for a `SqlClient` and never say which one. `main.ts` gives them
the real database file. A test gives them something else:

```
production                          test
ApiLayer                            ApiLayer                    same
  SqlLayer    data/todos.db           SQLite ":memory:"         swapped
  ServerLayer Bun on PORT             BunHttpServer.layerTest   swapped
```

The routes, the handlers, and the repository are the same code in both. Only the
two layers at the bottom change. `":memory:"` is a SQLite database that lives
in memory. It is gone when the test ends. `BunHttpServer.layerTest` starts a
real server on a random free port. It also provides an HTTP client that already
points at that server.

In code, that is one value:

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
// @filename: apps/server/src/Sql.ts
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Config, Effect, FileSystem, Layer, Path } from "effect"
import { Migrator, SqlClient } from "effect/sql"

const migrations = Migrator.fromRecord({
  "0001_create_todos": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      create table todos (
        id integer primary key autoincrement,
        title text not null,
        completed integer not null default 0,
        created_at text not null
      )
    `
  }),
})

export const MigratorLayer = SqliteMigrator.layer({ loader: migrations })

const ClientLayer = Layer.unwrap(
  Effect.gen(function* () {
    const filename = yield* Config.String("DATABASE_PATH").pipe(Config.withDefault("data/todos.db"))
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true })
    return SqliteClient.layer({ filename })
  }),
)

export const SqlLayer = MigratorLayer.pipe(Layer.provideMerge(ClientLayer))
// @filename: apps/server/src/TodosApi.test.ts
import { BunHttpServer } from "@effect/platform-bun"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { ApiLayer } from "./Http.ts"
import { MigratorLayer } from "./Sql.ts"
// ---cut---
// Same graph as main.ts; only the database and the server behind R change.
const TestLayer = HttpRouter.serve(ApiLayer, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(MigratorLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))),
  Layer.provideMerge(BunHttpServer.layerTest),
)
```

The test layer reuses `MigratorLayer` from `Sql.ts`, so the test database gets
its table from the same migration as production. The `disableLogger` options
keep the test output quiet. The server uses `Layer.provideMerge` instead of
`Layer.provide`, so the HTTP client it creates stays available to the tests.

The "R" in the code comment is the third slot of `Effect<Success, Error,
Requirements>`. That slot lists what an effect needs before it can run. Swapping
what fills that slot is how you test with Effect.
[Swapping the graph](/learn/layers/08-swapping-the-graph) covers it in more
detail.

## The test file

[@effect/vitest](https://github.com/Effect-TS/effect) adds Effect helpers to
vitest. Two of them matter here:

- `layer(TestLayer)(name, ...)` builds the layer once for a group of tests
  and cleans it up when the group finishes.
- `it.effect(name, ...)` runs an effect as a test. The test passes when the
  effect succeeds.

Here is `apps/server/src/TodosApi.test.ts` in full:

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
// @filename: apps/server/src/Sql.ts
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Config, Effect, FileSystem, Layer, Path } from "effect"
import { Migrator, SqlClient } from "effect/sql"

const migrations = Migrator.fromRecord({
  "0001_create_todos": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      create table todos (
        id integer primary key autoincrement,
        title text not null,
        completed integer not null default 0,
        created_at text not null
      )
    `
  }),
})

export const MigratorLayer = SqliteMigrator.layer({ loader: migrations })

const ClientLayer = Layer.unwrap(
  Effect.gen(function* () {
    const filename = yield* Config.String("DATABASE_PATH").pipe(Config.withDefault("data/todos.db"))
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true })
    return SqliteClient.layer({ filename })
  }),
)

export const SqlLayer = MigratorLayer.pipe(Layer.provideMerge(ClientLayer))
// @filename: apps/server/src/TodosApi.test.ts
// ---cut---
// apps/server/src/TodosApi.test.ts
import { BunHttpServer } from "@effect/platform-bun"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { expect, layer } from "@effect/vitest"
import { TodosApi } from "@todo/domain"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { ApiLayer } from "./Http.ts"
import { MigratorLayer } from "./Sql.ts"

// Same graph as main.ts; only the database and the server behind R change.
const TestLayer = HttpRouter.serve(ApiLayer, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(MigratorLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))),
  Layer.provideMerge(BunHttpServer.layerTest),
)

layer(TestLayer)("TodosApi", (it) => {
  it.effect("creates todos and lists them newest first", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(TodosApi)

      const first = yield* client.todos.create({ payload: { title: "buy milk" } })
      const second = yield* client.todos.create({ payload: { title: "write docs" } })
      const todos = yield* client.todos.list()

      expect(first.title).toBe("buy milk")
      expect(first.completed).toBe(false)
      expect(todos.map((t) => t.id)).toEqual([second.id, first.id])
    }),
  )

  // Raw requests: the derived client refuses to encode untrimmed titles.
  const postTitle = (title: string) =>
    HttpClient.execute(HttpClientRequest.post("/api/todos").pipe(HttpClientRequest.bodyJsonUnsafe({ title })))

  it.effect("trims the title on the server", () =>
    Effect.gen(function* () {
      const response = yield* postTitle("  spaced  ")
      expect(response.status).toBe(201)
      expect(yield* response.json).toMatchObject({ title: "spaced" })
    }),
  )

  it.effect("rejects a blank title with 400", () =>
    Effect.gen(function* () {
      const response = yield* postTitle("   ")
      expect(response.status).toBe(400)
    }),
  )
})
```

The first test uses `HttpApiClient.make(TodosApi)`. It reads the same
description the server was built from and returns a typed client, with
`client.todos.create(...)` and `client.todos.list()`. The next chapter builds
the same kind of client for the browser. The test contains no URL. `first` is a real `Todo`, and
its `createdAt` is a real `DateTime` decoded from the JSON response.

The other two tests send a plain HTTP request instead, with a JSON body built by
hand. The code comment gives the reason. The typed client checks a payload
before it sends it, and `"  spaced  "` is not a valid title until the server
trims it. This is the "trimming only works one way" note from
[The todo in Schema](/learn/fullstack-monorepo/02-the-todo-in-schema). To test
how the server handles messy input, you must send that input without the typed
client.

## Check it works

```sh
cd apps/server
bun run test
```

```
$ bun --bun vitest run

 RUN  v5.0.3 /.../apps/server


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  11:46:59
   Duration  166ms (import 67%, transform 17%, tests 15%, worker 1%)
```

Three tests pass against a real HTTP server and a fresh database, in well under
a second. `bun run test` from the repository root runs them too.

## What people get wrong

The first mistake is running vitest with Node. The `test` script is
`bun --bun vitest run`, not `vitest run`. Vitest normally runs tests in Node.
The SQLite driver used here is built into Bun, so Node cannot load it:

```
Error: Only URLs with a scheme in: file, data, and node are supported by the
default ESM loader. Received protocol 'bun:'
```

`bun --bun` makes vitest itself run inside Bun, where `bun:sqlite` exists.

The second mistake is trusting the clock in tests. `it.effect` gives every test a
fake clock. The fake clock does not move unless the test moves it, which keeps
tests repeatable. It also means `DateTime.now` returns
`1970-01-01T00:00:00.000Z` for every todo in this file. Both todos get the same
`createdAt`. The list still comes back in the right order only because the query
sorts by `created_at desc, id desc`, and the id breaks the tie. Remove
`id desc` and the first test can fail.

The third mistake is expecting a fresh database for each test. The layer is
built once for the whole `layer(...)` group, so all three tests share one
in-memory database. The first test compares the full list of todos. It passes
only because it runs first, before the other tests add todos. When a test needs
an empty database, give it its own `layer(...)` group.

## Next

The server is done and tested. [The typed client](/learn/fullstack-monorepo/08-the-typed-client)
moves to the browser and builds the same kind of client for React.
