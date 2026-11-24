---
title: Failure is a value
order: 2
slug: 02-failure-is-a-value
summary: With throw, the type does not show what can go wrong. Effect puts expected failures in the signature, so callers can see them.
---

TypeScript records what a function returns. It does not record what the
function throws.

That gap is easy to live with while you write all the calling code yourself. It
gets expensive as the code grows. Every caller must remember which failures are
possible, what shape they have, and which ones are safe to handle.

Effect keeps expected failures in both the value and the type of the program.

## Before reading on

Read these declarations without seeing either function body:

```ts twoslash
interface User {
  readonly id: string
  readonly name: string
}

declare function findUser(id: string): Promise<User>
declare function loadCurrentUser(): Promise<User>
```

Which function can throw because a user does not exist? Which can reject
because a session expired? Can either fail because the network is down?

The signatures cannot answer. Both say only that they may eventually produce a
`User`. A function that never rejects and a function that rejects in five known
ways have the same return type.

That information usually lives in docs, tests, or somebody's memory. The
compiler cannot check any of these.

## Catch gives you too little information

A `catch` block does not restore what the signature left out.

```ts twoslash
async function readName(): Promise<string> {
  try {
    return await Promise.reject(new Error('session expired'))
  } catch (error) {
    error
    // ^?
    return 'guest'
  }
}
```

The caught value is `unknown`. That is the correct type, because JavaScript
lets code throw anything. The handler must check or cast the value. The
compiler cannot tell whether the handler covers the failures that matter.

The `catch` syntax is not the problem. The problem starts earlier: the
function's signature leaves its failures out.

## The E channel names expected failures

Every Effect has three type parameters:

```text
Effect<A, E, R>
```

`A` is the success value. `E` is an expected failure. `R` is what the program
needs before it can run.

Here is a signature with a named failure:

```ts twoslash
import { Effect, Schema } from 'effect'

interface User {
  readonly id: string
  readonly name: string
}

class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  'UserNotFound',
  { userId: Schema.String },
) {}

declare const findUser: (
  id: string,
) => Effect.Effect<User, UserNotFound>
```

You do not need to learn `Schema.TaggedError` yet. Look at the last line. The
program may produce a `User`, and it may fail with `UserNotFound`. A caller can
learn both facts without opening the body.

When you combine programs, their expected failures stay in `E`. Say a second
step can fail with `SessionExpired`. The combined program then has both failure
types. A handler can decide what to do for each named case, instead of guessing
at an `unknown` value.

This is what "failure is a value" means. A failure is data that the program can
return through a separate channel. It can carry a tag and useful fields, such
as the missing user ID. Code can read it, transform it, or pass it to a caller,
and it never leaves the typed program as a thrown error.

## Not every bug belongs in E

`E` is not a list of every bad thing that could happen. It holds the failures
that a caller can act on.

A missing user is an expected failure. The program can show "user not found" or
use a fallback. It belongs in `E`.

A branch that should never run, a rule that should always hold but does not, or
a programmer mistake is different. The program has no useful way to recover.
Effect calls this a defect. A defect still stops the computation. But it does
not pretend to be a business result that every caller must handle.

Ask: "What should the caller do with this?" If there is a reasonable answer,
make it a specific expected failure. If the only answer is "fix the program,"
treat it as a defect.

Do not put every possible exception into one giant error type. That brings back
`unknown` under a new name. Typed failure helps only when each case means
something to the caller.

## What the compiler checks for you

TypeScript does not force you to handle every Effect failure before the program
runs. It does something simpler, and still useful: it keeps the known failure
types as you combine code.

When a function requires a narrower error channel, the compiler can reject a
program that still has an unhandled case. It checks tag-based handlers against
the failure types that really exist. If you change a failure type, the
signatures of the code that depends on it change too.

The compiler cannot choose how you recover. It can stop your recovery from
relying on a list of errors that is forgotten or made up.

Next, [Dependencies live in the type](/learn/mental-model/03-dependencies-in-the-type)
looks at `R`. Ordinary function signatures hide this information too.
