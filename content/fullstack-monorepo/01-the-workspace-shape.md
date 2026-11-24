---
title: The workspace shape
order: 1
slug: 01-the-workspace-shape
summary: Create the empty monorepo, with three packages that import each other by name, and the tools that check it.
---

Put a backend and a frontend in two separate repositories and they drift apart.
The backend renames `done` to `completed` and ships it. The frontend keeps
reading `done` until someone notices that every checkbox is empty. Each side
compiles on its own. The mistake sits in the gap between them.

A **monorepo** closes that gap. It is one repository that holds several
packages. A change to the shared part is checked against everything that uses
it, in the same build. This chapter builds the empty shape of that repository.
It has no Effect code yet, only folders, config files and one install.

## The three packages

```
monorepo/
├── package.json          the workspace root
├── packages/
│   └── domain/           shared: what a todo is, what the API looks like
└── apps/
    ├── server/           answers HTTP requests, stores todos in SQLite
    └── web/              the React page
```

There is one rule, and it matters more than any tool. `server` and `web` may
import `domain`. Nothing else imports anything. `domain` imports neither of
them. If the server imported from `web`, a change to a button could break the
backend, and the split would have no point.

Make the folders:

```sh
mkdir -p monorepo/packages/domain/src monorepo/apps/server/src monorepo/apps/web/src
cd monorepo
git init
```

## The root package.json

The root is not a package that anyone imports. It lists where the packages are
and holds the commands you run from the top.

```json
{
  "name": "effect-todo-monorepo",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "postinstall": "effect-tsgo patch --typescript",
    "dev": "bun --filter './apps/*' dev",
    "typecheck": "bun --filter '*' typecheck",
    "test": "bun --filter '*' test",
    "lint": "biome check .",
    "format": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.14",
    "@effect/tsgo": "0.45.0",
    "typescript": "7.0.2"
  }
}
```

`workspaces` is the key line. It tells Bun that every folder under `apps/` and
`packages/` is a package, and that packages can depend on each other by name.
`bun --filter` runs a script in several packages at once. Later, `bun run dev`
will start the server and the web page together.

## TypeScript 7 and the Effect checker

`typescript@7.0.2` is the new TypeScript compiler, rewritten to be much faster.
It still installs a command called `tsc`.

`@effect/tsgo` adds Effect-specific checks on top. An Effect is a value that
describes work to do, and nothing happens until you run it. Plain TypeScript
cannot tell that you created an Effect and forgot to run it. To TypeScript, that
is just an unused value. The Effect checker reports it. The `postinstall` script
patches the installed `tsc`, so these checks run on every typecheck. You have no
extra command to remember.

The shared compiler settings go in `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "@effect/language-service", "ignoreEffectWarningsInTscExitCode": true }]
  }
}
```

Three settings matter most.

- `strict: true` is required. Effect writes the ways a step can fail into its
  type. Without `strict`, TypeScript reads those types wrong.
- `noEmit` and `allowImportingTsExtensions` make TypeScript check the code only.
  It never writes JavaScript. Bun and Vite run `.ts` files directly, so there is
  nothing to build.
- The `plugins` entry turns on the Effect checker. Its errors fail the
  typecheck. Its warnings show only in your editor.

## Biome and .gitignore

[Biome](https://biomejs.dev) formats and lints the code with one tool. Save this
as `biome.json`:

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "files": {
    "includes": ["**", "!**/node_modules", "!**/dist"]
  },
  "formatter": {
    "indentStyle": "space",
    "lineWidth": 120
  },
  "javascript": {
    "formatter": {
      "semicolons": "asNeeded"
    }
  },
  "css": {
    "parser": { "tailwindDirectives": true }
  }
}
```

Next, create `.gitignore`. The `apps/server/data` line keeps the SQLite database
out of git:

```
node_modules
dist
apps/server/data
*.tsbuildinfo
.DS_Store
```

## The three package.json files

Each package gets its own `package.json`. Write all three now, so that one
install covers the whole track.

`packages/domain/package.json` is the shared package. Look at `exports`. It
points straight at a TypeScript file. There is no build step, because Bun and
Vite both read `.ts` source directly.

```json
{
  "name": "@todo/domain",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "effect": "4.1.5"
  }
}
```

Next is `apps/server/package.json`. The line `"@todo/domain": "workspace:*"`
is how one package depends on another package in the same repository. The test
script runs vitest through Bun. [Testing the
API](/learn/fullstack-monorepo/07-testing-the-api) explains why.

```json
{
  "name": "@todo/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/main.ts",
    "start": "bun src/main.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "bun --bun vitest run"
  },
  "dependencies": {
    "@effect/platform-bun": "4.1.5",
    "@effect/sql-sqlite-bun": "4.1.5",
    "@todo/domain": "workspace:*",
    "effect": "4.1.5"
  },
  "devDependencies": {
    "@effect/vitest": "4.1.5",
    "@types/bun": "1.4.2",
    "vitest": "5.0.3"
  }
}
```

Last is `apps/web/package.json`:

```json
{
  "name": "@todo/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@effect/atom-react": "4.1.5",
    "@todo/domain": "workspace:*",
    "effect": "4.1.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "scheduler": "0.27.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "tailwindcss": "4.3.3",
    "vite": "8.3.0"
  }
}
```

Each package also needs a `tsconfig.json` that reuses the base. Start with
`packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

For `apps/server/tsconfig.json`, which adds Bun's types:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": ["src"]
}
```

For `apps/web/tsconfig.json`, which adds the browser types and JSX:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

## Importing by name

Here is what `workspaces` gives you. Give `domain` something to export. Later,
you will add `export const greeting = "hello from domain"` to
`packages/domain/src/index.ts`. This throwaway line in the server imports it:

```ts twoslash
// @filename: node_modules/@todo/domain/index.ts
export const greeting = "hello from domain"
// @filename: apps/server/src/main.ts
// ---cut---
// apps/server/src/main.ts, a throwaway line to prove the link works
import { greeting } from "@todo/domain"

const message = greeting
//    ^?
```

The server imports `@todo/domain` as if it came from npm. Bun links the folder
into `node_modules`. TypeScript follows the `exports` field to the source file.
There is no relative path like `../../packages/domain/src`, and no build step in
between.

## Check it works

From the repository root, run:

```sh
bun install
```

Near the end of the output, you should see the patch run:

```
$ effect-tsgo patch --typescript
Patched typescript at .../node_modules/@typescript/typescript-darwin-arm64/lib/tsc
```

If you see that line, every future `tsc` run includes the Effect checks. Next,
add the throwaway export `export const greeting = "hello from domain"` to
`packages/domain/src/index.ts`. Then run:

```sh
bun --filter @todo/domain typecheck
```

```
@todo/domain typecheck: Exited with code 0
```

`tsc` itself prints nothing when the code is clean. The line above comes from
`bun --filter`, which reports each package when its script finishes. Code 0
means success. Delete the `greeting` line before you move on. The next chapter
replaces it.

## What people get wrong

Mixing Effect versions causes errors that are hard to read. Run
`bun add effect@rc` in one package and pin a version in another, and Bun
installs two copies of `effect`. The types from one copy do not match the other.
You get errors like "Type 'Effect' is not assignable to type 'Effect'". Pin the
exact same version everywhere, as above.

Forgetting the patch is easy to do. If `bun install` ran before `@effect/tsgo`
was in the root `package.json`, the patch never happened. Run
`bunx effect-tsgo patch --typescript` once by hand.

## Next

The workspace is empty but wired. [The todo in
Schema](/learn/fullstack-monorepo/02-the-todo-in-schema) puts the first real
piece in `domain`: a description of a todo that works as a type and as a check
on real data.
