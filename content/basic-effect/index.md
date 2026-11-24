---
title: Basic Effect
order: 2
theme: foundations
level: beginner
icon: BookOpen
summary: Nine chapters that rebuild one fetch against a public product API until its type lists every way it can fail, then build an in-memory product catalog as a service with a layer and a test suite.
prereq: TypeScript generics, tagged unions, modules, async/await, and Promises
---

This course starts with one ordinary function, a `fetch` call to a public
product API. You rebuild it as an Effect, a value that describes work to do.
Nothing runs until you run it. An Effect has three channels, which are its
type slots for success, failure and requirement. You rebuild the function until
its error channel lists every way it can fail.

After the typed errors chapter, the course leaves the network and builds the
same kind of module over an in-memory catalog. By the end, the module is a service, which is an object of related functions
that other code asks for by name. Its dependencies arrive through a layer, which
is a recipe that builds a service. Its one setting comes from the environment,
and its tests run in memory.

The API is [fakestoreapi.com](https://fakestoreapi.com). It is free, needs no
key, and holds 20 products. It also has a habit that makes it better teaching
material than a well-behaved API. If you ask for a product that does not exist,
it answers `200 OK` with an empty body. [The Effect model](/learn/basic-effect/01-effect-model) runs into this on
purpose. [Typed errors and recovery](/learn/basic-effect/03-typed-errors) makes
sure it can never surprise you again.

## What you need

Use the package manager you already have. The commands below pin `effect` and
the compiler to exact versions, because a version range can change types under
code that compiled yesterday. Every `effect` and `@effect/*` package shares one
version number, and they must match exactly.

Start in an empty folder and use the tab for your package manager.
Whichever you pick, turn on `strict` in `tsconfig.json`. Effect reads the error
channel and the requirement channel from your code. Without `strict`, it reads
them wrongly, in ways that are hard to notice. Bun writes a suitable
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
`tsconfig.json` shown above. `tsx` runs TypeScript files directly, including
extensionless imports such as `./product`, which later chapters use.

```sh
npm init -y
npm install --save-exact effect@4.0.0
npm install --save-dev --save-exact typescript@7.0.2 tsx@4.23.15
```

#### Tab: pnpm

`pnpm init` creates only a `package.json`. Create an empty `index.ts` and the
`tsconfig.json` shown above. `tsx` runs TypeScript files directly, including
extensionless imports such as `./product`, which later chapters use.

```sh
pnpm init
pnpm add --save-exact effect@4.0.0
pnpm add --save-dev --save-exact typescript@7.0.2 tsx@4.23.15
```

#### Tab: yarn

`yarn init -y` creates only a `package.json`. Create an empty `index.ts` and the
`tsconfig.json` shown above. `tsx` runs TypeScript files directly, including
extensionless imports such as `./product`, which later chapters use.

```sh
yarn init -y
yarn add --exact effect@4.0.0
yarn add --dev --exact typescript@7.0.2 tsx@4.23.15
```

#### Tab: deno

`deno init` creates `main.ts` and a `deno.json`. Create `index.ts` next to them
and use it for the chapters. Deno type checks with its own compiler and runs in
`strict` mode by default, so you add no `typescript` package or `tsconfig.json`.

```sh
deno init
deno add --save-exact npm:effect@4.0.0
```

### Run a file

Deno blocks network and environment access unless you allow it. The Effect model chapter and the layers chapter need both. The Deno flag `--unstable-sloppy-imports` lets Deno resolve
imports without a file extension, such as `./product`.

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

The runtimes differ in only one place, and the Effect model chapter says where.

You install packages when a chapter needs them. The testing chapter installs a
test runner. The layers chapter reads an environment variable with a default,
so you write no env file.

## Which file you are editing

A code block that belongs in a file starts with a comment that names the file:

```ts
// index.ts
```

The chapters before the schemas chapter use only `index.ts`, and each one
rewrites part of it. When a block replaces code you wrote earlier, the file name comment says so.
The schemas chapter starts a new file, `product.ts`, and leaves `index.ts`
behind. The capstone chapter adds `main.ts`, and the testing chapter adds
`product.test.ts`. A block without a file name is an illustration to read, not
something to save.

Six chapters print the whole file as it should look: composition, typed errors,
schemas, services, layers and testing. Compare it with yours to find a missed
edit. The capstone chapter prints `product.ts` in one piece.

The snippets compile as the real set of files you build, not as separate
examples. If an import fails to resolve or a type does not match across two
files, this site's build fails, so you never meet the error.

## How the chapters work

Each chapter starts with a problem the previous chapter left open. It fixes the
problem with one idea, then shows the mistake people make with that idea. Read
the chapters in order. The chapters before the schemas chapter grow a single file. The chapters from
schemas to the capstone turn it into a module.

You can read the course without writing code. To build along, use the file
names to place each block.

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

The terminal output in the Effect model, composition and typed errors chapters
comes from real runs against the
live API on 16 September 2026. That data changes, so your prices and titles may
differ from the page. The shapes stay the same. The output in the capstone and
testing chapters comes from real runs of the finished module and does not
change.

If the API is down, you can still run everything from the schemas chapter on.
None of that code uses the network.

## What this course leaves out

The course ends at the service boundary and does not cover HTTP clients,
servers and routing, SQL, streams, scopes and resource cleanup, frontend state,
metrics, or deployment. Each belongs to a track that starts from the module you
finish here.

Requests in this course use the global `fetch`, wrapped in an Effect. This is
the smallest approach that works, and it keeps the lessons on the three
channels, not on a client library. The [HTTP Auth API](/learn/http-auth-api)
track shows a real Effect HTTP stack.

The [anti-patterns track](/learn/anti-patterns) covers the same material from
the other side. It collects the habits that undo what this course teaches.
