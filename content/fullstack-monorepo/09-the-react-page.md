---
title: The React Page
order: 9
slug: 09-the-react-page
summary: A form and a list that read the atoms, a Vite proxy so the browser reaches the server, and the whole app running with one command.
---

Everything so far can be proven with `curl` and tests, but nobody uses a todo
app through `curl`. This last chapter builds the page: a form to add a todo and
a list that updates itself. It is ordinary React. The interesting part is what
the components do *not* contain: no `fetch`, no `useEffect`, and no loading
flag managed by hand.

## Vite and the proxy

The page is served by [Vite](https://vite.dev) on port 5173, and the server
runs on port 3000. A browser treats those as two different sites, and would
block the page from calling the API unless the server added CORS headers. A
**proxy** avoids the problem: Vite forwards every request that starts with
`/api` to the server, so to the browser there is only one site.

```ts twoslash
// apps/web/vite.config.ts
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
})
```

This is why the API got the `/api` prefix in [Declaring the API as a
Value](/learn/fullstack-monorepo/03-declaring-the-api), and why the client's
`baseUrl` is just the page's own address. The Tailwind plugin is for styling,
and has nothing to do with Effect.

The three small files that start the page:

```html
<!-- apps/web/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todos</title>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```css
/* apps/web/src/index.css */
@import "tailwindcss";
```

```tsx
// apps/web/src/main.tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("index.html is missing #root")

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

There is no provider component to wrap the app in. The atom hooks use a shared
store by default.

## The list

`useAtomValue` reads an atom and re-renders the component when it changes.
Reading `todosAtom` is also what starts the request, the first time any
component reads it.

What comes back is the `AsyncResult` from last chapter, and
`AsyncResult.matchWithError` asks for one function per state:

```tsx
function TodoList() {
  const result = useAtomValue(todosAtom)

  return AsyncResult.matchWithError(result, {
    onInitial: () => <p className="text-slate-500">Loading...</p>,
    onError: (error) => <p className="text-red-600">Could not load todos ({error._tag}).</p>,
    onDefect: () => <p className="text-red-600">Something went wrong.</p>,
    onSuccess: ({ value: todos }) => /* the list */ null,
  })
}
```

- `onInitial` runs while the request is in flight.
- `onError` receives a declared error. Its type is `TodoPersistenceError`,
  so `error._tag` is known, and the editor autocompletes it.
- `onDefect` receives anything undeclared, like the server being down.
- `onSuccess` receives the list, already decoded into `Todo` instances.

You cannot forget the loading state or the error state, because
`matchWithError` does not compile without all four functions.

## The form

The form has one real decision to make, and it comes from [The Todo in
Schema](/learn/fullstack-monorepo/02-the-todo-in-schema). The typed client
encodes the payload before sending, and encoding refuses a title with spaces
around it. Text straight from an input box often has them. So the form
**decodes** the raw input first, with the same `CreateTodoPayload` the server
uses. Decoding trims the text and checks the length, and the result is safe to
send.

```tsx
// Same schema the server decodes with, so bad input never leaves the browser.
const decodePayload = Schema.decodeUnknownOption(CreateTodoPayload)
```

`decodeUnknownOption` returns an **Option**, Effect's way of saying "maybe a
value". It is either `Some(payload)` or `None` when the input is invalid.
`Option.match` handles both:

```tsx
Option.match(decodePayload({ title }), {
  onNone: () => setInvalid(true),
  onSome: async (payload) => {
    setInvalid(false)
    const exit = await createTodo({ payload, reactivityKeys: [TODOS_KEY] })
    if (Exit.isSuccess(exit)) setTitle("")
  },
})
```

That gives validation in the browser for free. The rule "1 to 200 characters"
is written once, in `domain`, and both sides enforce it.

`createTodo` comes from `useAtom(createTodoAtom, { mode: "promiseExit" })`.
`useAtom` returns the atom's current value and a function to call it.
`"promiseExit"` makes that function return a promise of an **Exit**, a value
that says whether the call succeeded or failed without throwing. The input is
cleared only on success, so a failed save keeps what the user typed.

The mutation's current value is an `AsyncResult` too. Its `waiting` flag is
`true` while the request runs, which is all the button needs to disable itself.

## The whole page

`apps/web/src/App.tsx`:

```tsx twoslash
// @allowImportingTsExtensions
// @noEmit
// @jsx: react-jsx
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

// Client derived from the shared contract. Vite proxies /api to the server.
export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: window.location.origin,
}) {}

export const TODOS_KEY = "todos"

export const todosAtom = TodosClient.query("todos", "list", { reactivityKeys: [TODOS_KEY] })

export const createTodoAtom = TodosClient.mutation("todos", "create")
// @filename: apps/web/src/App.tsx
// ---cut---
// apps/web/src/App.tsx
import { useAtom, useAtomValue } from "@effect/atom-react"
import { CreateTodoPayload } from "@todo/domain"
import { DateTime, Exit, Option, Schema } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { type FormEvent, useState } from "react"
import { createTodoAtom, TODOS_KEY, todosAtom } from "./TodosClient.ts"

// Same schema the server decodes with, so bad input never leaves the browser.
const decodePayload = Schema.decodeUnknownOption(CreateTodoPayload)

function TodoForm() {
  const [title, setTitle] = useState("")
  const [invalid, setInvalid] = useState(false)
  const [result, createTodo] = useAtom(createTodoAtom, { mode: "promiseExit" })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    Option.match(decodePayload({ title }), {
      onNone: () => setInvalid(true),
      onSome: async (payload) => {
        setInvalid(false)
        const exit = await createTodo({ payload, reactivityKeys: [TODOS_KEY] })
        if (Exit.isSuccess(exit)) setTitle("")
      },
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="Todo title"
          className="flex-1 rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={result.waiting}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {result.waiting ? "Adding..." : "Add"}
        </button>
      </div>
      {invalid && <p className="text-sm text-red-600">Title must be 1 to 200 characters.</p>}
      {AsyncResult.isFailure(result) && <p className="text-sm text-red-600">Could not save the todo.</p>}
    </form>
  )
}

function TodoList() {
  const result = useAtomValue(todosAtom)

  return AsyncResult.matchWithError(result, {
    onInitial: () => <p className="text-slate-500">Loading...</p>,
    onError: (error) => <p className="text-red-600">Could not load todos ({error._tag}).</p>,
    onDefect: () => <p className="text-red-600">Something went wrong.</p>,
    onSuccess: ({ value: todos }) =>
      todos.length === 0 ? (
        <p className="text-slate-500">No todos yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-center justify-between px-3 py-2">
              <span className={todo.completed ? "text-slate-400 line-through" : ""}>{todo.title}</span>
              <time className="text-xs text-slate-400" dateTime={DateTime.formatIso(todo.createdAt)}>
                {DateTime.toDateUtc(todo.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      ),
  })
}

export function App() {
  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Todos</h1>
      <TodoForm />
      <TodoList />
    </main>
  )
}
```

`todo.id` works as a React `key` because a `TodoId` is a number underneath its
brand. `todo.createdAt` is a `DateTime`, so the list formats it with
`DateTime.formatIso` and `DateTime.toDateUtc` instead of parsing a string.

## Run everything

From the repository root, one command starts both apps:

```sh
bun run dev
```

That is the root script `bun --filter './apps/*' dev` from [the workspace
shape](/learn/fullstack-monorepo/01-the-workspace-shape), running the server's
`bun --watch` and the web app's `vite` side by side, with the output of both in
one terminal. `Ctrl+C` stops both.

Open [http://localhost:5173](http://localhost:5173). You should see:

1. "Loading..." for a moment, then "No todos yet", or the todos from your
   curl session if the database file is still there.
2. Type `  first from browser  ` with spaces and press Add. The button says
   "Adding..." briefly, then the todo appears at the top, trimmed. You never
   wrote code to refresh the list. The reactivity key did it.
3. Type only spaces and press Add. "Title must be 1 to 200 characters." shows
   up, and no request is sent. Check the server terminal: nothing was logged.

## The payoff

Go back to the promise from [the workspace
shape](/learn/fullstack-monorepo/01-the-workspace-shape). In
`packages/domain/src/Todo.ts`, rename the `title` field of `Todo` to `name`.
Then, from the root:

```sh
bun run typecheck
```

```
@todo/domain typecheck: Exited with code 0
@todo/server typecheck: src/TodosApi.test.ts(26,20): error TS2339: Property 'title' does not exist on type 'Todo'.
@todo/web typecheck: src/App.tsx(66,91): error TS2339: Property 'title' does not exist on type 'Todo'.
```

One change in the shared package, and both apps fail to build, each pointing at
the exact line that still says `title`. In two separate repositories, the same
rename would have gone out quietly and broken the page in production.

One place did not fail: the SQL in `TodoRepo`. Queries are plain text, so
TypeScript cannot see inside them. That is what the test is for. With the
rename, `bun run test` fails too, because the row from the database no longer
matches the schema. Types catch what they can, and the test catches the rest.
Rename it back before you continue.

## The finished repository

```
monorepo/
├── package.json            workspaces, scripts, TypeScript 7 + Effect checker
├── tsconfig.base.json
├── biome.json
├── .gitignore
├── packages/domain/
│   ├── package.json        exports ./src/index.ts
│   ├── tsconfig.json
│   └── src/
│       ├── Todo.ts         TodoId, Todo, CreateTodoPayload, TodoPersistenceError
│       ├── TodosApi.ts     the API description
│       └── index.ts
├── apps/server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── Sql.ts          SQLite from config, the migration
│       ├── TodoRepo.ts     the repository service
│       ├── Http.ts         handlers, API layer, docs page
│       ├── main.ts         the entry point
│       └── TodosApi.test.ts
└── apps/web/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts      React, Tailwind, the /api proxy
    ├── index.html
    └── src/
        ├── main.tsx
        ├── index.css
        ├── TodosClient.ts  client and atoms from the description
        └── App.tsx
```

And the commands, all from the root:

```sh
bun install          # also patches tsc with the Effect checker
bun run dev          # server on :3000, web on :5173
bun run typecheck    # every package
bun run test         # the API test, in-memory SQLite
bun run lint         # Biome
```

## What people get wrong

**Forgetting the proxy.** Without the `server.proxy` entry, requests to
`/api/todos` go to Vite itself instead of the server, and the list shows
"Something went wrong." If the page loads but the data does not, check the
proxy first.

**Changing the port on one side only.** Start the server with `PORT=4000` and
the proxy still points at `3000`. Change both, or leave the default.

**Another program on port 3000.** Many dev servers use port 3000, including
this learning site when you run it locally. Bun can still start on the same
port, because the other program is listening on a different network address,
and then the proxy's `localhost:3000` reaches the other program instead of
yours. The page shows "Something went wrong." and your server logs no request.
Check what is listening with `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then stop the
other program, or run the server on another port and change the proxy to
match.

**Sending the raw input.** Passing `{ title }` straight from the input to
`createTodo` works for `"buy milk"` and fails for `" buy milk"`, because the
client refuses to encode an untrimmed title. The save fails in the browser
with "Could not save the todo." and never reaches the server. Always decode
user input with the schema first.

## Next

That is the whole app, from an empty folder to a typed page. To go further,
the [HTTP Auth API](/learn/http-auth-api) track adds login and protected
endpoints to a server built the same way, and the
[Anti-patterns](/learn/anti-patterns) track collects the habits that would undo
what this one set up.
