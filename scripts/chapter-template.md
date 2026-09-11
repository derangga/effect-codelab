---
title: Chapter title
order: 0
slug: 00-chapter-slug
summary: One sentence, shown in the sidebar and on the home page.
---

Open with the problem. Two or three sentences on what is annoying or unsafe
about doing this without Effect. Do not open with a definition.

## The idea

Build it up in small steps. Every claim about types gets a compiled snippet.

```ts twoslash
import { Effect } from 'effect'

const program = Effect.succeed(1)
//    ^?
```

## What people get wrong

State it plainly and show the fix.

```ts twoslash
// @errors: 2322
import { Effect } from 'effect'

const wrong: Effect.Effect<string> = Effect.succeed(1)
```

## Next

One or two sentences pointing at the following chapter.
