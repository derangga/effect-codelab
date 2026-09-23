---
title: The Typed Client
order: 8
slug: 08-the-typed-client
summary: AtomHttpApi turns the shared description into atoms React can read, so the browser gets typed calls, loading states and automatic refreshes without a single fetch.
---

The usual frontend has a file full of functions like this:

```ts
async function listTodos(): Promise<Todo[]> {
  const res = await fetch("/api/todos")
  return res.json()
}
```

It repeats the path, the method and the response type that the backend already
declared, and the `Promise<Todo[]>` is a guess. `res.json()` returns whatever
arrived, and TypeScript takes the function's word for it. Then each component
adds its own `useState` for loading, another for errors, and a `useEffect` to
fetch again after a change.

This chapter replaces all of that with one small file,
`apps/web/src/TodosClient.ts`.

## What an atom is

An **atom** is a small piece of state that lives outside your components. A
component reads an atom with a hook and re-renders when the atom changes, a bit
like a tiny global store. What makes Effect's atoms useful here is that an atom
can also load its own value by running an effect, and it keeps track of
whether that load is still running, succeeded or failed.

The atoms live in `effect/unstable/reactivity`. The React hooks that read them
come from `@effect/atom-react`, and the next chapter uses those.

## A client made from the description

In the test you used `HttpApiClient.make(TodosApi)` to get a typed client.
`AtomHttpApi.Service` does the same thing, and also knows how to make atoms
from each endpoint.

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
// @filename: apps/web/src/TodosClient.ts
// ---cut---
// apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/unstable/http"
import { AtomHttpApi } from "effect/unstable/reactivity"

// Client derived from the shared contract. Vite proxies /api to the server.
export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: window.location.origin,
}) {}
```

Three options:

- `api` is the description from `domain`, the same value the server was built
  from.
- `httpClient` is how requests are actually sent. `FetchHttpClient.layer` uses
  the browser's own `fetch`.
- `baseUrl` is where the API lives. It is the page's own address, because in
  the next chapter Vite will forward every `/api` request to the server. The
  browser thinks it is talking to one site.

## A query atom

Listing todos becomes an atom:

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
// @filename: apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/unstable/http"
import { AtomHttpApi } from "effect/unstable/reactivity"

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

`"todos"` and `"list"` are the group and endpoint names from the description.
Misspell either one and it is a type error, because the client knows every
name that exists.

The type is the interesting part. It is an `Atom` holding an `AsyncResult`: a
value that is in one of three states.

- **Initial**: the request has not finished yet.
- **Success**: holding the list of `Todo`s.
- **Failure**: holding a `TodoPersistenceError`, the error the endpoint
  declared. A failure nobody declared, like the server being down, also lands
  here, but as a **defect**: an unexpected error that is not part of the type.
  The next chapter shows both on screen.

Nobody wrote `Todo[]` or `TodoPersistenceError` in this file. Both came from
the description. If the server's endpoint changes its success type, this line
changes with it.

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
// @filename: apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/unstable/http"
import { AtomHttpApi } from "effect/unstable/reactivity"

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
it, and each call takes the endpoint's input: here `{ payload: { title } }`.
It also remembers the state of the last call, so a button can show "Adding..."
while it runs.

## Refreshing after a change

After a new todo is saved, the list on screen is out of date. Normally you
would remember to call some `refetch()` in every place that changes todos.

**Reactivity keys** remove that job. A key is just a label. The query was
created with `reactivityKeys: [TODOS_KEY]`. When the mutation is called with
the same label, the query reloads itself once the mutation succeeds:

```ts
createTodo({ payload, reactivityKeys: [TODOS_KEY] })
```

The mutation does not know which atoms display todos, and the list does not
know which buttons change them. They only share the word `"todos"`, kept in one
constant so a typo cannot split them.

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
// @filename: apps/web/src/TodosClient.ts
// ---cut---
// apps/web/src/TodosClient.ts
import { TodosApi } from "@todo/domain"
import { FetchHttpClient } from "effect/unstable/http"
import { AtomHttpApi } from "effect/unstable/reactivity"

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

That is the whole data layer of the frontend. No `fetch`, no URL, no
hand-written types.

## Check it works

```sh
cd apps/web
bun run typecheck
```

It exits with no output. Now try a mistake on purpose: change `"list"` to
`"lsit"` and run it again. The typecheck fails because `"lsit"` is not an
endpoint of the `todos` group. Change it back.

## What people get wrong

**Making atoms inside a component.** Writing
`const todosAtom = TodosClient.query(...)` inside a component body creates a
new atom on every render. Each new atom starts over in the Initial state and
sends the request again. Create atoms once, at the top level of a module, like
this file does.

**Forgetting the key on the call.** The query has `reactivityKeys`, but the
refresh only happens when the *mutation call* passes the same key. Leave it out
and the todo is saved, the server is happy, and the list on screen stays stale
until the page reloads.

**Importing server code into the web app.** The client needs `TodosApi` and
nothing else from the server side. If `TodosClient.ts` ever imports from
`apps/server`, the browser bundle tries to include SQLite. Everything the web
app needs is in `@todo/domain`, which is exactly why the description lives
there.

## Next

The data layer is ready. [The React Page](/learn/fullstack-monorepo/09-the-react-page)
reads these atoms from components, sets up Vite, and runs the whole app.
