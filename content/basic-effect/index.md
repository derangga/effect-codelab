---
title: Basic Effect
order: 2
theme: foundations
level: beginner
icon: BookOpen
summary: Nine chapters that rebuild one fetch against a public product API until every way it can fail is written in its type, then build an in-memory product catalog as a service with a layer and a test suite.
prereq: TypeScript generics, tagged unions, modules, async/await, and Promises
---

This course takes one ordinary function, a `fetch` against a public product
API, and rebuilds it until every way it can fail is written in its type. From
chapter four the course leaves the network behind and builds the same kind of
module over an in-memory catalog. By the last chapter it is a service, its
dependencies arrive through a layer, its one setting comes from the
environment, and its tests run in memory.

The API is [fakestoreapi.com](https://fakestoreapi.com). It is free, it needs
no key, and it holds twenty products. It also has one habit that makes it
better teaching material than a well behaved API would be. Ask it for a product
that does not exist and it answers `200 OK` with an empty body. Chapter one
walks into that on purpose, and chapter three makes sure it can never surprise
you again.

## What you need

Pick the package manager you already use. The commands below pin `effect` and
the compiler to exact versions. A version range moves the types out from under
code that compiled yesterday. Every `effect` and `@effect/*` package shares one
version number, and they must match exactly.

Start in an empty folder, then run the commands for your package manager.
Whatever you pick, `strict` has to be on in `tsconfig.json`. Effect reads the
failure and requirement channels off your code, and without `strict` those
readings are wrong in ways that are hard to notice. Bun writes a suitable
`tsconfig.json` for you. For the other package managers, use this one:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

#### Tab: bun

`bun init -y` creates `index.ts` and a `tsconfig.json` that already has `strict`
on.

```sh
bun init -y
bun add --exact effect@4.0.0
bun add -d --exact typescript@7.0.2
```

#### Tab: npm

`npm init -y` creates only a `package.json`. Create an empty `index.ts` and the
`tsconfig.json` shown above. `tsx` runs TypeScript
files directly, including the extensionless imports like `./product` that later
chapters use.

```sh
npm init -y
npm install --save-exact effect@4.0.0
npm install --save-dev --save-exact typescript@7.0.2 tsx@4.23.15
```

#### Tab: pnpm

`pnpm init` creates only a `package.json`. Create an empty `index.ts` and the
`tsconfig.json` shown above. `tsx` runs TypeScript
files directly, including the extensionless imports like `./product` that later
chapters use.

```sh
pnpm init
pnpm add --save-exact effect@4.0.0
pnpm add --save-dev --save-exact typescript@7.0.2 tsx@4.23.15
```

#### Tab: yarn

`yarn init -y` creates only a `package.json`. Create an empty `index.ts` and the
`tsconfig.json` shown above. `tsx` runs TypeScript
files directly, including the extensionless imports like `./product` that later
chapters use.

```sh
yarn init -y
yarn add --exact effect@4.0.0
yarn add --dev --exact typescript@7.0.2 tsx@4.23.15
```

#### Tab: deno

`deno init` creates `main.ts` and a `deno.json`. Create `index.ts` next to it and
use that file for the chapters. Deno type checks with its own compiler and
runs in `strict` mode by default, so there is no `typescript` package or
`tsconfig.json` to add.

```sh
deno init
deno add --save-exact npm:effect@4.0.0
```

### Run a file

Deno blocks network and environment access unless you allow it, and chapters
one and seven need both. The Deno flag `--unstable-sloppy-imports` lets it
resolve imports like `./product` that have no file extension.

#### Tab: bun

```sh
bun run index.ts
```

#### Tab: npm

```sh
npx tsx index.ts
```

#### Tab: pnpm

```sh
pnpm exec tsx index.ts
```

#### Tab: yarn

```sh
yarn tsx index.ts
```

#### Tab: deno

```sh
deno run --unstable-sloppy-imports --allow-net --allow-env index.ts
```

### Packages and runtimes

Chapter one is the one place where the runtimes disagree, and it says so.

Packages arrive when a chapter needs them. Chapter nine installs a test runner.
Chapter seven reads an environment variable, but it has a default, so there is
no env file to write.

## Which file you are editing

A code block that belongs in a file opens with the file's name:

```ts
// index.ts
```

For the first three chapters there is only `index.ts`, and each chapter
rewrites part of it. When a block replaces something you wrote earlier, the comment with the file
name says so. Chapter four starts a new file, `product.ts`, and leaves
`index.ts` behind. Chapter eight adds `main.ts` and chapter nine adds
`product.test.ts`. A block without a file name is an illustration to read, not
something to save.

Chapters two, three, four, six, seven and nine each print the whole file as it
should look, so a missed edit shows up as a difference rather than a mystery.
Chapter eight prints `product.ts` in one piece.

The snippets compile as the real set of files you are building, not as isolated
examples, so an import that does not resolve or a type that does not line up
across two files fails this site's build rather than reaching you.

## How the chapters work

Each chapter opens with something the previous chapter left broken, fixes it
with one idea, and shows the mistake people make with that idea. Read them in
order. Chapters one through three grow a single file, chapters four through
eight turn it into a module, and chapter eight prints the finished thing in one
piece.

You can read the whole course without writing any code. If you would rather
build it, the file names are there for exactly that.

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

## About the terminal output

The terminal blocks in chapters one to three are copied from real runs against
the live API on 16 September 2026. The data is theirs and it moves, so a price
or a title on this page may not be the one you get. The shapes will be. The
blocks in chapters eight and nine are real runs of the finished module, and
those do not change.

If the API is down when you read this, chapters four to nine keep working,
because from chapter four nothing you run touches the network.

## What this course leaves out

The track stops where the service boundary is. HTTP clients, servers and
routing, SQL, streams, scopes and resource cleanup, frontend state, metrics,
and deployment are all out of scope, and each belongs to a track that starts
from the module you finish here.

The requests here go through the global `fetch`, wrapped. That is the smallest
thing that works, and it keeps the lessons about the three channels rather than
about a client library. The
[HTTP Auth API](/learn/http-auth-api) track is where a real Effect HTTP stack
shows up.

If you want the same material read from the other side, the
[anti-patterns track](/learn/anti-patterns) collects the habits that undo it.
