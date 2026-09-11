---
title: Unlearning try, catch and await
order: 4
slug: 04-unlearning-the-keywords
summary: A keyword by keyword translation, and the reason each replacement is a function rather than syntax.
draft: true
---

## Four keywords, four replacements

A table up front: `await` becomes `yield*`, `throw` becomes a failure in `E`,
`try`/`catch` becomes the constructors and the handlers, `finally` becomes
scope. Then take them one at a time.

## await becomes yield*

`Effect.gen` and why reading it feels like `async` code. Note the one real
difference, which is that nothing has run yet.

## throw becomes a typed failure

`Effect.fail` and a tagged error. The same information, in the signature
instead of in a comment.

## try and catch become constructors and handlers

`Effect.try` at the point where foreign code might throw, and handling at the
point where a decision gets made. Say plainly that these are usually far apart.

## finally becomes scope

Acquire and release as a pair the runtime holds onto, so cleanup survives
failure and interruption. A signpost, not a lesson.

## Why functions and not syntax

The one paragraph that ties the track together: everything here is a value, so
everything composes, and that is what syntax could not give you.

## Next

Point at Basic Effect for the API itself, and note that Design Thinking, the
last page here, expects that track first.
