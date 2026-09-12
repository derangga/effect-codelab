---
title: Failure is a Value
order: 2
slug: 02-failure-is-a-value
summary: throw hides what can go wrong from the type. Effect puts expected failures in the signature, where callers can see them.
---

TypeScript records what a function returns. It does not record what the
function throws.

That omission is easy to live with while you own the whole call stack. It gets
expensive when the code grows. Every caller must remember which failures are
possible, what shape they have, and which ones are safe to handle.

Effect keeps expected failure as part of the program's value and type.

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
ways still have the same return type.

The missing information usually survives in prose, tests, or somebody's
memory. None of those gives the compiler anything to check.

## Catch recovers too little information

A `catch` block does not restore what the signature omitted.

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

The caught value is `unknown`. That is the honest type because JavaScript lets
code throw anything. The handler must inspect or cast the value, and the
compiler cannot tell whether it covered the failures that matter.

The problem is not the `catch` syntax. The problem happened earlier, when the
function's contract discarded its failures.

## The E channel names expected failure

Every Effect has three type parameters:

```text
Effect<A, E, R>
```

`A` is the success value. `E` is an expected failure. `R` is something the
program needs before it can run.

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

You do not need to learn `Schema.TaggedError` yet. Read the final line. The
program may produce a `User`, and it may fail with `UserNotFound`. A caller can
learn both facts without opening the body.

When programs are combined, their expected failures remain in `E`. If a second
step can fail with `SessionExpired`, the combined program carries both types.
A handler can then make a decision for each named case instead of guessing at
an `unknown` value.

This is what "failure is a value" means. A failure is data that the program can
return through a separate channel. It can carry a tag and useful fields such
as the missing user ID. Code can inspect it, transform it, or pass it to a
caller without throwing it out of the typed program.

## Not every bug belongs in E

The error channel is a contract, not a list of every bad event imaginable.

A missing user can be expected. The program can show "user not found" or choose
a fallback. It belongs in `E`.

An impossible branch, a broken invariant, or a programmer mistake is different.
The program has no useful recovery plan. Effect calls this a defect. Defects
still stop the computation, but they do not pretend to be a business outcome
that every caller should handle.

A practical test is to ask, "What should the caller do with this?" If there is
a reasonable answer, model a specific expected failure. If the only honest
answer is "fix the program," treat it as a defect.

This line matters. Putting every possible exception into one giant error type
recreates `unknown` under a new name. Typed failure helps only when its cases
mean something to the caller.

## What the compiler can now protect

TypeScript does not force every Effect failure to be handled before the program
runs. It does something more basic and still useful: it preserves the known
failure types while code is composed.

Functions that require a narrower error channel can reject an unhandled case.
Tag-based handlers can be checked against the actual variants. Refactoring a
failure type changes the signatures of the code that depends on it.

The compiler cannot choose a recovery policy. It can stop that policy from
being based on a forgotten or invented list of errors.

Next, [Dependencies Live in the Type](/learn/mental-model/03-dependencies-in-the-type)
looks at `R`, the other information ordinary function signatures tend to hide.
