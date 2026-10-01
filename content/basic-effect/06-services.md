---
title: Services with Context.Service
order: 6
slug: 06-services
summary: Build the service pattern from the problem it solves, starting with dependencies as arguments, then as a requirement in the type, then as a Context.Service with make and Effect.fn.
---

Start with the version that needs no new concepts. The repository is an object
of functions, and whoever needs it gets passed it.

```ts twoslash
interface Product { readonly id: string; readonly name: string }
// ---cut---
import { Effect } from 'effect'
interface ProductRepository {
  readonly list: () => Effect.Effect<ReadonlyArray<Product>>
}

const countProducts = (repository: ProductRepository) =>
  Effect.gen(function* () {
    const products = yield* repository.list()
    return products.length
  })
```

This is fine. It is testable, it is explicit, and for one function at one level
of depth it is better than anything below.

It stops being fine at the third level.

```ts twoslash
interface Product { readonly id: string; readonly name: string }
interface ProductRepository {
  readonly list: () => Effect.Effect<ReadonlyArray<Product>>
}
interface Logger { readonly info: (message: string) => Effect.Effect<void> }
interface Clock { readonly now: () => Effect.Effect<number> }
// ---cut---
import { Effect } from 'effect'
const buildReport = (
  repository: ProductRepository,
  logger: Logger,
  clock: Clock,
) =>
  Effect.gen(function* () {
    const products = yield* repository.list()
    yield* logger.info('built report')
    return { at: yield* clock.now(), size: products.length }
  })
```

Every caller of `buildReport` now needs all three, whether or not it uses them.
Its callers need them too. Adding one dependency deep in the tree edits every
function between there and the top, and the signatures stop describing what a
function does and start describing what its children need.

Effect's answer is the third type parameter you have been ignoring.

## A requirement is a value in the type

`R` lets an Effect say what it needs without being handed it. The need is
recorded in the type and satisfied later, once, at the place that knows how to
build it.

That is the whole idea. Everything else in this chapter is the mechanics of
putting a thing into `R` and getting it back out.

## A service is a key with a shape attached

```ts twoslash
interface Product { readonly id: string; readonly name: string }
// ---cut---
import { Context, Effect } from 'effect'
class ProductRepository extends Context.Service<
  ProductRepository,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Product>>
  }
>()('ProductRepository') {}
```

Two things came out of that declaration, and keeping them apart makes the rest
obvious.

`ProductRepository` the **type** is the shape: an object with a `list` method.

`ProductRepository` the **value** is a key. It is how an Effect asks for the
shape at runtime, and it is what appears in `R`.

The string `'ProductRepository'` is the identity. Two classes with the same
string refer to the same slot, which is occasionally useful and mostly a reason
to keep the strings unique.

## Asking for it

You ask by yielding the class.

```ts twoslash
import { Context } from 'effect'
interface Product { readonly id: string; readonly name: string }
class ProductRepository extends Context.Service<
  ProductRepository,
  { readonly list: () => Effect.Effect<ReadonlyArray<Product>> }
>()('ProductRepository') {}
// ---cut---
import { Effect } from 'effect'
const countProducts = Effect.gen(function* () {
  const repository = yield* ProductRepository
  const products = yield* repository.list()
  return products.length
})
```

`countProducts` is `Effect<number, never, ProductRepository>`. It takes no
parameter, and the requirement is in the type where anyone can see it. Add a
second dependency inside that generator and `R` becomes a union of both, on the
line you wrote, without touching a single caller.

`R` is also a promise the compiler keeps. Try to run this without supplying a
repository and it will not compile. A requirement cannot be forgotten, only
satisfied.

## When construction does work, use make

A bare key works when something else builds the implementation. Most services
build themselves, and building involves work: reading config, allocating state,
acquiring a connection.

The repository has to hold products somewhere. A module-level array would be
shared by every test in the file, so state goes in a `Ref` created during
construction.

That construction is an Effect, which is what `make` is for.

```ts twoslash
import { Schema } from 'effect'
export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>

export const ProductName = Schema.String.check(Schema.isMinLength(1))
export const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))

export const Product = Schema.Struct({
  id: ProductId,
  name: ProductName,
  price: ProductPrice,
})
export type Product = Schema.Schema.Type<typeof Product>

export const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
export type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
// ---cut---
import { Context, Effect, Option, Ref } from 'effect'
// product.ts, below the schemas from chapter four
interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 1,
        products: [],
      })

      const list = Effect.fn('ProductRepository.list')(function* () {
        const current = yield* Ref.get(state)
        return current.products
      })

      const findById = Effect.fn('ProductRepository.findById')(function* (
        productId: ProductId,
      ) {
        const current = yield* Ref.get(state)
        return Option.fromUndefinedOr(
          current.products.find((product) => product.id === productId),
        )
      })

      return { list, findById }
    }),
  },
) {}
```

`RepositoryState` is the `Ref`'s payload: the next id to hand out, and the
products collected so far. Nothing outside `make` ever touches it directly.

Read `make` as a constructor that is allowed to do work. It runs once, when the
service is built. What it returns is the shape, and the shape is inferred, so
there is no separate interface to keep in sync.

The `Ref` is created inside `make`, so every construction gets a fresh one.
That single fact is what makes tests independent later.

Each method is wrapped in `Effect.fn`, which is new. `Effect.fn('Name')` takes a
generator function and returns a function, so it is `Effect.gen` with a name and
parameters. Every call to it runs inside a span with that name, and a trace
shows `ProductRepository.findById` instead of an anonymous generator. Name each
one `Service.method` and a trace reads like the call graph from chapter five.

Note what `findById` returns. `Option<Product>`, not a failure. The design
chapter decided that, and the repository is where the decision is honoured.

## The service on top

`ProductService` needs the repository. It asks for it the same way any Effect
does, inside its own `make`.

```ts twoslash
import { Option, Ref } from 'effect'
export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>

export const ProductName = Schema.String.check(Schema.isMinLength(1))
export const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))

export const Product = Schema.Struct({
  id: ProductId,
  name: ProductName,
  price: ProductPrice,
})
export type Product = Schema.Schema.Type<typeof Product>

export const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
export type CreateProduct = Schema.Schema.Type<typeof CreateProduct>

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 1,
        products: [],
      })

      const list = Effect.fn('ProductRepository.list')(function* () {
        const current = yield* Ref.get(state)
        return current.products
      })

      const findById = Effect.fn('ProductRepository.findById')(function* (
        productId: ProductId,
      ) {
        const current = yield* Ref.get(state)
        return Option.fromUndefinedOr(
          current.products.find((product) => product.id === productId),
        )
      })

      return { list, findById }
    }),
  },
) {}
// ---cut---
import { Context, Effect, Schema } from 'effect'
// product.ts, below ProductRepository
export class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId, message: Schema.String },
) {}

export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.gen(function* () {
      const repository = yield* ProductRepository

      const list = Effect.fn('ProductService.list')(function* () {
        return yield* repository.list()
      })

      const findById = Effect.fn('ProductService.findById')(function* (
        productId: ProductId,
      ) {
        const product = yield* repository.findById(productId)

        return yield* Effect.fromOption(
          product,
          () =>
            new ProductNotFoundError({
              productId,
              message: `Product ${productId} was not found`,
            }),
        )
      })

      return { list, findById }
    }),
  },
) {}
```

`repository` is acquired once, in `make`. The methods close over it. They do
not re-acquire it per call, and they do not take it as a parameter, which is
the problem this chapter opened with, now solved one level down.

`findById` is the entire reason the two services are separate. The repository
said `Option.none()`. The service says that, for someone who asked for this
specific product, that absence is `ProductNotFoundError`, and here is the id it
was looking for. One line, and it is the line where storage becomes a domain.

## Methods are functions, not stored Effects

A tempting shortcut is to put an Effect on the shape instead of a function:

```ts twoslash
interface Product { readonly id: string }
// ---cut---
import { Effect } from 'effect'
interface Wrong {
  readonly list: Effect.Effect<ReadonlyArray<Product>>
}

interface Right {
  readonly list: () => Effect.Effect<ReadonlyArray<Product>>
}
```

`Wrong` cannot take arguments, so the moment `list` needs a filter the shape
changes. Write methods as functions even when they take nothing today.

## What people get wrong

Reaching for `Service.use` out of habit.

```ts twoslash
import { Context } from 'effect'
interface Product { readonly id: string }
class ProductService extends Context.Service<
  ProductService,
  { readonly list: () => Effect.Effect<ReadonlyArray<Product>> }
>()('ProductService') {}
// ---cut---
import { Effect } from 'effect'
const viaUse = ProductService.use((service) => service.list())

const viaYield = Effect.gen(function* () {
  const service = yield* ProductService
  return yield* service.list()
})
```

Both work. The second is the house style, because the dependency is visible on
its own line and a second `yield*` reads the same as the first. `use` is a
convenience for one-liners, not the default.

The larger mistake is the one this chapter has been building toward and has not
fixed yet. Everything above defines services. Nothing has said how
`ProductRepository` actually gets built when `ProductService` asks for it. Right
now `ProductService.make` has `ProductRepository` sitting in its requirement
channel with nobody to satisfy it, and no program using it can run.

## Where product.ts stands

```ts twoslash
// product.ts
import { Context, Effect, Option, Ref, Schema } from 'effect'

export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>

export const ProductName = Schema.String.check(Schema.isMinLength(1))
export const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))

export const Product = Schema.Struct({
  id: ProductId,
  name: ProductName,
  price: ProductPrice,
})
export type Product = Schema.Schema.Type<typeof Product>

export const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
export type CreateProduct = Schema.Schema.Type<typeof CreateProduct>

export class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId, message: Schema.String },
) {}

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 1,
        products: [],
      })

      const list = Effect.fn('ProductRepository.list')(function* () {
        const current = yield* Ref.get(state)
        return current.products
      })

      const findById = Effect.fn('ProductRepository.findById')(function* (
        productId: ProductId,
      ) {
        const current = yield* Ref.get(state)
        return Option.fromUndefinedOr(
          current.products.find((product) => product.id === productId),
        )
      })

      return { list, findById }
    }),
  },
) {}

export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.gen(function* () {
      const repository = yield* ProductRepository

      const list = Effect.fn('ProductService.list')(function* () {
        return yield* repository.list()
      })

      const findById = Effect.fn('ProductService.findById')(function* (
        productId: ProductId,
      ) {
        const product = yield* repository.findById(productId)

        return yield* Effect.fromOption(
          product,
          () =>
            new ProductNotFoundError({
              productId,
              message: `Product ${productId} was not found`,
            }),
        )
      })

      return { list, findById }
    }),
  },
) {}
```

That is everything so far. Nothing in it can run yet, and the next chapter
fixes that.

## Next

[Repository state, layers, and config](/learn/basic-effect/07-layers) closes
that gap. A layer is a recipe for constructing a service, and a service that
owns its own layer can wire its dependencies once so that callers, and tests,
ask for one thing and get the whole tree.
