---
title: Effect-native testing and review
order: 9
slug: 09-testing
summary: Test the catalog with it.effect, assert on failures through Exit and Cause so the tag and its fields survive, and override config without touching the environment.
---

The module compiles. That is not the same as working, and the gap between them
is where the interesting failures live.

Most Effect codebases start by testing like this, and it throws away most of
what the previous eight chapters bought:

```ts twoslash
// @filename: product.ts
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
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  {
    maximum: Schema.Finite,
    message: Schema.String,
  },
) {}

const initialProducts: ReadonlyArray<Product> = [
  { id: ProductId.make('product-1'), name: 'Mechanical keyboard', price: 120 },
  { id: ProductId.make('product-2'), name: 'USB-C dock', price: 85 },
]

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 3,
        products: initialProducts,
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

        const product = yield* repository.insert(input)
        yield* Effect.log('Product created', { productId: product.id })
        return product
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// @filename: product.test.ts
// ---cut---
// product.test.ts
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { ProductId, ProductService } from './product'

it('fails for a missing product', async () => {
  const program = Effect.gen(function* () {
    const products = yield* ProductService
    return yield* products.findById(ProductId.make('product-99'))
  }).pipe(Effect.provide(ProductService.layer))

  await expect(Effect.runPromise(program)).rejects.toThrow()
})
```

That assertion passes if anything at all went wrong. A typo in the test, a
missing layer, the wrong error entirely. `rejects.toThrow()` never looks at the
`_tag` or at the `productId` the error carries, so what is left is the same
confidence a bare `Promise<Product>` gave you in chapter one.

## Setup

This chapter needs a test runner and the Effect adapter for it. Pin both:

```sh
bun add --exact --dev vitest@5.0.3 @effect/vitest@4.0.0
```

`@effect/vitest@4.0.0` requires vitest 5, which is why the version is not an
older one. Vitest needs no config here. It runs every `*.test.ts` file, so the
tests in this chapter go in `product.test.ts`, next to `product.ts`, and
`bunx vitest run` runs them. Nothing touches the network or a server. The
catalog is in memory, so there is nothing to mock.

Each block below shows the imports it uses. When you add a block to
`product.test.ts`, merge its import lines into the ones already there. The
chapter ends with the whole file.

## it.effect

`@effect/vitest` adds test functions that take an Effect and run it for you.

```ts twoslash
// @filename: product.ts
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
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  {
    maximum: Schema.Finite,
    message: Schema.String,
  },
) {}

const initialProducts: ReadonlyArray<Product> = [
  { id: ProductId.make('product-1'), name: 'Mechanical keyboard', price: 120 },
  { id: ProductId.make('product-2'), name: 'USB-C dock', price: 85 },
]

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 3,
        products: initialProducts,
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

        const product = yield* repository.insert(input)
        yield* Effect.log('Product created', { productId: product.id })
        return product
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// @filename: product.test.ts
// ---cut---
// product.test.ts
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ProductService } from './product'

describe('ProductService', () => {
  it.effect('lists the seeded products', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const all = yield* products.list()

      assert.deepStrictEqual(
        all.map((product) => product.name),
        ['Mechanical keyboard', 'USB-C dock'],
      )
    }).pipe(Effect.provide(ProductService.layer)),
  )
})
```

Three habits come with this runner.

Return the Effect from `it.effect` rather than running it. No `Effect.runPromise`
appears in a test, for the same reason none appears in a service. The runner is
the edge here.

Use `assert`, not `expect`. `@effect/vitest` re-exports both, and `assert` is
the convention.

Provide the layer inside the test. That is what makes the next section work.

## Fresh state per test

`Effect.provide(ProductService.layer)` builds the service, which builds the
repository, which allocates a new `Ref`. Each test gets its own catalog.

```ts twoslash
// @filename: product.ts
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
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  {
    maximum: Schema.Finite,
    message: Schema.String,
  },
) {}

const initialProducts: ReadonlyArray<Product> = [
  { id: ProductId.make('product-1'), name: 'Mechanical keyboard', price: 120 },
  { id: ProductId.make('product-2'), name: 'USB-C dock', price: 85 },
]

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 3,
        products: initialProducts,
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

        const product = yield* repository.insert(input)
        yield* Effect.log('Product created', { productId: product.id })
        return product
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// @filename: product.test.ts
// ---cut---
// product.test.ts, below the first test
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ProductService } from './product'

describe('isolation', () => {
  it.effect('creates a product', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const created = yield* products.create({ name: 'Desk mat', price: 30 })

      assert.strictEqual(created.name, 'Desk mat')
      assert.strictEqual(created.id, 'product-3')
    }).pipe(Effect.provide(ProductService.layer)),
  )

  it.effect('does not see the product from the previous test', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const all = yield* products.list()

      assert.strictEqual(all.length, 2)
    }).pipe(Effect.provide(ProductService.layer)),
  )
})
```

The second test looks like it checks nothing, since it only counts the seeded
products. It is the test that fails the day somebody moves the state out of
`make` and into a module-level variable. The first test's product would still be
there, the count would be three, and without this test that change looks
harmless.

When a whole suite should share one build of a layer, `it.layer(SomeLayer)`
wraps the suite and builds it once. Use it for expensive setup, not for
stateful services you want isolated.

## Asserting on a failure properly

`Effect.exit` turns a failing Effect into one that succeeds with an `Exit`, so
the failure becomes a value you can inspect instead of an exception you catch.

```ts twoslash
// @filename: product.ts
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
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  {
    maximum: Schema.Finite,
    message: Schema.String,
  },
) {}

const initialProducts: ReadonlyArray<Product> = [
  { id: ProductId.make('product-1'), name: 'Mechanical keyboard', price: 120 },
  { id: ProductId.make('product-2'), name: 'USB-C dock', price: 85 },
]

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 3,
        products: initialProducts,
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

        const product = yield* repository.insert(input)
        yield* Effect.log('Product created', { productId: product.id })
        return product
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// @filename: product.test.ts
// ---cut---
// product.test.ts, below the isolation tests
import { assert, it } from '@effect/vitest'
import { Cause, Effect, Exit, Option } from 'effect'
import { ProductId, ProductService } from './product'

it.effect('fails with the id it was asked for', () =>
  Effect.gen(function* () {
    const products = yield* ProductService
    const missing = ProductId.make('product-99')

    const exit = yield* Effect.exit(products.findById(missing))

    assert.isTrue(Exit.isFailure(exit))
    if (!Exit.isFailure(exit)) return

    const error = Cause.findErrorOption(exit.cause)
    assert.isTrue(Option.isSome(error))
    if (!Option.isSome(error)) return

    assert.strictEqual(error.value._tag, 'ProductNotFoundError')
    assert.strictEqual(error.value.productId, missing)
  }).pipe(Effect.provide(ProductService.layer)),
)
```

The two `if (!...) return` lines are narrowing, not defensiveness. The assert
above each one has already failed the test if the condition does not hold. The
`return` is what convinces TypeScript that `exit.cause` and `error.value` exist
on the lines below.

`Cause.findErrorOption` returns `Some` for a typed failure and `None` for a
defect, which is itself a useful distinction to assert. A test that expected
`ProductNotFoundError` and got `None` has found a bug that crashed rather than
failed.

Assert on the tag and the fields. Never on the message. The message is prose
for humans and somebody will improve it, and a test that breaks when prose
changes trains everyone to stop reading test failures.

## Overriding config

The catalog limit came from `Config.Int('CATALOG_MAX_PRODUCTS')`. A test that
wants to hit the limit supplies its own provider rather than setting an
environment variable. The repository starts with two seeded products, so a
limit of one is already exceeded and the first `create` must fail.

Like the others, this test runs against the real `ProductService` from
`product.ts`.

```ts twoslash
// @filename: product.ts
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
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  {
    maximum: Schema.Finite,
    message: Schema.String,
  },
) {}

const initialProducts: ReadonlyArray<Product> = [
  { id: ProductId.make('product-1'), name: 'Mechanical keyboard', price: 120 },
  { id: ProductId.make('product-2'), name: 'USB-C dock', price: 85 },
]

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 3,
        products: initialProducts,
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

        const product = yield* repository.insert(input)
        yield* Effect.log('Product created', { productId: product.id })
        return product
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// @filename: product.test.ts
// ---cut---
// product.test.ts, below the failure test
import { assert, it } from '@effect/vitest'
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from 'effect'
import { ProductService } from './product'

const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ CATALOG_MAX_PRODUCTS: '1' }),
)

const TestProductService = ProductService.layer.pipe(
  Layer.provide(TestConfig),
)

it.effect('rejects creation once the catalog is full', () =>
  Effect.gen(function* () {
    const products = yield* ProductService
    const exit = yield* Effect.exit(
      products.create({ name: 'Desk mat', price: 30 }),
    )

    assert.isTrue(Exit.isFailure(exit))
    if (!Exit.isFailure(exit)) return

    const error = Cause.findErrorOption(exit.cause)
    assert.isTrue(Option.isSome(error))
    if (!Option.isSome(error)) return

    assert.strictEqual(error.value._tag, 'CatalogCapacityError')
    assert.strictEqual(error.value.maximum, 1)
  }).pipe(Effect.provide(TestProductService)),
)
```

`ProductService.make` reads the config while the layer is being built, so the
provider has to reach the build. `Layer.provide(TestConfig)` does that.
`Layer.mergeAll(ProductService.layer, TestConfig)` looks equivalent and is not.
It builds the two layers side by side, the service reads the default, the limit
stays at 100, and `create` succeeds. The test then fails on its first assertion.

The assertion on `maximum` pins the source of the limit. It is 1 only if the
provider reached `make`.

Nothing is set globally and nothing has to be unset afterwards. Each test builds
its own `TestProductService`, so two tests can use different limits at the same
time.

## Where product.test.ts stands

```ts twoslash
// @filename: product.ts
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
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}

export class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  {
    maximum: Schema.Finite,
    message: Schema.String,
  },
) {}

const initialProducts: ReadonlyArray<Product> = [
  { id: ProductId.make('product-1'), name: 'Mechanical keyboard', price: 120 },
  { id: ProductId.make('product-2'), name: 'USB-C dock', price: 85 },
]

interface RepositoryState {
  readonly nextId: number
  readonly products: ReadonlyArray<Product>
}

export class ProductRepository extends Context.Service<ProductRepository>()(
  'ProductRepository',
  {
    make: Effect.gen(function* () {
      const state = yield* Ref.make<RepositoryState>({
        nextId: 3,
        products: initialProducts,
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

        const product = yield* repository.insert(input)
        yield* Effect.log('Product created', { productId: product.id })
        return product
      })

      return { list, findById, create }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(ProductRepository.layer),
  )
}
// @filename: product.test.ts
// ---cut---
// product.test.ts
import { assert, describe, it } from '@effect/vitest'
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from 'effect'
import { ProductId, ProductService } from './product'

describe('ProductService', () => {
  it.effect('lists the seeded products', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const all = yield* products.list()

      assert.deepStrictEqual(
        all.map((product) => product.name),
        ['Mechanical keyboard', 'USB-C dock'],
      )
    }).pipe(Effect.provide(ProductService.layer)),
  )
})

describe('isolation', () => {
  it.effect('creates a product', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const created = yield* products.create({ name: 'Desk mat', price: 30 })

      assert.strictEqual(created.name, 'Desk mat')
      assert.strictEqual(created.id, 'product-3')
    }).pipe(Effect.provide(ProductService.layer)),
  )

  it.effect('does not see the product from the previous test', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const all = yield* products.list()

      assert.strictEqual(all.length, 2)
    }).pipe(Effect.provide(ProductService.layer)),
  )
})

it.effect('fails with the id it was asked for', () =>
  Effect.gen(function* () {
    const products = yield* ProductService
    const missing = ProductId.make('product-99')

    const exit = yield* Effect.exit(products.findById(missing))

    assert.isTrue(Exit.isFailure(exit))
    if (!Exit.isFailure(exit)) return

    const error = Cause.findErrorOption(exit.cause)
    assert.isTrue(Option.isSome(error))
    if (!Option.isSome(error)) return

    assert.strictEqual(error.value._tag, 'ProductNotFoundError')
    assert.strictEqual(error.value.productId, missing)
  }).pipe(Effect.provide(ProductService.layer)),
)

const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ CATALOG_MAX_PRODUCTS: '1' }),
)

const TestProductService = ProductService.layer.pipe(
  Layer.provide(TestConfig),
)

it.effect('rejects creation once the catalog is full', () =>
  Effect.gen(function* () {
    const products = yield* ProductService
    const exit = yield* Effect.exit(
      products.create({ name: 'Desk mat', price: 30 }),
    )

    assert.isTrue(Exit.isFailure(exit))
    if (!Exit.isFailure(exit)) return

    const error = Cause.findErrorOption(exit.cause)
    assert.isTrue(Option.isSome(error))
    if (!Option.isSome(error)) return

    assert.strictEqual(error.value._tag, 'CatalogCapacityError')
    assert.strictEqual(error.value.maximum, 1)
  }).pipe(Effect.provide(TestProductService)),
)
```

`bunx vitest run`:

```
 RUN  v5.0.3 /.../learning-effect

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  11:57:09
   Duration  161ms (import 77%, transform 14%, tests 7%, worker 1%)
```

Five tests, no network, and a fresh catalog behind each one.

## A checklist for the catalog

The module is worth covering with these, and they are the same list whatever
the domain turns out to be.

- `list` returns the seeded products
- `findById` returns an existing product
- `findById` fails with `ProductNotFoundError` carrying the requested id
- `create` returns a product with an allocated id
- a created product is then findable
- `create` fails with `CatalogCapacityError` at the configured limit
- one test does not see another test's products

The last one is the only one that tests the wiring rather than the behaviour,
and it is the one most likely to be left out.

## Reading your own types back

Before calling this finished, read the signature of every public method and ask
three questions.

Does `A` contain only domain values? An `Option` that should have been resolved
into a failure, or a raw row shape, means a translation is missing.

Does `E` contain only failures this layer owns? A `SchemaError` in a service
method means decoding moved inward. A storage failure means the repository
leaked.

Is `R` only what callers should know about? If `ProductRepository` appears in
the requirement channel of anything a caller touches, a layer is not providing
what it should.

Then find every `Effect.runPromise` and `Effect.runSync` in the project. There
should be one per entry point and none anywhere else.

## Where this course stops

You have a portable module: branded schemas, typed failures, two services with
a real seam between them, layers that own their wiring, config, and tests that
assert on the exact error. It has no idea whether it is behind an HTTP server,
a CLI, or a test, which is the property that makes the rest of it possible.

What comes next lives in other tracks. Serving it over HTTP, backing the
repository with SQL, streams for work that does not fit in memory, scopes for
resources that must be released, and frontend state. Each of them takes this
module as the starting point rather than replacing it.

The habits are worth taking with you before the APIs are. Read the three
channels after every change. Give each failure one type and one owner. Decode
at the edge. Run at the edge. If you want to see what these look like when they
go wrong, the [anti-patterns track](/learn/anti-patterns) is the same material
read from the other side.
