---
title: Unlearning try, catch and await
order: 4
slug: 04-unlearning-the-keywords
summary: A map from ordinary async TypeScript to the three channels of an Effect program.
---

Effect does not ask you to forget JavaScript. Promises still exist. Third-party
code still throws. Resources still need cleanup.

What changes is where these behaviors may enter the program. Ordinary TypeScript
handles the places where outside code comes in. Inside the program, Effect keeps
the success value, the expected failures, and the dependencies in one
description.

This page brings together the first three shifts. It is a map, not a list of
APIs to memorize.

## Before reading on

Where does this function first stop telling the truth in its type?

```ts twoslash
async function loadPort(): Promise<number> {
  const response = await fetch('/config.json')
  const body: unknown = await response.json()
  return Number((body as { port: string }).port)
}
```

More than one answer is reasonable.

`fetch` can reject, but `Promise<number>` names no failure. `response.json()`
gives you data that the program did not create. The cast says the data has a
certain shape, but nothing checks it. `Number` can produce `NaN`, even though
the return type still says `number`.

The first misleading line is the function signature, not `await`. The body has
several possible outcomes and dependencies, but the return type records only a
future success.

## The three channels in one signature

An Effect signature puts the missing parts in one place:

```ts twoslash
import { Effect } from 'effect'

interface HttpClient {}

declare class RequestFailed {
  readonly _tag: 'RequestFailed'
}

declare class InvalidPort {
  readonly _tag: 'InvalidPort'
}

declare const loadPort: Effect.Effect<
  number,
  RequestFailed | InvalidPort,
  HttpClient
>
```

Read it as one sentence. `loadPort` may produce a number, may fail because the
request failed or the port was invalid, and needs an HTTP client.

The signature does not say how the program does its work. It says what any
implementation must keep true.

```mermaid
flowchart LR
  O["Promise and throwing APIs"] --> A["adapt at the boundary"]
  A --> P["Effect<A, E, R>"]
  P --> S["supply R"]
  S --> X["run once at the edge"]
```

This flow shows where each familiar keyword ends up.

## Adapt outside code once

When a Promise API enters an Effect program, you wrap it with an Effect
constructor. The constructor describes how to call the API and how to turn a
rejection into a named failure. Synchronous code that throws gets the same
treatment. You decode untrusted input where it enters the program, instead of
casting and checking it all through the program.

This is where you put what you know about the outside library. The rest of the
program should see `RequestFailed`, not an unknown rejection from `fetch`.

`try` has not gone away. Its job is now narrower: adapt code that can throw, at
the point where it enters the typed program.

## Combine descriptions inside the program

`Effect.gen` lets you write Effect steps one after another, like `async` code.
`yield*` gets the success value of one description so the next step can use it.

```ts twoslash
import { Effect } from 'effect'

declare const readPort: Effect.Effect<string, 'ConfigMissing'>
declare const parsePort: (
  input: string,
) => Effect.Effect<number, 'InvalidPort'>

const program = Effect.gen(function* () {
  const text = yield* readPort
  return yield* parsePort(text)
})

program
// ^?
```

This looks like `await`, but it does not start the program. The generator builds
one larger description. Its success value comes from `parsePort`. Its error
channel holds the failures from both steps.

Expected failures do not need `throw`. Constructors can put them in `E`, and
handlers can deal with each one later. Dependencies do not need to be passed
through every function in between. They stay in `R` until code near the entry
point supplies them.

## Cleanup belongs to the runtime

`finally` has two jobs: it describes the cleanup, and it relies on the program
reaching the code that runs it. This is fragile in asynchronous programs,
because work can fail, be interrupted, or be cancelled while a resource is in
use.

Effect uses a scope to link opening a resource with releasing it. The runtime
runs the release action when the scope closes, even after a failure or an
interruption. This track covers only the idea. A later course shows the APIs.

The rule from the first page still applies: opening a resource is part of a
description. It is not a side effect that happens while you build the program.

## The map from ordinary code to Effect

Use this table to read ordinary TypeScript. Do not use it as a recipe for
rewriting code line by line:

| Ordinary code | Question to ask in Effect |
| --- | --- |
| call an async function | Am I describing this work, or starting it now? |
| `await` a Promise | What success value should the next step get from this Effect? |
| `throw` an expected failure | What named value belongs in `E`? |
| `catch` an unknown value | Where should I turn this outside failure into a named failure? |
| import a stateful client | Should this dependency appear in `R`? |
| cast outside data | Where should I decode this data as it enters the program? |
| clean up in `finally` | Which scope should own this resource? |

Do not swap keywords one at a time and call the job done. Start with the
signature. Name the success value, the expected failures, and the dependencies.
Then write a description that keeps to that signature, until the application
supplies `R` and runs it.

You now know enough of the mental model to start
[Basic Effect](/learn/basic-effect). That course teaches the constructors,
combinators, services, and run functions behind this map.
