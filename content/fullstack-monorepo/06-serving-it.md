---
title: Serving It
order: 6
slug: 06-serving-it
summary: One small main file picks the real database and the real port, starts the server, and you make your first requests with curl.
---

Every piece of the server exists, but none of it runs. `ApiLayer` still needs
a database, and nothing listens on a port yet. Those are the two choices that
depend on where the code runs: which SQLite file, which port. They belong in
one place, the entry point, so that nothing else in the server has to know.

## The main file

`apps/server/src/main.ts` is short:

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
// @filename: apps/server/src/main.ts
// ---cut---
// apps/server/src/main.ts
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Config, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { ApiLayer } from "./Http.ts"
import { SqlLayer } from "./Sql.ts"

const ServerLayer = BunHttpServer.layerConfig({
  port: Config.Int("PORT").pipe(Config.withDefault(3000)),
})

HttpRouter.serve(ApiLayer).pipe(
  Layer.provide(SqlLayer),
  Layer.provide(ServerLayer),
  Layer.launch,
  BunRuntime.runMain,
)
```

Line by line:

- `BunHttpServer.layerConfig` is the HTTP server that Bun provides, with its
  port read from the `PORT` environment variable, or `3000` if that is not set.
- `HttpRouter.serve(ApiLayer)` says "answer requests with these routes". It
  still needs a server to attach to.
- `Layer.provide(SqlLayer)` fills in the `SqlClient` that the last chapter left
  open, with the real SQLite file and its migrations.
- `Layer.provide(ServerLayer)` fills in the server.
- `Layer.launch` turns the finished layer into an effect that builds
  everything and then keeps running until it is told to stop.
- `BunRuntime.runMain` is where the program actually starts. It also listens
  for `Ctrl+C`, and when you press it, it shuts things down in reverse order:
  the server stops taking requests, then the database connection closes. You
  never write a shutdown hook, because every layer already knows how to clean
  up what it opened.

The whole program is now one stack of layers:

```
BunRuntime.runMain
  HttpRouter.serve      routes + docs page
    ApiLayer            handlers, TodoRepo
    SqlLayer            SQLite file + migrations
    ServerLayer         Bun HTTP server on PORT
```

Only this file knows about the port and the database file. The handlers and
the repository have no idea where they are running, which is exactly what the
test in the next chapter relies on.

## What happens on a request

Follow one `POST /api/todos` from the network to the disk:

```
curl sends {"title": "  buy milk  "}
  -> Bun server receives it
  -> HttpApi decodes the body with CreateTodoPayload
       title trimmed to "buy milk"          fails: 400, handler never runs
  -> create handler
  -> TodoRepo.insert
       reads the clock
       insert ... returning                  fails: TodoPersistenceError, 500
       row decoded into a Todo               fails: defect, logged, 500
  -> HttpApi encodes the Todo as JSON, status 201
```

Each "fails" line is a decision made in an earlier chapter, and each one ends
in a specific status code instead of a crash.

## Check it works

Start the server:

```sh
cd apps/server
bun run dev
```

```
[23:45:26.948] INFO (#2): Listening on http://[::]:3000
```

`bun --watch` restarts the server whenever you save a file, so leave it running.
Open a second terminal and add two todos. Notice the spaces in the first title:

```sh
curl -s -X POST localhost:3000/api/todos \
  -H 'content-type: application/json' \
  -d '{"title":"  buy milk  "}'

curl -s -X POST localhost:3000/api/todos \
  -H 'content-type: application/json' \
  -d '{"title":"write docs"}'
```

```
{"id":1,"title":"buy milk","completed":false,"createdAt":"2026-09-23T16:24:45.183Z"}
{"id":2,"title":"write docs","completed":false,"createdAt":"2026-09-23T16:24:45.193Z"}
```

The title came back trimmed, the id and time were filled in by the server, and
`createdAt` is a string again because that is how the schema encodes a date.
Now list them:

```sh
curl -s localhost:3000/api/todos
```

```
[{"id":2,"title":"write docs",...},{"id":1,"title":"buy milk",...}]
```

Newest first. Now send a title of only spaces, with `-i` to see the status:

```sh
curl -si -X POST localhost:3000/api/todos \
  -H 'content-type: application/json' \
  -d '{"title":"   "}'
```

```
HTTP/1.1 400 Bad Request
Content-Length: 0
```

The handler never ran. Look at the first terminal, where the server logged why:

```
INFO (#11) http.span=4ms: HttpApiSchemaError: Payload {
  [cause]: SchemaError: Expected a value with a length of at least 1
    at ["title"]
}
```

Finally, open [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
in a browser. That page was generated from the description in `domain`. You
can send requests from it too.

Stop the server with `Ctrl+C`. The todos are still in
`apps/server/data/todos.db`, and they will be there when you start it again,
because the migration only runs once.

## What people get wrong

**Starting the server from the wrong folder.** `data/todos.db` is relative to
the folder you start in. Run `bun src/main.ts` from `apps/server` and the file
lands in `apps/server/data`. Run it from the repository root and you get a
second, empty database in `./data`. The `bun run dev` script always runs inside
`apps/server`, which is one more reason to use it.

**Expecting an error message in the 400 body.** The response body is empty on
purpose. It tells the caller the request was bad without echoing their input
back. The details are in the server log, which is where you look while
developing.

**Curl answering with a web page.** If `curl localhost:3000/api/todos` prints
HTML instead of JSON, another program already owns port 3000, often another dev
server. [The React Page](/learn/fullstack-monorepo/09-the-react-page) explains
how to find it. Until then, start the server with `PORT=3100 bun run dev` and
curl that port.

**Forgetting the `/api` prefix.** `curl localhost:3000/todos` answers
`404 Not Found`. The prefix from [Declaring the API as a
Value](/learn/fullstack-monorepo/03-declaring-the-api) is part of every path.

## Next

The server works when you poke it by hand. [Testing the
API](/learn/fullstack-monorepo/07-testing-the-api) turns those curl commands
into a test that runs the real server against a throwaway database.
