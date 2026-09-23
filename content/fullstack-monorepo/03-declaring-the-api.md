---
title: Declaring the API as a Value
order: 3
slug: 03-declaring-the-api
summary: HttpApiEndpoint, HttpApiGroup and HttpApi describe both endpoints as plain data in the shared package, before any server exists.
---

In most backends the list of routes only exists inside the server. You call
`app.get("/todos", handler)` and the route is born together with its code. The
frontend then writes its own copy: the same path, the same method, the same
response type, typed out again by hand. Three things that can each be wrong on
their own.

Effect flips the order. You first describe the API as a plain value, a bit
like a table of contents. The description holds the path, the method, what the
request carries and what comes back. It lives in `packages/domain`, so the
server and the web page both read the same one.

## One endpoint

Start with listing todos.

```ts twoslash
import { Schema } from "effect"
class Todo extends Schema.Class<Todo>("Todo")({ title: Schema.String }) {}
class TodoPersistenceError extends Schema.TaggedError<TodoPersistenceError>()("TodoPersistenceError", {
  message: Schema.String,
}) {}
// ---cut---
import { HttpApiEndpoint } from "effect/unstable/httpapi"

const list = HttpApiEndpoint.get("list", "/todos", {
  success: Schema.Array(Todo),
  error: TodoPersistenceError,
})
```

Read it out loud: an endpoint named `list`, answering `GET /todos`, that
succeeds with an array of todos and may fail with a `TodoPersistenceError`.

The `success` and `error` are the schemas from the last chapter, not types.
That is what makes the rest of this track work. The server will use them to
turn its values into JSON, and the client will use them to check the JSON it
gets back.

The failure is part of the description too. In plain TypeScript an API's
errors are whatever the code happens to throw. Here the endpoint says up front
which errors it can return, and the `httpApiStatus: 500` on
`TodoPersistenceError` picks the status code. The
[Errors](/learn/basic-effect/03-typed-errors) chapter explains why Effect keeps
failures in the type, and this is the same idea applied to HTTP.

## An endpoint with a body

Creating a todo takes a body and answers with the new todo:

```ts twoslash
import { Schema } from "effect"
class Todo extends Schema.Class<Todo>("Todo")({ title: Schema.String }) {}
const CreateTodoPayload = Schema.Struct({ title: Schema.String })
class TodoPersistenceError extends Schema.TaggedError<TodoPersistenceError>()("TodoPersistenceError", {
  message: Schema.String,
}) {}
// ---cut---
import { HttpApiEndpoint, HttpApiSchema } from "effect/unstable/httpapi"

const create = HttpApiEndpoint.post("create", "/todos", {
  payload: CreateTodoPayload,
  success: Todo.pipe(HttpApiSchema.status(201)),
  error: TodoPersistenceError,
})
```

`payload` is the request body. When a request arrives, the server decodes the
body with `CreateTodoPayload` before your code sees it. So the title is already
trimmed and checked by the time any of your code runs, and a bad title is
turned away with a `400 Bad Request` automatically.

`HttpApiSchema.status(201)` changes the success status from the default `200`
to `201 Created`, the usual answer when something new was made.

## Grouping and naming the API

Endpoints go into a **group**, and groups go into the **API**:

```ts
const TodosGroup = HttpApiGroup.make("todos").add(list).add(create)
const TodosApi = HttpApi.make("TodosApi").add(TodosGroup).prefix("/api")
```

The group name, `todos`, becomes part of how you call it later. On the client
it will be `client.todos.list()` and `client.todos.create(...)`. The
`.prefix("/api")` puts every path under `/api`, so the real URLs are
`/api/todos`. That prefix will make the browser setup simple in the last
chapter, because everything under `/api` can be sent to the server in one rule.

## The whole file

Here is `packages/domain/src/TodosApi.ts` in full, importing from the file you
wrote last chapter:

```ts twoslash
// @allowImportingTsExtensions
// @noEmit
// @filename: packages/domain/src/Todo.ts
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
// @filename: packages/domain/src/TodosApi.ts
// ---cut---
// packages/domain/src/TodosApi.ts
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
```

And add it to `packages/domain/src/index.ts`:

```ts
// packages/domain/src/index.ts
export * from "./Todo.ts"
export * from "./TodosApi.ts"
```

That is the whole shared package. Two files, and no code that runs on its own.

## What the description already gives you

Nothing answers requests yet, but this value is already enough for three
things:

- **API documentation.** An OpenAPI document (the standard JSON format that
  API tools read) can be generated from it, since it knows every path, body
  and response.
- **A client.** The web page will get a typed function per endpoint from it.
- **A checklist for the server.** The server will have to provide a handler
  for `list` and for `create`, and TypeScript will refuse to compile until it
  does.

## Check it works

You can see the first one right now. Make `packages/domain/try.ts`:

```ts
// packages/domain/try.ts
import { OpenApi } from "effect/unstable/httpapi"
import { TodosApi } from "./src/index.ts"

const spec = OpenApi.fromApi(TodosApi)
for (const [path, methods] of Object.entries(spec.paths)) {
  console.log(path, Object.keys(methods))
}
```

```sh
cd packages/domain
bun try.ts
```

```
/api/todos [ "get", "post" ]
```

One path, two methods, generated entirely from the description. Delete
`try.ts` and run `bun run typecheck` once more.

## What people get wrong

**Putting handler code in the shared package.** It is tempting to write the
handlers right next to the endpoints. Don't. The web page imports
`packages/domain`, and anything in it ends up in the browser bundle. If
`domain` imported the database driver, Vite would try to bundle SQLite into a
web page. Keep `domain` to schemas and descriptions only.

**Forgetting the prefix is part of the path.** After `.prefix("/api")` the
list endpoint is `GET /api/todos`, not `GET /todos`. When you test with `curl`
later, include the `/api`.

## Next

The description says what a todo looks like and how to ask for one. Something
has to actually store them. [The Repo Over
Sqlite](/learn/fullstack-monorepo/04-the-repo-over-sqlite) starts the server
with a database and a small service that hides it.
