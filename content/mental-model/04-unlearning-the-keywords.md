---
title: Unlearning try, catch and await
order: 4
slug: 04-unlearning-the-keywords
summary: A boundary map for ordinary asynchronous TypeScript and the three channels of an Effect program.
---

Effect does not ask you to forget JavaScript. Promises still exist. Third-party
code still throws. Resources still need cleanup.

The change is where those behaviors are allowed to cross into the program.
Ordinary TypeScript sits at the boundaries. Inside, Effect keeps success,
expected failure, and requirements in one description.

This page joins the first three mental shifts. It is a map, not a list of APIs
to memorize.

## Before reading on

Where does this function first stop telling the truth in its type?

```ts twoslash
async function loadPort(): Promise<number> {
  const response = await fetch('/config.json')
  const body: unknown = await response.json()
  return Number((body as { port: string }).port)
}
```

There is more than one reasonable place to point.

`fetch` can reject, but `Promise<number>` names no failure. `response.json()`
accepts data the program did not create. The cast claims that data has a shape
without checking it. `Number` can produce `NaN`, even though the return type
still says `number`.

The first misleading line is not `await`. It is the function signature. The
body has several outcomes and dependencies, while the contract records only a
future success.

## The three channels are one contract

An Effect signature keeps the missing parts together:

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

The signature does not tell you how the program performs those steps. It tells
you what any implementation must preserve.

```mermaid
flowchart LR
  O["Promise and throwing APIs"] --> A["adapt at the boundary"]
  A --> P["Effect<A, E, R>"]
  P --> S["supply R"]
  S --> X["run once at the edge"]
```

That shape explains where the familiar keywords go.

## Outside code gets adapted once

When a Promise API enters an Effect program, an Effect constructor describes
how to call it and how to turn rejection into a named failure. Throwing
synchronous code gets the same treatment. Untrusted input is decoded where it
enters instead of cast and checked throughout the program.

This is the place where knowledge of the outside library belongs. The rest of
the program should see `RequestFailed`, not an unknown rejection from a fetch
implementation.

`try` has not vanished. Its responsibility has become precise: adapt code that
can throw at the boundary where it enters the typed program.

## Inside code composes descriptions

`Effect.gen` gives sequential Effect code a shape similar to `async` code.
`yield*` obtains the success value of one description so the next step can use
it.

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

This resembles `await`, but it does not start the program. The generator builds
one larger description. Its success comes from `parsePort`, and its error
channel contains the failures from both steps.

Expected failures do not need `throw`. Constructors can place them in `E`, and
handlers can make typed decisions later. Requirements do not need to be passed
through every intermediate function. They remain in `R` until code near the
entry point supplies them.

## Cleanup belongs to the runtime

`finally` combines two jobs: describe cleanup and hope control reaches the
place that performs it. Asynchronous programs make that fragile. Work can fail,
be interrupted, or be cancelled while a resource is in use.

Effect uses a scope to tie acquisition and release together. The runtime then
runs the release action when that scope closes, including after failure or
interruption. This track stops at the idea. The later course shows the APIs.

The same rule still applies: opening a resource is part of a description, not a
side effect that happens while the program is being assembled.

## The boundary map

Use this translation when reading ordinary TypeScript, not as a mechanical
rewrite recipe:

| Ordinary code | Question to ask in Effect |
| --- | --- |
| call an async function | Am I describing this work, or starting it now? |
| `await` a Promise | What Effect success value should flow to the next step? |
| `throw` an expected outcome | What named value belongs in `E`? |
| `catch` an unknown value | Where should this foreign failure be translated? |
| import a stateful client | Should this requirement appear in `R`? |
| cast outside data | Where is the boundary that must decode it? |
| clean up in `finally` | What lifetime should own this resource? |

Do not replace keywords one at a time and call the job done. Start with the
contract. Name the success, expected failures, and requirements. Then write a
description that keeps those promises until the application supplies `R` and
runs it.

You now have enough of the mental model to start
[Basic Effect](/learn/basic-effect). That course teaches the constructors,
combinators, services, and runtime calls that implement this map.
