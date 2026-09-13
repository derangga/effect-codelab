---
title: Basic Effect
order: 2
theme: foundations
level: beginner
icon: BookOpen
prereq: TypeScript generics, tagged unions, modules, async/await, and Promises
summary: Nine chapters that build a tested product catalog service with Effect v4, from the three type channels to layers, config, and Effect-native tests.
---

This course takes you from no Effect experience to a portable `ProductService`
that lists, finds, and creates products, backed by an in-memory repository,
wired by layers, and tested with `@effect/vitest`.

The catalog is small on purpose. It has the same concerns a production request
has, which is what makes it worth building: unknown input to validate, failures
worth naming, state that must not leak between callers, a setting from the
environment, and two services with a real boundary between them.

Every code block in this course is complete and typechecked at build time. You
can read the whole thing without writing any code. If you would rather build it
alongside, the setup below takes a few minutes.

## Setting up a project

These steps assume [Bun](https://bun.sh). Every command has an npm or pnpm
equivalent, and nothing in the course depends on the runtime you pick.

### 1. Create the project

```sh
mkdir effect-catalog
cd effect-catalog
bun init -y
```

### 2. Install Effect

Every `effect` and `@effect/*` package shares one version number, and they must
match exactly. These are the versions this course is written and tested
against:

```sh
bun add effect@4.0.0-rc.113
bun add -d @effect/vitest@4.0.0-rc.113
bun add -d vitest@4.1.10 typescript@6.0.3
```

Effect v4 is in release candidate. Pin the versions rather than using a range,
because the API is still moving between release candidates.

### 3. Turn on strict mode

Effect infers the failure and requirement channels from your code, and without
`strict` those inferences are wrong in ways that are hard to notice. Put this
in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

`strict` is the only line here that is not negotiable.

### 4. Install the Effect language service

This is optional for the first two chapters and worth having by chapter three.
It catches Effect-specific mistakes TypeScript alone cannot see, the most
valuable being a floating Effect, which is an Effect you built and never
yielded. That one is silent otherwise.

```sh
bun add -d @effect/tsgo@0.45.0
```

The package installs as `@effect/tsgo`, and the plugin name stays
`@effect/language-service`. Add it to the same `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }]
  }
}
```

Then point your editor at the workspace TypeScript, or the plugin will not
load. In VS Code, open the command palette, run `TypeScript: Select TypeScript
Version`, and choose `Use Workspace Version`. In a JetBrains IDE, it is
Settings, Languages and Frameworks, TypeScript, Use workspace version.

### 5. Add the commands you will run

In `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`typecheck` is the one you will use constantly. Most of this course is about
reading types, and most of the feedback comes from that command or from your
editor.

### 6. Check it works

Put this in `src/main.ts`:

```ts twoslash
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  yield* Effect.log('Effect is set up')
  return 1 + 1
})

Effect.runPromise(program).then(console.log)
```

Then run it:

```sh
bun run src/main.ts
```

You should see a timestamped log line and then `2`. If you do, everything in
this course will run for you.

## How the chapters work

Each chapter opens with a problem, builds one or two ideas against the product
catalog, and shows the mistake people make with them. Code is written out in
full on the page. Where a chapter needs something an earlier chapter built, it
declares the type rather than reprinting the implementation, so every example
stays readable and every example compiles.

Read them in order. Chapters four through eight build one continuous module,
and chapter eight prints the finished thing in one piece.

## Roadmap

1. [The Effect model](/learn/basic-effect/01-effect-model)
2. [Constructing and composing Effects](/learn/basic-effect/02-composition)
3. [Typed errors and recovery](/learn/basic-effect/03-typed-errors)
4. [Schemas and domain modeling](/learn/basic-effect/04-schemas)
5. [Design the product service](/learn/basic-effect/05-design)
6. [Services with Context.Service](/learn/basic-effect/06-services)
7. [Repository state, layers, and config](/learn/basic-effect/07-layers)
8. [The ProductService capstone](/learn/basic-effect/08-capstone)
9. [Effect-native testing and review](/learn/basic-effect/09-testing)

## What this course leaves out

The track stops at the portable service boundary. HTTP, SQL, streams, scopes
and resource cleanup, frontend state, metrics, and deployment are deliberately
out of scope, and each belongs to a track that starts from the module you
finish here.

If you want the same material read from the other side, the
[anti-patterns track](/learn/anti-patterns) collects the habits that undo it.
