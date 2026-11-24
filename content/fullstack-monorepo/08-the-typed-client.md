---
title: The typed client
order: 8
slug: 08-the-typed-client
summary: AtomHttpApi turns the shared API description into atoms that React can read, so the browser gets typed calls, loading states, and automatic refreshes without a hand-written fetch.
---

A typical frontend has a file full of functions like this:

```ts
async function listTodos(): Promise<Todo[]> {
  const res = await fetch("/api/todos")
  return res.json()
}
```

This code repeats the path, the method, and the response type that the backend
already declared. The `Promise<Todo[]>` is a guess. `res.json()` returns
whatever arrived, and TypeScript trusts the function's word. Then each
component adds a `useState` for loading, another for errors, and a `useEffect`
to fetch again after a change.

This chapter replaces all of that with one small file,
`apps/web/src/TodosClient.ts`.

## What an atom is

An **atom** is a small piece of state that lives outside your components. A
component reads an atom with a hook and re-renders when the atom changes. In
this way an atom is similar to a tiny global store. Effect atoms can also load
their own value by running an effect. They track whether that load is still
running, succeeded, or failed.

The atoms live in `effect/reactivity`. The React hooks that read them come from
`@effect/atom-react`. The next chapter uses those hooks.

## A client made from the description

In the test you used `HttpApiClient.make(TodosApi)` to get a typed client.
`AtomHttpApi.Service` does the same job. It also makes atoms from each endpoint.

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
// @filename: apps/web/src/TodosClient.ts
// ---cut---
// apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/http"
import { AtomHttpApi } from "effect/reactivity"

// Client derived from the shared contract. Vite proxies /api to the server.
export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: window.location.origin,
}) {}
```

The class takes three options:

- `api` is the API description from `domain`. It is the same value the server
  was built from.
- `httpClient` is how requests are sent. `FetchHttpClient.layer` uses the
  browser's own `fetch`.
- `baseUrl` is where the API lives. It is the page's own address, because the
  next chapter sets up Vite to forward every `/api` request to the server. The
  browser sees one site.

## A query atom

The list of todos becomes an atom:

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
// @filename: apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/http"
import { AtomHttpApi } from "effect/reactivity"

export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: window.location.origin,
}) {}
// ---cut---
export const TODOS_KEY = "todos"

export const todosAtom = TodosClient.query("todos", "list", { reactivityKeys: [TODOS_KEY] })
//           ^?
```

`"todos"` and `"list"` are the group name and the endpoint name from the
description. A misspelled name is a type error, because the client knows every
name that exists.

The type matters here. It is an `Atom` that holds an **AsyncResult**, a value
that is always in one of three states:

- Initial: the request has not finished yet.
- Success: the value holds the list of `Todo`s.
- Failure: the value holds a `TodoPersistenceError`, the error the endpoint
  declared. A failure that nobody declared, such as the server being down, also
  lands here. It arrives as a **defect**, an unexpected error that is not part
  of the type. The next chapter shows both on screen.

Nobody wrote `Todo[]` or `TodoPersistenceError` in this file. Both came from the
description. If the server's endpoint changes its success type, the type of this
line changes with it.

## A mutation atom

Creating a todo is a **mutation**, an action that changes something on the
server:

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
// @filename: apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/http"
import { AtomHttpApi } from "effect/reactivity"

export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: window.location.origin,
}) {}
// ---cut---
export const createTodoAtom = TodosClient.mutation("todos", "create")
//           ^?
```

A query runs as soon as a component reads it. A mutation waits until you call
it. Each call takes the endpoint's input, here `{ payload: { title } }`. A
mutation also remembers the state of its last call, so a button can show
"Adding..." while the call runs.

## Refreshing after a change

After a new todo is saved, the list on screen is out of date. Normally you would
have to call a `refetch()` in every place that changes todos.

**Reactivity keys** remove that job. A reactivity key is a label that tells a
query when to reload. The query was created with `reactivityKeys: [TODOS_KEY]`.
When a mutation call passes the same label, the query reloads itself once the
mutation succeeds:

```ts
createTodo({ payload, reactivityKeys: [TODOS_KEY] })
```

The mutation does not know which atoms show todos. The list does not know which
buttons change them. They share only the word `"todos"`. It is kept in one
constant, so a typo cannot split them.

## The whole file

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
// @filename: apps/web/src/TodosClient.ts
// ---cut---
// apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/http"
import { AtomHttpApi } from "effect/reactivity"

// Client derived from the shared contract. Vite proxies /api to the server.
export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: window.location.origin,
}) {}

export const TODOS_KEY = "todos"

export const todosAtom = TodosClient.query("todos", "list", { reactivityKeys: [TODOS_KEY] })

export const createTodoAtom = TodosClient.mutation("todos", "create")
```

That is the whole data layer of the frontend. It has no `fetch`, no URL, and no
hand-written types.

## Check it works

```sh
cd apps/web
bun run typecheck
```

The command prints `$ tsc -p tsconfig.json` and nothing else. That means the
code compiles. Now make a mistake on purpose. Change `"list"` to `"lsit"` and
run the command again. The typecheck fails, because `"lsit"` is not an endpoint
of the `todos` group. Change it back.

## What people get wrong

The first mistake is making atoms inside a component. If you write
`const todosAtom = TodosClient.query(...)` in a component body, it creates a new
atom on every render. Each new atom starts in the Initial state and sends the
request again. Create atoms once, at the top level of a module, as this file
does.

The second mistake is leaving the key off the call. The query has
`reactivityKeys`, but it refreshes only when the call to the mutation passes the
same key. Leave the key out and the todo is saved, but the list on screen stays
stale until the page reloads.

The third mistake is importing server code into the web app. The client needs
`TodosApi` and nothing else from the server side. If `TodosClient.ts` imports
from `apps/server`, the browser bundle tries to include SQLite. Everything the
web app needs is in `@todo/domain`, and that is why the description lives
there.

## Next

The data layer is ready. [The React page](/learn/fullstack-monorepo/09-the-react-page)
reads these atoms from components, sets up Vite, and runs the whole app.
