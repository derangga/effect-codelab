---
title: The Workspace Shape
order: 1
slug: 01-the-workspace-shape
summary: Create the empty monorepo, three packages that can import each other by name, and the tooling that checks it all.
---

Put a backend and a frontend in two separate repositories and they drift. The
backend renames `done` to `completed`, ships it, and the frontend keeps reading
`done` until someone notices the checkboxes are all empty. Each side compiles
fine on its own. The mistake lives in the gap between them.

A **monorepo** closes the gap. It is one repository holding several packages,
so a change to the shared part is checked against everyone who uses it, in the
same build. This chapter builds the empty shape of that repository. No Effect
code yet, just folders, config files and one install.

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

There is one rule, and it matters more than any tool: `server` and `web` may
import `domain`, and nothing else imports anything. `domain` imports neither of
them. If the server ever imported from `web`, a change to a button could break
the backend, and the whole point of the split would be gone.

Make the folders:

```sh
mkdir -p monorepo/packages/domain/src monorepo/apps/server/src monorepo/apps/web/src
cd monorepo
git init
```

## The root package.json

The root is not a package anyone imports. Its job is to list where the packages
are, and to hold the commands you run from the top.

```json
{
  "name": "effect-todo-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
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

`workspaces` is the important line. It tells Bun that every folder under
`apps/` and `packages/` is a package, and that they can depend on each other by
name. `bun --filter` runs a script in several packages at once, so
`bun run dev` will later start the server and the web page together.

## TypeScript 7 and the Effect checker

`typescript@7.0.2` is the new TypeScript compiler, rewritten to be much faster.
It still installs a command called `tsc`.

`@effect/tsgo` adds Effect-specific checks on top. Plain TypeScript cannot tell
that you created an Effect and then forgot to run it, because to TypeScript it
is just an unused value. The Effect checker knows better and reports it. The
`postinstall` script patches the installed `tsc` so these checks run every time
you typecheck, with no extra command to remember.

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

Three lines are worth knowing about.

- `strict: true` is required. Effect writes the ways a step can fail into its
  type, and without `strict` TypeScript reads those types wrong.
- `noEmit` and `allowImportingTsExtensions` say that TypeScript only checks the
  code, it never outputs JavaScript. Bun and Vite run `.ts` files directly, so
  there is nothing to build.
- The `plugins` entry turns on the Effect checker. Its errors fail the
  typecheck, its warnings only show in your editor.

## Biome and .gitignore

[Biome](https://biomejs.dev) formats and lints the code in one tool. Save this
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

And `.gitignore`. The `apps/server/data` line keeps the SQLite database out of
git:

```
node_modules
dist
apps/server/data
*.tsbuildinfo
.DS_Store
```

## The three package.json files

Each package gets its own `package.json`. Writing all three now means one
install covers the whole track.

`packages/domain/package.json` is the shared package. Look at `exports`: it
points straight at a TypeScript file. There is no build step, because both Bun
and Vite read `.ts` source directly.

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
    "effect": "4.0.0-rc.117"
  }
}
```

`apps/server/package.json`. The line `"@todo/domain": "workspace:*"` is how a
package depends on another package in the same repository. The test script
runs vitest through Bun, and [testing the
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
    "@effect/platform-bun": "4.0.0-rc.117",
    "@effect/sql-sqlite-bun": "4.0.0-rc.117",
    "@todo/domain": "workspace:*",
    "effect": "4.0.0-rc.117"
  },
  "devDependencies": {
    "@effect/vitest": "4.0.0-rc.117",
    "@types/bun": "latest",
    "vitest": "^5.0.1"
  }
}
```

`apps/web/package.json`:

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
    "@effect/atom-react": "4.0.0-rc.117",
    "@todo/domain": "workspace:*",
    "effect": "4.0.0-rc.117",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "scheduler": "^0.27.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6.1.1",
    "tailwindcss": "^4",
    "vite": "^8.3.0"
  }
}
```

Each package also needs a `tsconfig.json` that reuses the base. For
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

Here is what `workspaces` buys you. Give `domain` something to export, in
`packages/domain/src/index.ts`:

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
into `node_modules`, and TypeScript follows the `exports` field to the source
file. No relative path like `../../packages/domain/src` anywhere, and no build
in between.

## Check it works

From the repository root:

```sh
bun install
```

Near the end you should see the patch run:

```
$ effect-tsgo patch --typescript
Patched typescript at .../node_modules/@typescript/typescript-darwin-arm64/lib/tsc
```

If that line is there, every future `tsc` run includes the Effect checks. Then
type the throwaway export above into `packages/domain/src/index.ts` and run:

```sh
bun --filter @todo/domain typecheck
```

It exits with no output, which is what success looks like for `tsc`. Delete the
`greeting` line again before moving on. The next chapter replaces it.

## What people get wrong

**Mixing Effect versions.** `bun add effect@rc` in one package and a pinned
version in another installs two copies of `effect`. The types from one copy do
not match the other, and you get errors like "Type 'Effect' is not assignable
to type 'Effect'". Pin the exact same version everywhere, as above.

**Forgetting the patch.** If `bun install` ran before `@effect/tsgo` was in the
root `package.json`, the patch never happened. Run
`bunx effect-tsgo patch --typescript` once by hand.

## Next

The workspace is empty but wired. [The Todo in
Schema](/learn/fullstack-monorepo/02-the-todo-in-schema) puts the first real
thing in `domain`: a description of a todo that works as a type and as a
runtime check.
