---
title: Testing the API
order: 7
slug: 07-testing-the-api
summary: Run the real server in a test with an in-memory database, call it through a client made from the description, and learn why the tests run under Bun.
---

The curl commands from the last chapter proved the server works, once, on
your machine. They do not run by themselves when someone changes the code next
month. A test should do the same thing curl did: start the server, send real
requests, check the answers. And it should do it without touching the real
database file.

## Same program, different parts

Look back at the stack from the last chapter. The handlers asked for a
`SqlClient` and never said which one. `main.ts` gave them the real file. A test
gives them something else:

```
production                          test
ApiLayer                            ApiLayer                    same
  SqlLayer    data/todos.db           SQLite ":memory:"         swapped
  ServerLayer Bun on PORT             BunHttpServer.layerTest   swapped
```

The routes, the handlers and the repository are the exact same code. Only the
two layers at the bottom change. `":memory:"` is a SQLite database that lives
in memory and is gone when the test ends. `BunHttpServer.layerTest` starts a
real server on a random free port, and also provides an HTTP client already
pointed at it.

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
// @filename: apps/server/src/Sql.ts
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Config, Effect, FileSystem, Layer, Path } from "effect"
import { Migrator, SqlClient } from "effect/unstable/sql"

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
import { HttpRouter } from "effect/unstable/http"
import { ApiLayer } from "./Http.ts"
import { MigratorLayer } from "./Sql.ts"
// ---cut---
// Same graph as main.ts; only the database and the server behind R change.
const TestLayer = HttpRouter.serve(ApiLayer, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provide(MigratorLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))),
  Layer.provideMerge(BunHttpServer.layerTest),
)
```

It reuses `MigratorLayer` from `Sql.ts`, so the test database gets its table
from the same migration as production. The `disableLogger` options keep the
test output quiet. `Layer.provideMerge` is used for the server, instead of
`Layer.provide`, so the HTTP client it creates stays available to the tests.

The "R" in the comment is the third slot in `Effect<Success, Error,
Requirements>`, the list of things an effect needs. Swapping what fills that
slot is the whole trick of testing with Effect, and [Swapping the
graph](/learn/layers/08-swapping-the-graph) shows it in more detail.

## The test file

[@effect/vitest](https://github.com/Effect-TS/effect) adds Effect helpers to
vitest. Two of them matter here:

- `layer(TestLayer)(name, ...)` builds the layer once for a group of tests,
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
// @filename: apps/server/src/Sql.ts
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Config, Effect, FileSystem, Layer, Path } from "effect"
import { Migrator, SqlClient } from "effect/unstable/sql"

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
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
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

The first test introduces the star of the next chapter.
`HttpApiClient.make(TodosApi)` reads the same description the server was built
from and gives back a typed client: `client.todos.create(...)` and
`client.todos.list()`. There is no URL in the test, and `first` is a real
`Todo` with a real `DateTime` in `createdAt`, decoded from the JSON response.

The other two tests use a plain HTTP request instead of the client, with the
JSON body built by hand. The comment says why: the typed client checks a
payload before sending it, and `"  spaced  "` is not a valid title until the
server trims it. That is the "trimming only works one way" note from [The
Todo in Schema](/learn/fullstack-monorepo/02-the-todo-in-schema). To test what
the server does with messy input, you have to send messy input past the
client.

## Check it works

```sh
cd apps/server
bun run test
```

```
 RUN  v5.0.1 /.../apps/server

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  163ms
```

Three tests, a real HTTP server, a fresh database, well under a second. From
the repository root, `bun run test` runs this too.

## What people get wrong

**Running vitest with Node.** The `test` script is `bun --bun vitest run`, not
`vitest run`. Vitest normally runs your tests in Node, and the SQLite driver
used here is built into Bun, so Node cannot load it:

```
Error: Only URLs with a scheme in: file, data, and node are supported by the
default ESM loader. Received protocol 'bun:'
```

`bun --bun` makes vitest itself run inside Bun, where `bun:sqlite` exists.

**Trusting the clock in tests.** `it.effect` gives every test a fake clock
that does not move unless the test moves it. That keeps tests repeatable, but
it means `DateTime.now` returns `1970-01-01T00:00:00.000Z` for every todo in
this file. Both todos get the same `createdAt`. The list still comes back in
the right order only because the query sorts by `created_at desc, id desc`,
and the id breaks the tie. Take away `id desc` and the first test can fail.

**Expecting a fresh database per test.** The layer is built once for the whole
`layer(...)` group, so all three tests share one in-memory database. The first
test checks the ids it created instead of the total count, so it passes no
matter which tests ran before it. When a test really needs an empty database,
give it its own `layer(...)` group.

## Next

The server is done and tested. [The Typed
Client](/learn/fullstack-monorepo/08-the-typed-client) moves to the browser
and builds the same kind of client for React.
