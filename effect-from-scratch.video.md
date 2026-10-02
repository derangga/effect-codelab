# Effect from scratch: video outline

Target length 27 to 30 minutes. One take per chapter, one file on screen,
`mini-effect.ts`, growing as the video goes. Every section below says what to
say, what to type live, and what to draw.

Keep the demo run (`bun mini-effect.ts`) at the end of each chapter. The
output is short on purpose, so the viewer sees the result without reading.

| time | segment | length |
| --- | --- | --- |
| 0:00 | hook | 2:00 |
| 2:00 | 01 the eager problem | 3:00 |
| 5:00 | 02 a value that holds work | 3:00 |
| 8:00 | 03 the first superpowers | 4:00 |
| 12:00 | 04 composing without running | 5:00 |
| 17:00 | 05 failure is a value | 4:00 |
| 21:00 | 06 needing things | 3:00 |
| 24:00 | 07 the end of the world | 3:00 |
| 27:00 | 08 what Effect adds | 2:00 |
| 29:00 | close | 1:00 |

## 0:00 Hook

- "Effect looks huge. It is one idea." Show `type Effect<A> = () => A` alone.
- Promise: by the end the viewer will have written a working replica of the
  core, in one file, with no dependencies.
- Say who it is for. Anyone comfortable with async/await. No Effect needed.
- Say what it is not. It is not a library to use. It is the idea, so that the
  real API stops looking like magic.

Type live: nothing. Just the one line.

Visual: one line of code on a blank screen, then the five-step type growth
from the track overview, shown once and left up for five seconds.

## 2:00 Chapter 01, the eager problem

- Run `fetchProduct(1)` with a log inside. The request prints before anyone
  awaits. "Calling the function was the request."
- Cooked meal versus recipe. A meal cannot be changed after the call.
- Try `withRetry(3, fetchProduct(1))` live. Explain why it cannot work: the
  helper receives a result, not the work.
- Fix it with `() => fetchProduct(1)` at three call sites, then move the arrow
  into `fetchProduct` itself. Run the recipe and show `requests so far: 0`.
- Trap to say aloud: `async` is not lazy. A Promise is a meal that is still
  cooking.

Type live: the eager version, the `withRetry` that fails to help, then the
recipe version. Show the log order.

Visual: split screen. Left, three call sites each wrapped in `() =>`. Right,
one recipe and three plain calls.

## 5:00 Chapter 02, a value that holds work

- Array of `.map` calls that all fire on creation, then the same array of
  thunks that fires on the last line.
- Name it: `type Effect<A> = () => A`.
- `succeed`, `sync`, `runSync`. Dwell on `succeed(Date.now())` against
  `sync(() => Date.now())`.
- `runSync` is "the end of the world". One function, and it is the only one
  that calls the thunk.
- Trap: forgetting to call it. `console.log(hello)` prints a function.

Type live: the three constructors and `runSync`, then the exercise, `fail`,
with `try`/`catch` around `runSync`.

Visual: a card labelled "recipe" and a box labelled "run". Arrow only goes one
way, from the card into the box.

## 8:00 Chapter 03, the first superpowers

- Show `loadPriceSafely`, the twelve-line function with a loop, a `try` and two
  `Date.now()` calls. Point at the one line that is the real work.
- Widen the type to `() => Promise<A>`. Add `promise` and `runPromise`.
- Introduce `pipe` in one sentence: `g(f(x))` in reading order.
- `repeat`, `retry`, `timed`, each in under a minute. Stack them with `pipe`.
- Trap: retrying a Promise that already ran.
- Write `timeout` with `Promise.race` and say what it cannot do: it rejects, but
  the slow work keeps going. Promise this is fixed in chapter seven.

Type live: `retry` and `timed` in full, `repeat` and `timeout` pasted.

Visual: three small flow diagrams, one per helper, each with the original
effect drawn as a box inside a bigger box.

## 12:00 Chapter 04, composing without running

- `priceWithTax` with `await` has the problem again: each `await` takes the
  value out, so nothing is left to retry.
- `map`, then `flatMap`. Build a chain, show nothing printed, run it twice and
  show it loads twice.
- The `gen` reveal, and give it time. Explain `function*`, `yield*`, then give
  effects `[Symbol.iterator]` with `make`. Write the runner on screen, five
  lines, and walk through `it.next(result)` once.
- Run the same pipeline with `flatMap` and with `gen`. Same answer.
- Trap: forgetting the `*`. `first` is an `Effect<number>`, not a number.

Type live: `map`, `flatMap`, `make`, `gen` in that order. This is the longest
live section, so leave the rest pasted.

Visual: the assembly line first, with no worker until the belt turns. Then the
generator stepping diagram from the chapter, animated one message at a time.

## 17:00 Chapter 05, failure is a value

- `login` that throws `NotFound` and `BadPassword`. In the editor, hover the
  `catch (error)` and show `unknown`.
- Add `Result` and the error type parameter. Show `Effect<User, NotFound | BadPassword>`.
- `gen` collects the errors from every `yield*`. Hover to show it.
- `catchAll` that handles one error and re-fails the other, and the type
  shrinks. Spend time here, this is where "typed errors" stops being abstract.
- Expected failure against a bug. Delivery with a label against a fire alarm.
  Show `orElse` failing to catch a `throw`.

Type live: `Result`, `fail`, then the `catchAll` handler. Use `^?` on the
screen to pin the type instead of hovering.

Visual: the type on screen, `Effect<User, NotFound | BadPassword>`, with one
word striking out as the handler runs.

## 21:00 Chapter 06, needing things

- `greet` with a module-level `db`. Ask: how would a test replace it?
- Widen to a third parameter. Explain `R` as "what it needs", with the default
  `unknown`.
- `tag`, `service`, `provide`. Hover `greet` and show the requirement. Try
  `runPromise(greet)` and show the type error.
- Provide a live database and a fake one to the same recipe.
- Trap: reading a global inside the effect puts the need back out of sight.

Type live: `service` and `provide`. Paste the `Clock` exercise.

Visual: one recipe card and two ovens, one labelled live and one labelled fake.

## 24:00 Chapter 07, the end of the world

- A fetch that outlives the page. A file left open when `read` throws.
- `runPromise` is the one door. Add the `AbortSignal` as a second parameter and
  say every combinator forwards it.
- Show `timeout` now stopping its slow work, and close the loop with chapter
  three.
- `ensuring` and `acquireUseRelease`: success, failure and abort all close
  the file.
- Trap: running an effect inside another one.

Type live: `ensuring` and `acquireUseRelease`. Paste the signal changes.

Visual: the kitchen door, only one. Work goes out of it, and a stop sign comes
back in.

## 27:00 Chapter 08, what Effect adds

- Put the same program on both screens, replica on the left and real `effect`
  on the right. Walk down the rename table.
- Name what is missing: stack safety, fibers, a scheduler, structured
  concurrency, tracing, layers. One sentence each.
- Run the 100000 `flatMap` chain and let the stack overflow happen on screen.
- Trap: the replica is not almost Effect.

Type live: the loop that builds the long chain, nothing else.

Visual: two columns, replica and real, with the six missing items as a list
under the right-hand one.

## 29:00 Close

- Point at [Basic Effect](/learn/basic-effect) for the real API.
- One sentence to leave them with: an Effect is a function that has not run yet.

Visual: the track map, with this track highlighted.
