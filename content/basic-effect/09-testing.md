---
title: Effect-native testing and review
order: 9
slug: 09-testing
summary: Test the catalog with it.effect, check failures through Exit and Cause so the tag and its fields are asserted, and override config without touching the environment.
---

The module compiles, but that does not prove it works. This chapter tests the
catalog and checks the exact error each failure carries.

Most Effect code starts with a test like the one below. It gives up much of
what the earlier chapters added:

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

This assertion passes if anything goes wrong, such as a typo in the test, a
missing layer, or the wrong error. `rejects.toThrow()` never checks the `_tag` or the `productId` the error
carries. The test tells you only that
something failed, which is all a bare `Promise<Product>` told you in [The Effect model](/learn/basic-effect/01-effect-model).

## Setup

This chapter needs a test runner and the Effect adapter for it. Pin both to
exact versions. `@effect/vitest@4.0.0` requires vitest 5, so an older vitest
does not work. Vitest needs no config here. It runs every `*.test.ts` file, so
the tests go in `product.test.ts`, next to `product.ts`. Nothing touches the
network or a server. The catalog is in memory, so there is nothing to mock.

Each block below shows the imports it uses. When you add a block to
`product.test.ts`, merge its import lines into the ones already there. The
chapter ends with the whole file. Install the packages and run the tests with
the commands for your package manager.

#### Tab: bun

```sh
bun add --exact --dev vitest@5.0.3 @effect/vitest@4.0.0
bunx vitest run
```

#### Tab: npm

```sh
npm install --save-dev --save-exact vitest@5.0.3 @effect/vitest@4.0.0
npx vitest run
```

#### Tab: pnpm

```sh
pnpm add --save-dev --save-exact vitest@5.0.3 @effect/vitest@4.0.0
pnpm exec vitest run
```

#### Tab: yarn

```sh
yarn add --dev --exact vitest@5.0.3 @effect/vitest@4.0.0
yarn vitest run
```

#### Tab: deno

```sh
deno add --save-exact npm:vitest@5.0.3 npm:@effect/vitest@4.0.0
deno run --allow-all npm:vitest run
```

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

Return the Effect from `it.effect` instead of running it. A test never calls
`Effect.runPromise`, for the same reason a service never does. The runner is
the edge of the program here, the one place that runs Effects.

Use `assert` instead of `expect`. `@effect/vitest` re-exports both, but
`assert` is the convention.

Provide the layer inside the test. The next section depends on this habit.

## Fresh state per test

`Effect.provide(ProductService.layer)` builds the service. That builds the
repository, which allocates a new `Ref`. So each test gets its own catalog.

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
products. But it fails the day someone moves the state out of `make` and into a
module-level variable. The first test's product would still be there, and the
count would be three. Without this test, that change looks harmless.

To share one build of a layer across a whole suite, wrap the suite in
`it.layer(SomeLayer)`. The layer is built once. Use this for expensive setup,
not for stateful services that each test needs fresh.

## Asserting on a failure

`Effect.exit` turns a failing Effect into one that succeeds with an `Exit`. An
`Exit` records how an Effect ended. The failure becomes a value you can inspect,
not an exception you must catch.

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

The two `if (!...) return` lines narrow the types. They are not defensive
checks. The `assert` above each one already fails the test when the condition
does not hold. The `return` tells TypeScript that `exit.cause` and `error.value`
exist on the lines below.

A failed `Exit` carries a `Cause`. A defect is an unexpected failure that is
not in the error type, such as a thrown exception. The error type does not list
defects, so it cannot warn you about them.

`Cause.findErrorOption` returns `Some` for a typed failure and `None` for a
defect. You can assert on that difference. If a test expects
`ProductNotFoundError` and gets `None`, the code hit a defect instead of failing
with its typed error.

Assert on the tag and the fields, never on the message. The message is text for
people, and someone will reword it. A test that breaks when the wording changes
teaches people to ignore test failures.

## Overriding config

The catalog limit comes from `Config.Int('CATALOG_MAX_PRODUCTS')`. A test that
needs to hit the limit supplies its own config provider instead of setting an
environment variable. The repository starts with two seeded products, so a
limit of one is already exceeded and the first `create` must fail.

Like the other tests, this one runs against the real `ProductService` from
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
provider must reach the build. `Layer.provide(TestConfig)` does that.
`Layer.mergeAll(ProductService.layer, TestConfig)` looks equivalent but is not.
It builds the two layers side by side, so the service reads the default and the
limit stays at 100. Then `create` succeeds and the test fails on its first
assertion.

The assertion on `maximum` shows where the limit came from. It equals 1 only if
the provider reached `make`.

The test sets nothing globally, so there is nothing to undo afterwards. Each
test builds its own `TestProductService`, so two tests can use different limits
at the same time.

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

Running `vitest run` prints:

```
 RUN  v5.0.3 /.../learning-effect

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  11:57:09
   Duration  161ms (import 77%, transform 14%, tests 7%, worker 1%)
```

The suite has five tests. None uses the network, and each gets a fresh catalog.

## A checklist for the catalog

Cover the catalog with these tests. The list is the same for any domain:

- `list` returns the seeded products
- `findById` returns an existing product
- `findById` fails with `ProductNotFoundError` carrying the requested id
- `create` returns a product with an allocated id
- a created product is then findable
- `create` fails with `CatalogCapacityError` at the configured limit
- one test does not see another test's products

The last test checks the wiring, not the behaviour. People most often leave it
out.

## Reading your own types back

Before you call the module finished, read the signature of every public method.
Each signature has three channels, `A`, `E` and `R`. Ask one question about
each.

First, does `A` contain only domain values? An `Option` that should have become
a failure, or a raw row shape, means a translation is missing.

Second, does `E` contain only failures this layer owns? A `SchemaError` in a
service method means decoding moved inward. A storage failure means the
repository leaked.

Third, does `R` list only what callers should know about? If `ProductRepository`
appears in the requirement channel of anything a caller uses, a layer is not
providing what it should.

Last, search the project for `Effect.runPromise` and `Effect.runSync`. You
should find one per entry point and none anywhere else.

## Where this course stops

You now have a portable catalog module. It has branded schemas, typed failures,
two services with a clear boundary between them, layers that build their own
dependencies, config, and tests that assert on the exact error. The module does
not know whether an HTTP server, a CLI, or a test calls it. That is what lets
the next tracks build on it.

The next tracks cover these topics:

- serving the catalog over HTTP
- backing the repository with SQL
- streams, for work that does not fit in memory
- scopes, for resources that must be released
- frontend state

Each track starts from this module and does not replace it.

Take these four habits with you:

- read the three channels after every change.
- give each failure one type and one owner.
- decode at the edge, where data enters the program.
- run at the edge, where the program starts.

To see what breaking these habits looks like, read the
[anti-patterns track](/learn/anti-patterns). It covers the same material from
the other side.
