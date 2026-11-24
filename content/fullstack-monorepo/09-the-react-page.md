---
title: The React page
order: 9
slug: 09-the-react-page
summary: A form and a list that read the atoms, a Vite proxy that lets the browser reach the server, and the whole app running with one command.
---

You can prove everything so far with `curl` and tests, but nobody uses a todo
app through `curl`. This chapter builds the page: a form that adds a todo and a
list that updates itself. It is ordinary React. The components contain no
`fetch`, no `useEffect`, and no loading flag managed by hand.

## Vite and the proxy

[Vite](https://vite.dev) serves the page on port 5173, and the server runs on
port 3000. A browser treats these as two different sites. It blocks the page
from calling the API unless the server sends CORS headers, which are response
headers that allow calls between sites. A **proxy** avoids the problem. A proxy
is a program that passes requests on to another server. Vite forwards every
request that starts with `/api` to the server, so the browser sees only one
site.

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

This is why the API has the `/api` prefix in [Declaring the API as a
value](/learn/fullstack-monorepo/03-declaring-the-api), and why the client's
`baseUrl` is just the page's own address. The Tailwind plugin only styles the
page. It has nothing to do with Effect.

Three small files start the page:

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

You do not wrap the app in a provider component. The atom hooks use a shared
store by default.

## The list

`useAtomValue` reads an atom and re-renders the component when the atom
changes. The first time any component reads `todosAtom`, that read also starts
the request.

The value you get back is the `AsyncResult` from [The typed
client](/learn/fullstack-monorepo/08-the-typed-client).
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

- `onInitial` runs while the request is still running.
- `onError` receives an error that the API declares. Its type is
  `TodoPersistenceError`, so the editor knows `error._tag` and autocompletes it.
- `onDefect` receives any failure the API does not declare, such as the server
  being down.
- `onSuccess` receives the list, already **decoded**. To decode is to check
  data against a schema and turn it into typed values, here `Todo` instances.

You cannot forget the loading state or the error state. `matchWithError` does
not compile without all four functions.

## The form

The form must handle one problem, and it comes from [The todo in
Schema](/learn/fullstack-monorepo/02-the-todo-in-schema). The typed client
encodes the payload before it sends it. Encoding refuses a title with spaces
around it, and text from an input box often has them. So the form decodes the
raw input first, with the same `CreateTodoPayload` the server uses. Decoding
trims the text and checks the length. The result is safe to send.

```tsx
// Same schema the server decodes with, so bad input never leaves the browser.
const decodePayload = Schema.decodeUnknownOption(CreateTodoPayload)
```

`decodeUnknownOption` returns an **Option**, which is a value that is either
present or missing. Here it is `Some(payload)` when the input is valid and
`None` when it is not. `Option.match` handles both cases:

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

This gives you validation in the browser for free. The rule "1 to 200
characters" is written once, in `domain`, and both sides enforce it.

`createTodo` comes from `useAtom(createTodoAtom, { mode: "promiseExit" })`.
`createTodoAtom` is a **mutation**, which is an atom that sends a change to the
server. `useAtom` returns the atom's current value and a function that runs it.
The `"promiseExit"` mode makes that function return a promise of an **Exit**.
An Exit is a value that says whether the call succeeded or failed, without
throwing. The form clears the input only on success, so a failed save keeps what
the user typed.

The mutation's current value is an `AsyncResult` too. Its `waiting` flag is
`true` while the request runs. That is all the button needs to disable itself.

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
import { AsyncResult } from "effect/reactivity"
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

This is the root script `bun --filter './apps/*' dev` from [The workspace
shape](/learn/fullstack-monorepo/01-the-workspace-shape). It runs the server's
`bun --watch` and the web app's `vite` side by side, and shows the output of
both in one terminal. `Ctrl+C` stops both.

Open [http://localhost:5173](http://localhost:5173). Then follow these steps:

1. Watch "Loading..." for a moment. Then you see "No todos yet", or the todos
   from your curl session if the database file is still there.
2. Type `  first from browser  ` with spaces around it, then press Add. The
   button briefly says "Adding...", then the trimmed todo appears at the top.
   You wrote no code to refresh the list. The reactivity key did it.
3. Type only spaces, then press Add. The page shows "Title must be 1 to 200
   characters." and sends no request. Check the server terminal. It logged
   nothing.

## The payoff

Go back to the promise from [The workspace
shape](/learn/fullstack-monorepo/01-the-workspace-shape). In
`packages/domain/src/Todo.ts`, rename the `title` field of `Todo` to `name`.
Then, from the root, run:

```sh
bun run typecheck
```

```
@todo/domain typecheck: Exited with code 0
@todo/server typecheck: src/TodosApi.test.ts(27,20): error TS2339: Property 'title' does not exist on type 'Todo'.
@todo/server typecheck: Exited with code 1
@todo/web typecheck: src/App.tsx(67,91): error TS2339: Property 'title' does not exist on type 'Todo'.
@todo/web typecheck: Exited with code 1
error: script "typecheck" exited with code 1
```

The packages check in parallel, so the server and web lines can swap places.
Your line numbers match only if your files start with the same path comment as
the code blocks in this track.

One change in the shared package makes both apps fail the type check. Each one
points at the exact line that still says `title`. In two separate repositories,
the same rename would go out without any warning and break the page in
production.

One place did not fail: the SQL in `TodoRepo`. A query is plain text, so
TypeScript cannot read it. The test covers that gap. After the rename,
`bun run test` fails too, because the row from the database no longer matches
the schema. Types catch what they can, and the test catches the rest. Rename
the field back before you continue.

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

All commands run from the root:

```sh
bun install          # also patches tsc with the Effect checker
bun run dev          # server on :3000, web on :5173
bun run typecheck    # every package
bun run test         # the API test, in-memory SQLite
bun run lint         # Biome
```

## What people get wrong

The first mistake is forgetting the proxy. Without the `server.proxy` entry,
requests to `/api/todos` go to Vite instead of the server, and the list shows
"Something went wrong." If the page loads but the data does not, check the
proxy first.

The second mistake is changing the port on one side only. If you start the
server with `PORT=4000`, the proxy still points at `3000`. Change both, or keep
the default.

The third mistake is leaving another program on port 3000. Many dev servers use
port 3000, including this learning site when you run it locally. Bun can still
start on the same port, because the other program listens on a different
network address. Then the proxy's `localhost:3000` reaches the other program
instead of yours. The page shows "Something went wrong." and your server logs
no request. Run `lsof -nP -iTCP:3000 -sTCP:LISTEN` to see what is listening.
Then stop the other program, or run the server on another port and change the
proxy to match.

The fourth mistake is sending the raw input. Passing `{ title }` straight from
the input to `createTodo` works for `"buy milk"` and fails for `" buy milk"`,
because the client refuses to encode an untrimmed title. The save fails in the
browser with "Could not save the todo." and never reaches the server. Always
decode user input with the schema first.

## Next

That is the whole app, from an empty folder to a typed page. To go further, the
[HTTP Auth API](/learn/http-auth-api) track adds login and protected endpoints
to a server built the same way. The [Anti-patterns](/learn/anti-patterns) track
lists the habits that would undo what this track set up.
