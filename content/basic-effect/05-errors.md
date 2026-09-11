---
title: Errors
order: 5
slug: 05-errors
summary: Failures you name, failures the compiler tracks, and the difference between a failure and a bug.
---

This is the chapter where the extra typing from the last four starts paying
for itself.

Here is the problem with ordinary error handling. Look at this function and
tell me what it can throw.

```ts twoslash
declare function loadPort(path: string): number
```

You cannot. TypeScript does not track thrown values, so `catch` hands you
`unknown` and you are left guessing at runtime. Miss a case and you find out
in production.

Effect's answer is that failures are values in the `E` slot, and the compiler
tracks them the same way it tracks return types.

## Naming a failure

Define errors with `Schema.TaggedError`. It gives you a class with a `_tag`
field and typed fields of your choosing.

```ts twoslash
import { Schema } from 'effect'

class FileNotFound extends Schema.TaggedError<FileNotFound>()('FileNotFound', {
  path: Schema.String,
}) {}

class BadFormat extends Schema.TaggedError<BadFormat>()('BadFormat', {
  raw: Schema.String,
}) {}
```

Read the noise once and then stop thinking about it. The class name appears
three times because TypeScript cannot infer a class's own type from inside its
definition. The string is the tag, and it is what you will match on later.

The fields are where you put what someone will need in order to react. A
failure that says only "something went wrong" is barely better than throwing.
`FileNotFound` carries the path, so the handler can say which file.

Raise one by yielding it.

```ts twoslash
import { Effect, Schema } from 'effect'
class FileNotFound extends Schema.TaggedError<FileNotFound>()('FileNotFound', {
  path: Schema.String,
}) {}
// ---cut---
const readConfig = Effect.gen(function* () {
  const found = false

  if (!found) {
    return yield* new FileNotFound({ path: 'config.json' })
  }

  return 'contents'
})
```

Write `return yield*` rather than just `yield*` when raising. The Effect stops
either way, but the `return` is what tells TypeScript the function does not
continue, which keeps the inferred type honest.

## Handling one failure at a time

`Effect.catchTag` handles a single named failure. The part worth watching is
what happens to the type.

```ts twoslash
import { Effect, Schema } from 'effect'
class FileNotFound extends Schema.TaggedError<FileNotFound>()('FileNotFound', {
  path: Schema.String,
}) {}
class BadFormat extends Schema.TaggedError<BadFormat>()('BadFormat', {
  raw: Schema.String,
}) {}
declare const load: Effect.Effect<number, FileNotFound | BadFormat>
// ---cut---
const handled = load.pipe(Effect.catchTag('FileNotFound', () => Effect.succeed(8080)))
//    ^?
```

`FileNotFound` is gone from the type and `BadFormat` is still there. The
compiler is keeping score. It knows which failures you have dealt with and
which are still outstanding, and it will keep the remainder in the signature
until somebody handles them.

That is the whole idea. You are not asked to remember what can go wrong,
because the type says so, and it shrinks only when you actually do something.

Handle several at once by passing a list, or by naming each one.

```ts twoslash
import { Effect, Schema } from 'effect'
class FileNotFound extends Schema.TaggedError<FileNotFound>()('FileNotFound', {
  path: Schema.String,
}) {}
class BadFormat extends Schema.TaggedError<BadFormat>()('BadFormat', {
  raw: Schema.String,
}) {}
declare const load: Effect.Effect<number, FileNotFound | BadFormat>
// ---cut---
const both = load.pipe(Effect.catchTag(['FileNotFound', 'BadFormat'], () => Effect.succeed(8080)))
//    ^?
```

```ts twoslash
import { Effect, Schema } from 'effect'
class FileNotFound extends Schema.TaggedError<FileNotFound>()('FileNotFound', {
  path: Schema.String,
}) {}
class BadFormat extends Schema.TaggedError<BadFormat>()('BadFormat', {
  raw: Schema.String,
}) {}
declare const load: Effect.Effect<number, FileNotFound | BadFormat>
// ---cut---
const each = load.pipe(
  Effect.catchTags({
    FileNotFound: (error) => Effect.succeed(error.path.length),
    BadFormat: () => Effect.succeed(8080),
  }),
)
```

Use `catchTags` when the failures deserve different responses, which is
usually the case. If two failures always get the same treatment, ask whether
they should have been one failure.

There is also `Effect.catch`, which handles everything at once.

```ts twoslash
import { Effect, Schema } from 'effect'
class FileNotFound extends Schema.TaggedError<FileNotFound>()('FileNotFound', {
  path: Schema.String,
}) {}
declare const load: Effect.Effect<number, FileNotFound>
// ---cut---
const safe = load.pipe(Effect.catch(() => Effect.succeed(8080)))
//    ^?
```

It is the right tool at the very edge of a program, where something has to
turn into a response. Reach for it too early and you have thrown away the
information the last four chapters worked to keep.

## Failures and defects are not the same thing

Effect splits things that go wrong into two kinds, and the split is more
useful than it first sounds.

An **expected failure** is a thing you knew could happen. The file might be
missing. The server might answer 404. The input might not parse. These belong
in `E`, and callers are meant to handle them.

A **defect** is a bug. An undefined property, a broken invariant, a case you
believed impossible. Defects are not in `E`, because there is no sensible
handler for a mistake you did not know you had made. They travel up and crash
the program, which is what you want, because the fix is a code change and not
a `catch`.

This is why chapter three said to prefer `Effect.try` over `Effect.sync` when
unsure. `sync` promises the function will not throw. If it throws anyway, that
is a broken promise, so Effect treats it as a defect rather than quietly
adding it to `E`.

You can move a failure into the defect category on purpose.

```ts twoslash
import { Effect, Schema } from 'effect'
class Impossible extends Schema.TaggedError<Impossible>()('Impossible', {}) {}
declare const load: Effect.Effect<number, Impossible>
// ---cut---
const assumed = load.pipe(Effect.orDie)
//    ^?
```

`Effect.orDie` says: I know the type allows this failure, but it cannot really
happen here, and if I am wrong I want to know loudly. The error channel
becomes `never`. Use it when you have genuinely ruled a failure out, not to
quiet the compiler.

## A rule for choosing

Ask who fixes it.

If the caller can do something sensible, it is an expected failure, so give it
a tagged error with the fields they will need. If the only real fix is a code
change, it is a defect, so let it crash and read the stack trace.

Most of what people throw today is the first kind pretending to be the second.

## Next

Chapter six is about `Schema`, the module those error classes came from. Its
real job is turning unknown data, such as a JSON response, into typed values,
with failures that land in the channel you just learned about.
