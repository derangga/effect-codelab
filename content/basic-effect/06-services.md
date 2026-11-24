---
title: Services with Context.Service
order: 6
slug: 06-services
summary: See why passing dependencies as arguments breaks down, then declare a service with Context.Service, make, and Effect.fn so each Effect states what it needs in its type.
---

The previous chapter planned the catalog on paper. This chapter builds it,
starting with a version that needs no new ideas. The repository is an object of
related functions, and the caller passes it in as an argument.

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

This works. It is explicit and easy to test, and it is the best choice for one
function at one level.

It gets awkward as the call tree grows. Here is a function with three
dependencies.

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

Every caller of `buildReport` must now pass all three, whether or not it uses
them. Their callers must pass them too. Adding one dependency deep in the tree
changes every function above it. Signatures stop describing what a function does
and list what its children need.

Effect solves this with its third type parameter, `R`.

## The requirement channel holds what an Effect needs

`R` is the requirement channel, the third type slot of an Effect. It lets an
Effect say what it needs without being handed it. The type records the need.
Later, one place that knows how to build the dependency supplies it, once.

## A service is a key and a shape

A service is an object of related functions that other code asks for by name,
instead of receiving it as an argument. In Effect, you declare a service as a
class that extends `Context.Service`.

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

That declaration gives you two things. Keep them apart.

As a type, `ProductRepository` is the shape: an object with a `list` method.

As a value, `ProductRepository` is the key. An Effect uses it to ask for the
shape at runtime, and it is what appears in `R`.

The string `'ProductRepository'` is the identity. Two classes with the same
string refer to the same slot, so keep each string unique.

## Asking for a service

You ask for a service by yielding its class.

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

`countProducts` has the type `Effect<number, never, ProductRepository>`. It takes
no parameter, and anyone can see its requirement in the type. If you add a
second dependency inside that generator, `R` becomes a union of both. You change
one line, and no caller changes.

The compiler enforces `R`. If you try to run this Effect without supplying a
repository, it will not compile.

## Use make when construction does work

A bare key works when something else builds the implementation. Most services
build themselves, and building takes work, such as reading config, allocating
state, or acquiring a connection.

The repository must hold products somewhere. A module-level array would be
shared by every test in the file, so the state goes in a `Ref` created during
construction. Construction is an Effect, and `make` is where you write it.

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

`RepositoryState` is the content of the `Ref`: the next id to hand out and the
products collected so far. Nothing outside `make` touches it directly.

Think of `make` as a constructor that is allowed to do work. It runs once, when
the service is built. It returns the shape, and the compiler infers that shape,
so there is no separate interface to keep in sync.

The `Ref` is created inside `make`, so every construction gets a fresh one. That
keeps tests independent later.

Each method is wrapped in `Effect.fn`, which is new. `Effect.fn('Name')` takes a
generator function and returns a function, so it works like `Effect.gen` with a
name and parameters. Every call runs inside a span, a named and timed step in a trace, with that
name, so a trace
shows `ProductRepository.findById` instead of an anonymous generator. Name each
one `Service.method`, and a trace reads like the call graph from
[the design chapter](/learn/basic-effect/05-design).

`findById` returns `Option<Product>`, not a failure. The design chapter chose
this, and the repository carries it out.

## ProductService depends on the repository

`ProductService` needs the repository. It asks for the repository the same way
any Effect does, inside its own `make`.

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

`make` acquires `repository` once. The methods use that same `repository`. They
do not acquire it on each call, and they do not take it as a parameter. This
solves the problem the chapter opened with, one level down.

`findById` is the reason there are two services. When a product is missing, the
repository returns `Option.none()`. The service decides that, for a caller who
asked for one specific product, a missing product is a `ProductNotFoundError`
that carries the id. This is where a storage detail becomes a domain rule.

## Write methods as functions, not stored Effects

It is tempting to put an Effect on the shape instead of a function:

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

`Wrong` cannot take arguments. When `list` later needs a filter, the shape has to
change. Write methods as functions, even if they take no arguments today.

## What people get wrong

A common habit is to reach for `Service.use`.

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

Both work. The second is the style this course uses. The dependency sits on its
own line, and a second `yield*` looks the same as the first. Use `use` for
one-liners, not as the default.

The bigger gap is still open. Everything above defines services, but nothing
builds `ProductRepository` when `ProductService` asks for it. `ProductService.make`
has `ProductRepository` in its requirement channel, and nothing satisfies it. No
program that uses it can run.

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

Nothing in this file can run yet. The next chapter fixes that.

## Next

[Repository state, layers, and config](/learn/basic-effect/07-layers) closes
that gap. A service that owns its own layer connects its dependencies once. Callers and tests then ask for one
service and get all of its dependencies too.
