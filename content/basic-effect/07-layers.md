---
title: Repository state, layers, and config
order: 7
slug: 07-layers
summary: Build a layer for each service so the program can run. Each layer creates fresh state, and one setting comes from config.
---

The previous chapter ended with a service that cannot run. `ProductService.make` asks for
`ProductRepository`, so it needs one. Nothing has yet said how to build a
`ProductRepository`. A layer fills that gap.

## A layer is a recipe

A layer is a recipe that builds a service. `Layer.effect` takes a service key and an Effect that builds the service.

```ts twoslash
import { Context, Effect, Ref } from 'effect'
interface Product { readonly id: string }
class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<ReadonlyArray<Product>>([])
      const list = Effect.fn('ProductRepository.list')(function* () {
        return yield* Ref.get(state)
      })
      return { list }
    }),
  },
) {}
// ---cut---
import { Layer } from 'effect'
const repositoryLayer = Layer.effect(ProductRepository, ProductRepository.make)
//    ^?
```

A layer has three type parameters, like an Effect. This layer provides
`ProductRepository`, cannot fail, and needs nothing to be built.

A layer is a description, like everything else so far. Writing one builds no
repository. The build happens when you provide the layer to a program, and it
happens once each time you provide it.

## Layer on the service class

Put the layer on the class as a static member. Then the service and the
instructions for building it stay together.

Now write the layer the same way for a service that has a dependency. The type
shows a problem:

```ts twoslash
import { Context, Effect } from 'effect'
interface Product { readonly id: string }
class ProductRepository extends Context.Service<
  ProductRepository,
  { readonly list: () => Effect.Effect<ReadonlyArray<Product>> }
>()('ProductRepository') {}
class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.gen(function* () {
      const repository = yield* ProductRepository
      const list = Effect.fn('ProductService.list')(function* () {
        return yield* repository.list()
      })
      return { list }
    }),
  },
) {}
// ---cut---
import { Layer } from 'effect'
const leaky = Layer.effect(ProductService, ProductService.make)
//    ^?
```

`ProductRepository` is in the layer's requirement channel. The requirement did not go away. It moved to the layer's type. Every caller of this
layer must now know about the repository. That is the prop-drilling problem
again, one level up.

`Layer.provide` supplies the repository inside the layer:

```ts twoslash
import { Option, Ref, Schema } from 'effect'
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

      const insert = Effect.fn('ProductRepository.insert')(function* (
        input: CreateProduct,
      ) {
        return yield* Ref.modify(state, (current) => {
          const product: Product = {
            id: ProductId.make(`product-${current.nextId}`),
            ...input,
          }

          return [
            product,
            {
              nextId: current.nextId + 1,
              products: [...current.products, product],
            },
          ] as const
        })
      })

      return { list, findById, insert }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
// ---cut---
import { Context, Effect, Layer } from 'effect'
// product.ts, ProductService gets its layer
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
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
```

`ProductService.layer` is now `Layer<ProductService, never, never>`. Callers ask
for `ProductService` and get everything it needs. If `make` gains a second
dependency later, add it to this one `Layer.provide` call. Nothing outside the
class changes.

For several dependencies, pass an array to `Layer.provide`, for example
`Layer.provide([ProductRepository.layer, ClockService.layer])`.

## Providing at the edge

`Effect.provide` gives a layer to a program. Like the functions that run an
Effect, it belongs at the outermost edge of the program.

```ts twoslash
import { Context, Layer } from 'effect'
interface Product { readonly id: string }
class ProductService extends Context.Service<
  ProductService,
  { readonly list: () => Effect.Effect<ReadonlyArray<Product>> }
>()('ProductService') {
  static readonly layer: Layer.Layer<ProductService> = Layer.succeed(this, {
    list: () => Effect.succeed([]),
  })
}
// ---cut---
import { Effect } from 'effect'
const program = Effect.gen(function* () {
  const products = yield* ProductService
  return yield* products.list()
})

const runnable = program.pipe(Effect.provide(ProductService.layer))
```

`runnable` has an empty `R`, and an Effect can only run when `R` is empty.
You can also provide a layer in the middle of a program. That works, but it removes the benefit of `R`. Once a function provides its own dependencies, no
caller can substitute a different implementation. Substituting implementations
is how you test without mocks.

To combine several independent services at the root, use `Layer.mergeAll`. It
joins them side by side:

```ts twoslash
import { Context, Effect } from 'effect'
class ProductService extends Context.Service<
  ProductService,
  { readonly list: () => Effect.Effect<ReadonlyArray<string>> }
>()('ProductService') {
  static readonly layer: Layer.Layer<ProductService> = Layer.succeed(this, {
    list: () => Effect.succeed([]),
  })
}
class ReportService extends Context.Service<
  ReportService,
  { readonly build: () => Effect.Effect<string> }
>()('ReportService') {
  static readonly layer: Layer.Layer<ReportService> = Layer.succeed(this, {
    build: () => Effect.succeed('report'),
  })
}
// ---cut---
import { Layer } from 'effect'
const AppLive = Layer.mergeAll(ProductService.layer, ReportService.layer)
```

Use `Layer.mergeAll` for services at the same level. Use `Layer.provideMerge`
when you build the graph step by step. Both give flatter types than nested
`Layer.provide` calls. Flatter types keep the editor responsive as the graph
grows.

## State that is fresh per build

The repository keeps its products in a `Ref` created inside `make`. That is
what makes it testable.

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
import { Context, Effect, Layer, Option, Ref } from 'effect'
// product.ts, ProductRepository gains insert and a layer
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

      const insert = Effect.fn('ProductRepository.insert')(function* (
        input: CreateProduct,
      ) {
        return yield* Ref.modify(state, (current) => {
          const product: Product = {
            id: ProductId.make(`product-${current.nextId}`),
            ...input,
          }

          return [
            product,
            {
              nextId: current.nextId + 1,
              products: [...current.products, product],
            },
          ] as const
        })
      })

      return { list, findById, insert }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
```

Each time you provide `ProductRepository.layer`, `make` runs again and
allocates a new `Ref`. So two tests that each provide the layer cannot see each
other's products. A `let products = []` at module scope behaves the opposite
way. Tests would share state and fail at random.

`Ref.modify` reads and writes in one step. It returns a value and the next
state. `Ref.get` followed by `Ref.update` takes two steps. A fiber is one
running piece of an Effect program, similar to a lightweight thread. Two fibers
could run between those two steps and give out the same id twice.

Layer reuse has one caveat. Inside one layer graph, providing the same layer in
two places gives you one instance, not two. Effect memoizes layers while it
builds the graph, which means it builds each layer once and reuses it. That
suits a database pool. Two separate `Effect.provide` calls are two builds, so a
pool provided that way becomes two pools. Compose the graph and provide it
once. When you need a separate instance inside a graph, use `Layer.fresh`.

## One setting from config

Hardcoding the catalog limit means editing code to change it. Instead, read the
limit from the environment with `Config`, which gives you a typed value.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
import { Config } from 'effect'
const maximumProducts = Config.Int('CATALOG_MAX_PRODUCTS').pipe(
  Config.withDefault(100),
)
```

`Config.Int` fails if the variable is present but not an integer. It does not
hand you `NaN`. Read the value in `make`, so it is read once, when the service
is built:

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

      const insert = Effect.fn('ProductRepository.insert')(function* (
        input: CreateProduct,
      ) {
        return yield* Ref.modify(state, (current) => {
          const product: Product = {
            id: ProductId.make(`product-${current.nextId}`),
            ...input,
          }

          return [
            product,
            {
              nextId: current.nextId + 1,
              products: [...current.products, product],
            },
          ] as const
        })
      })

      return { list, findById, insert }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
// ---cut---
import { Config, Context, Effect, Layer, Schema } from 'effect'
// product.ts, below ProductNotFoundError
export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  { maximum: Schema.Finite, message: Schema.String },
) {}

export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.gen(function* () {
      const repository = yield* ProductRepository
      const maximumProducts = yield* Config.Int('CATALOG_MAX_PRODUCTS').pipe(
        Config.withDefault(100),
      )

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

      const create = Effect.fn('ProductService.create')(function* (
        input: CreateProduct,
      ) {
        const products = yield* repository.list()

        if (products.length >= maximumProducts) {
          return yield* new CatalogCapacityError({
            maximum: maximumProducts,
            message: `The catalog is limited to ${maximumProducts} products`,
          })
        }

        return yield* repository.insert(input)
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
```

`CatalogCapacityError` carries the limit that was hit and a message. A caller
does not need to work out either one from context.

Effect checks config when the layer is built, not when you compile or bundle
your project. A missing or malformed value fails at startup. That is early
enough to be useful, but do not expect a build error.

Tests can override the setting to exercise the limit without setting
environment variables:

```ts twoslash
import { Config, Context, Layer, Option, Ref, Schema } from 'effect'
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

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  { maximum: Schema.Finite, message: Schema.String },
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

      const insert = Effect.fn('ProductRepository.insert')(function* (
        input: CreateProduct,
      ) {
        return yield* Ref.modify(state, (current) => {
          const product: Product = {
            id: ProductId.make(`product-${current.nextId}`),
            ...input,
          }

          return [
            product,
            {
              nextId: current.nextId + 1,
              products: [...current.products, product],
            },
          ] as const
        })
      })

      return { list, findById, insert }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}

export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.gen(function* () {
      const repository = yield* ProductRepository
      const maximumProducts = yield* Config.Int('CATALOG_MAX_PRODUCTS').pipe(
        Config.withDefault(100),
      )

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

      const create = Effect.fn('ProductService.create')(function* (
        input: CreateProduct,
      ) {
        const products = yield* repository.list()

        if (products.length >= maximumProducts) {
          return yield* new CatalogCapacityError({
            maximum: maximumProducts,
            message: `The catalog is limited to ${maximumProducts} products`,
          })
        }

        return yield* repository.insert(input)
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// ---cut---
import { ConfigProvider, Effect } from 'effect'
// product.ts, or a scratch file that imports from it
const program = Effect.gen(function* () {
  const products = yield* ProductService
  yield* products.create({ name: 'Keyboard', price: 120 })
  yield* products.create({ name: 'Dock', price: 85 })
  return yield* products.create({ name: 'Desk mat', price: 30 })
})

const withSmallCatalog = program.pipe(
  Effect.provide(ProductService.layer),
  Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnvRecord({ CATALOG_MAX_PRODUCTS: '2' }),
    ),
  ),
)
```

The limit is two, so the third `create` fails with `CatalogCapacityError`. The
test needs no environment variables and no globals. It leaves nothing behind
for the next test.

The `ConfigProvider` goes outside the service layer, so it is in place when the
layer builds and `make` reads the limit. Putting it beside the layer in
`Layer.mergeAll` does not reach `make`. [The testing
chapter](/learn/basic-effect/09-testing) shows what to do instead.

## What people get wrong

The first mistake is reading config inside a method instead of in `make`. It
compiles, but the limit can then change between two calls in one request. Read
settings once, at construction, unless you want them live.

The second mistake is using `Layer.succeed` for a service that holds state.
`Layer.succeed` takes a value that is already built. Any state that value
closes over was created once, and everyone who provides the layer shares it.
For a static stub that remembers nothing, `Layer.succeed` is the right tool.
For anything with a `Ref`, use `Layer.effect` so each build gets its own state.

The third mistake is leaving requirements in a layer's third parameter and
satisfying them at the call site. This works until two call sites disagree
about how to build the same dependency.

## Where product.ts stands

```ts twoslash
// product.ts
import { Config, Context, Effect, Layer, Option, Ref, Schema } from 'effect'

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

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  { maximum: Schema.Finite, message: Schema.String },
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

      const insert = Effect.fn('ProductRepository.insert')(function* (
        input: CreateProduct,
      ) {
        return yield* Ref.modify(state, (current) => {
          const product: Product = {
            id: ProductId.make(`product-${current.nextId}`),
            ...input,
          }

          return [
            product,
            {
              nextId: current.nextId + 1,
              products: [...current.products, product],
            },
          ] as const
        })
      })

      return { list, findById, insert }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}

export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.gen(function* () {
      const repository = yield* ProductRepository
      const maximumProducts = yield* Config.Int('CATALOG_MAX_PRODUCTS').pipe(
        Config.withDefault(100),
      )

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

      const create = Effect.fn('ProductService.create')(function* (
        input: CreateProduct,
      ) {
        const products = yield* repository.list()

        if (products.length >= maximumProducts) {
          return yield* new CatalogCapacityError({
            maximum: maximumProducts,
            message: `The catalog is limited to ${maximumProducts} products`,
          })
        }

        return yield* repository.insert(input)
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
```

The second type parameter of `ProductService.layer` now includes `ConfigError`.
The layer reads the limit while it builds, and a malformed value fails at that
point.

## Next

This chapter covered two services, a layer that connects them, state that is
fresh per build, and one setting from config. [The ProductService
capstone](/learn/basic-effect/08-capstone) puts all of it in one file and reads
it from start to finish, so you see how the pieces fit together.
