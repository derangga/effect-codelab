---
title: Repository state, layers, and config
order: 7
slug: 07-layers
summary: Turn service definitions into something that can actually run, with a layer that owns its wiring, state that is fresh per build, and one setting read from config.
---

Chapter six ended with a service that cannot run. `ProductService.make` yields
`ProductRepository`, so it requires one, and nothing so far has said how a
`ProductRepository` gets built. A layer is that missing piece.

## A layer is a recipe

`Layer.effect` takes a service key and the Effect that constructs it, and
produces a recipe for putting that service into the context.

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

Read the three parameters the same way you read them on an Effect. It provides
`ProductRepository`, it cannot fail, and it needs nothing to be built.

A layer is a description, like everything else here. Writing it constructs no
repository. The construction happens when something provides the layer, and it
happens once per provision.

## The service owns its wiring

Put the layer on the class as a static, so that the service and the knowledge
of how to build it stay together.

For a service with dependencies, the naive version has a problem the type will
tell you about:

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

`ProductRepository` is in the layer's requirement channel. The requirement did
not disappear, it moved. Every caller of this layer now has to know about the
repository, which is the prop-drilling problem again, one level up.

`Layer.provide` satisfies it inside the layer:

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
for one thing and get the whole tree. Add a second dependency to `make` later
and you add it to this one `Layer.provide` list, and nothing outside the class
changes.

`Layer.provide` also takes an array when there are several:
`Layer.provide([ProductRepository.layer, ClockService.layer])`.

## Providing at the edge

`Effect.provide` supplies a layer to a program. Like the runners, it belongs at
the outermost edge.

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

`runnable` has an empty `R`, which is the precondition for running it at all.
Providing in the middle of a program instead works, and throws away the reason
`R` exists. Once a function has provided its own dependencies, no caller can
substitute a different implementation, and that is the entire mechanism behind
testing without mocks.

For several independent services at the root, `Layer.mergeAll` composes them
flat:

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

Prefer `Layer.mergeAll` for services at the same level and `Layer.provideMerge`
when you are chaining incrementally. Both produce flatter types than nesting
`Layer.provide` calls, which matters for editor responsiveness once the graph
grows.

## State that is fresh per build

The repository holds its products in a `Ref` created inside `make`. That is the
detail that makes the whole thing testable.

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

Every provision of `ProductRepository.layer` runs `make` again and allocates a
new `Ref`, so two tests that each provide the layer cannot see each other's
products. A `let products = []` at module scope would give the opposite
behaviour and the failures would look like flakiness.

`Ref.modify` reads and writes in one step, returning a value and the next
state. `Ref.get` followed by `Ref.update` is two steps, and two fibers running
between them would allocate the same id twice.

One caveat on layer reuse. Providing the same layer in two places within one
layer graph gives you one instance, not two, because layers are memoized while
the graph is built. That is what you want for a database pool. Two separate
`Effect.provide` calls are two builds, so a pool provided that way is two pools.
Compose the graph and provide it once. When you deliberately need a separate
instance inside a graph, `Layer.fresh` says so.

## One setting from config

Hardcoding the catalog limit would mean editing code to change it. `Config`
reads it from the environment with a typed accessor.

```ts twoslash
import { Effect } from 'effect'
// ---cut---
import { Config } from 'effect'
const maximumProducts = Config.Int('CATALOG_MAX_PRODUCTS').pipe(
  Config.withDefault(100),
)
```

`Config.Int` fails if the variable is present but not an integer, rather than
handing you `NaN`. Read it in `make`, so it is read once when the service is
built:

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

`CatalogCapacityError` carries the limit that was hit and a message, so a
caller does not have to re-derive either from context.

Config is checked when the layer is built, not when your project is compiled or
bundled. A missing or malformed value fails at startup, which is early enough
to be useful and late enough that you should not expect a build error.

Overriding it is how tests exercise the limit without setting environment
variables:

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

Two products, and the third `create` fails with `CatalogCapacityError`. No
environment, no globals, nothing left behind for the next test.

The provider goes outside the service layer, so it is already in place when the
layer builds and `make` reads the limit. Putting it beside the layer in
`Layer.mergeAll` does not reach `make`, and chapter nine shows what to do
instead.

## What people get wrong

Reading config inside a method instead of in `make`. It compiles, and it means
the limit can change between two calls in one request. Read settings once at
construction unless you specifically want them live.

Using `Layer.succeed` for a service that holds state. `Layer.succeed` takes an
already-built value, so whatever state it closes over was created once and is
shared by everyone who provides it. For a static stub that remembers nothing it
is the right tool. For anything with a `Ref`, use `Layer.effect` so each build
gets its own.

Leaving requirements in a layer's third parameter and satisfying them at the
call site. It works until two call sites disagree about how to build the same
dependency.

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

`ProductService.layer` has `ConfigError` in its second slot now, because the
limit is read while the layer builds and a malformed value fails there.

## Next

Two services, a layer that wires them, state that is fresh per build, and a
setting from config. [The ProductService
capstone](/learn/basic-effect/08-capstone) puts all of it in one file and reads
it end to end, so you can see how the pieces sit together rather than meeting
them one at a time.
