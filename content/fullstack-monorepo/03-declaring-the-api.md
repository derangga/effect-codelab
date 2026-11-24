---
title: Declaring the API as a value
order: 3
slug: 03-declaring-the-api
summary: Describe both endpoints as plain data in the shared package, using HttpApiEndpoint, HttpApiGroup and HttpApi, before any server exists.
---

In most backends, the list of routes lives only inside the server. You write
`app.get("/todos", handler)`, and the route is created together with its code.
Then the frontend writes its own copy: the same path, the same method, and the
same response type, typed out again by hand. Each of those three copies can be
wrong on its own.

Effect reverses the order. You first describe the API as a plain value, with no
code that runs. The description holds the path, the method, what the request
carries, and what comes back. It lives in `packages/domain`, so the server and
the web page read the same one.

## One endpoint

Start with the endpoint that lists todos.

```ts twoslash
import { Schema } from "effect"
class Todo extends Schema.Class<Todo>("Todo")({ title: Schema.String }) {}
class TodoPersistenceError extends Schema.TaggedError<TodoPersistenceError>()("TodoPersistenceError", {
  message: Schema.String,
}) {}
// ---cut---
import { HttpApiEndpoint } from "effect/http-api"

const list = HttpApiEndpoint.get("list", "/todos", {
  success: Schema.Array(Todo),
  error: TodoPersistenceError,
})
```

Read it aloud. It is an endpoint named `list` that answers `GET /todos`. It
succeeds with an array of todos, and it may fail with a `TodoPersistenceError`.

The `success` and `error` fields are schemas, not plain types. They come from
[The todo in Schema](/learn/fullstack-monorepo/02-the-todo-in-schema). The rest
of this track depends on that. The server uses them to turn its values into
JSON. The client uses them to check the JSON it gets back.

The failure is part of the description too. In plain TypeScript, an API's errors
are whatever the code happens to throw. Here the endpoint states which errors it
can return. The `httpApiStatus: 500` on `TodoPersistenceError` sets the status
code. [Typed errors and recovery](/learn/basic-effect/03-typed-errors) explains
why Effect keeps failures in the type. This is the same idea applied to HTTP.

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
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"

const create = HttpApiEndpoint.post("create", "/todos", {
  payload: CreateTodoPayload,
  success: Todo.pipe(HttpApiSchema.status(201)),
  error: TodoPersistenceError,
})
```

`payload` is the request body. When a request arrives, the server decodes the
body with `CreateTodoPayload` before your code sees it. So the title is already
trimmed and checked when your code runs. A bad title gets a `400 Bad Request`
automatically.

`HttpApiSchema.status(201)` changes the success status from the default `200` to
`201 Created`. This is the usual answer when the server made something new.

## Grouping and naming the API

A **group** is a named set of endpoints, and the **API** is a set of groups. Add
the endpoints to a group, then add the group to the API:

```ts
const TodosGroup = HttpApiGroup.make("todos").add(list).add(create)
const TodosApi = HttpApi.make("TodosApi").add(TodosGroup).prefix("/api")
```

The group name, `todos`, becomes part of how you call the API later. On the
client, the calls will be `client.todos.list()` and `client.todos.create(...)`.
The `.prefix("/api")` puts every path under `/api`, so the real URLs are
`/api/todos`. The prefix keeps the browser setup simple in
[The React page](/learn/fullstack-monorepo/09-the-react-page), because one rule
can send everything under `/api` to the server.

## The whole file

Here is `packages/domain/src/TodosApi.ts` in full. It imports from the file you
wrote in [The todo in Schema](/learn/fullstack-monorepo/02-the-todo-in-schema):

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
```

Then add it to `packages/domain/src/index.ts`:

```ts
// packages/domain/src/index.ts
export * from "./Todo.ts"
export * from "./TodosApi.ts"
```

That is the whole shared package. It has two files and no code that runs on its
own.

## What the description already gives you

Nothing answers requests yet. Even so, this value is enough for three things:

- API documentation: you can generate an OpenAPI document from it. OpenAPI is a
  standard JSON format that API tools read. The description already knows every
  path, body, and response.
- A client: the web page gets a typed function for each endpoint.
- A checklist for the server: the server must provide a handler for `list` and
  for `create`. TypeScript refuses to compile until it does.

## Check it works

You can try the first one now. Create `packages/domain/try.ts`:

```ts
// packages/domain/try.ts
import { OpenApi } from "effect/http-api"
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

The output shows one path and two methods. The description alone produced them.
Delete `try.ts`, then run `bun run typecheck` once more.

## What people get wrong

Putting handler code in the shared package. It is tempting to write the handlers
right next to the endpoints. Do not do it. The web page imports
`packages/domain`, and everything in it ends up in the browser bundle. If
`domain` imported the database driver, Vite would try to bundle SQLite into a
web page. Keep `domain` to schemas and descriptions only.

Forgetting that the prefix is part of the path. After `.prefix("/api")`, the list
endpoint is `GET /api/todos`, not `GET /todos`. When you test with `curl` later,
include the `/api`.

## Next

The description says what a todo looks like and how to ask for one. Something
still has to store the todos. [The repo over SQLite](/learn/fullstack-monorepo/04-the-repo-over-sqlite)
starts the server with a database and a small service that hides it.
