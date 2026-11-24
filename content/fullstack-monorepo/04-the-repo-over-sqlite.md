---
title: The repo over SQLite
order: 4
slug: 04-the-repo-over-sqlite
summary: A SQLite connection built from config, one migration that creates the table, and a TodoRepo service, so nothing else in the server knows a database exists.
---

The handler for `POST /api/todos` must save a todo. The quick way is to write
the SQL inside the handler. That works until a second handler needs the same
query. It also breaks when a test must run the handler without a real database
file. And you cannot see every query the app makes in one place.

So the SQL goes behind a **repository**. A repository is an object with named
methods, here `findAll` and `insert`, that hides the database from the rest of
the server. This chapter builds the connection, the table, and the repository.
All of it lives in `apps/server/src`.

## Three Effect words first

The server code uses three Effect ideas all the time. Each gets one sentence
here. The [Basic Effect](/learn/basic-effect) track has the full version.

- An **effect** is a description of work that has not run yet. Its type,
  `Effect<Success, Error, Requirements>`, shows what it produces, how it can
  fail, and what it needs before it can run.
- A **service** is something the app needs, such as the database or the todo
  repository, that code asks for by name.
- A **layer** is a recipe that builds a service. A test can swap in a different
  layer to get a different database.

`Effect.gen` lets you write the steps of an effect one after another, like
normal code. Inside it, `yield*` means "run this effect and give me its result".

## The connection and the table

Start with `apps/server/src/Sql.ts`. It has two jobs: open the SQLite file, and
make sure the `todos` table exists.

A **migration** is a numbered change to the database, such as "create the todos
table". Each migration runs once. The migrator records which ones already ran in
a table of its own. Say you add `0002_add_due_date` next week. Only that
migration runs on the existing database. This is why you use migrations instead
of `CREATE TABLE IF NOT EXISTS` at startup. The second change to the table has a
place to go.

```ts twoslash
// apps/server/src/Sql.ts
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
```

Read the code from the top:

- `sql` is a service too. `yield* SqlClient.SqlClient` asks for it. A query
  written as ``sql`...` `` is safe against SQL injection. Any value you put in
  `${}` is sent separately from the SQL text, never pasted into it.
- SQLite has no true/false column type, so `completed` is stored as `0` or `1`.
  The repository turns it back into a boolean.
- `Config.String("DATABASE_PATH")` reads an environment variable, with a default
  for when it is not set. This is the Effect version of `process.env`. When a
  value is missing or malformed, it fails with a clear error instead of giving
  you `undefined`.
- `fs.makeDirectory` creates the `data/` folder. SQLite creates the database
  file, but not the folders around it.
- `Layer.unwrap` means "run this effect, and use the layer it returns as the
  real layer". It lets the SQLite layer depend on a config value that is only
  known at startup.
- `SqlLayer` joins the two: it opens the database, then runs the migrations on
  it. `Layer.provideMerge` feeds the connection into the migrator. It also keeps
  the connection available to everything built on top.

## Rows are untrusted data

To TypeScript, a row from the database is just an object. Nothing proves that
`title` is a string or that `completed` is `0` or `1`. This is the same problem
as JSON from the network, and it has the same answer: decode it with a schema.

`SqlSchema` pairs a query with a schema for its result. Here is the list query
on its own, so you can see its type:

```ts twoslash
import { Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
const Todo = Schema.Struct({ id: Schema.Int, title: Schema.String })
declare const sql: SqlClient.SqlClient
// ---cut---
const TodoRow = Schema.Struct({ ...Todo.fields, completed: Schema.BooleanFromBit })

const selectAll = SqlSchema.findAll({ Request: Schema.Void, Result: TodoRow, execute: () => sql`select * from todos` })

const rows = selectAll(undefined)
//    ^?
```

`TodoRow` is the `Todo` schema with one field swapped. `Schema.BooleanFromBit`
reads `0` and `1` from the database as `false` and `true`. The other fields come
straight from `Todo.fields`, so the row shape always matches the todo.

Now read the type. Its middle part, `SqlError | SchemaError`, lists the two ways
this can fail: the database breaks, or a row does not match the schema.
TypeScript knows both. Nobody had to write a comment saying "may throw".

## The repository

Now `apps/server/src/TodoRepo.ts`. It is a service with a `make` effect that
builds the two methods, and a `layer` that the rest of the app uses.

```ts twoslash
// @allowImportingTsExtensions
// @noEmit
// @filename: node_modules/@todo/domain/index.ts
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
// @filename: apps/server/src/TodoRepo.ts
// ---cut---
// apps/server/src/TodoRepo.ts
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
```

These details are worth a closer look.

The query aliases a column. The database column is `created_at`, but the `Todo`
schema calls it `createdAt`. Writing `created_at as createdAt` in the select
renames it on the way out, so the row fits the schema as is. Both queries need
the same column list, so it lives in `selectColumns`. `sql.literal` pastes it
into the query as plain SQL text. This is the one place where text goes into the
query unescaped. Only give `sql.literal` a fixed string you wrote yourself,
never anything from a user.

`insert ... returning` saves the row and reads it back in one query, so the todo
you return has the id that SQLite just assigned. `SqlSchema.findOne` expects
exactly one row. It fails with `NoSuchElementError` if there is none.

The server sets the time. `DateTime.now` reads the clock. The browser never
sends `createdAt`, so a user cannot make a todo that claims to be from last year.

`Effect.fn` builds a named function that returns an effect, and here it takes two
functions. The first holds the happy path, the steps that run when everything
works. The second receives that effect and decides what happens to each failure.
Keeping them apart lets you read the first function top to bottom without
stepping over error handling. `Effect.fn` also gives the step a name,
`"TodoRepo.insert"`, that shows up in traces, which are records of what the
program ran.

Each failure gets a decision. `Effect.catchTags` looks at the `_tag` of the
error and picks a handler:

- `SqlError` becomes `TodoPersistenceError`, the error the API declared. Code
  above the repository never sees a raw database error.
- `SchemaError` and `NoSuchElementError` become defects with `Effect.die`. A
  **defect** is a failure that means the program itself is wrong. An example is
  a row from our own table that does not match our own schema. A caller cannot
  do anything sensible about it, so it stays out of the error type. The request
  fails and the server logs it.

Here is what a caller of the repository sees:

```ts twoslash
// @allowImportingTsExtensions
// @noEmit
// @filename: node_modules/@todo/domain/index.ts
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
// @filename: apps/server/src/try.ts
import { Effect } from "effect"
import { TodoRepo } from "./TodoRepo.ts"
// ---cut---
const program = Effect.gen(function* () { const repo = yield* TodoRepo; return yield* repo.insert({ title: "buy milk" }) })
//    ^?
```

The type says three things. The program returns a `Todo` if it works. It fails
with a `TodoPersistenceError` if it does not. It needs a `TodoRepo` to run. No
SQL appears anywhere in that type.

## Check it works

There is no HTTP server yet, but you can run the repository directly against an
in-memory database. Create `apps/server/try.ts`:

```ts
// apps/server/try.ts
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { MigratorLayer } from "./src/Sql.ts"
import { TodoRepo } from "./src/TodoRepo.ts"

const TestSql = MigratorLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))

const program = Effect.gen(function* () {
  const repo = yield* TodoRepo
  yield* repo.insert({ title: "buy milk" })
  yield* repo.insert({ title: "write docs" })
  const todos = yield* repo.findAll()
  yield* Effect.log(todos.map((todo) => todo.title))
})

program.pipe(Effect.provide(TodoRepo.layer.pipe(Layer.provide(TestSql))), Effect.runPromise)
```

`":memory:"` asks SQLite for a database that lives in memory and disappears when
the program ends. The migrator still runs on it, so the table exists.
`Effect.provide` hands the layers to the program. `Effect.runPromise` is the
point where the program finally runs.

```sh
cd apps/server
bun try.ts
```

```
[23:45:43.051] INFO (#1): [ "write docs", "buy milk" ]
```

The newest todo comes first, as the `order by` asked. Delete `try.ts`, then run
`bun run typecheck`.

## What people get wrong

Lowercase config names. `Config.string` and `Config.int` do not exist in Effect
v4. They are `Config.String` and `Config.Int`, with a capital first letter.

Letting `SqlError` escape. If the repository returned `SqlError` as is, every
handler, and eventually the browser, would have to know about database errors.
Turn it into your own error at the edge of the repository, where you still know
what the query was for.

Expecting the folder to exist. If `DATABASE_PATH` points at a folder that is not
there, SQLite fails at startup with an "unable to open database file" error.
That is why the code has the `makeDirectory` line.

## Next

The server now has somewhere to keep todos.
[Implementing the handlers](/learn/fullstack-monorepo/05-implementing-the-handlers)
connects the API description from `domain` to this repository.
