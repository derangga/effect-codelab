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
import { Effect } from 'effect'
declare const program: Effect.Effect<string>
declare const expect: (value: unknown) => {
  rejects: { toThrow: () => Promise<void> }
}
// ---cut---
it('fails for a missing product', async () => {
  await expect(Effect.runPromise(program)).rejects.toThrow()
})
declare function it(name: string, fn: () => Promise<void>): void
```

That assertion passes if anything at all went wrong. A typo in the test, a
missing layer, the wrong error entirely. The `_tag` is gone, the `productId`
that the error carried is gone, and what is left is the same confidence a
`try`/`catch` gave you in chapter three.

## it.effect

`@effect/vitest` adds test functions that take an Effect and run it for you.

```ts twoslash
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
interface Product { readonly id: string; readonly name: string }
class ProductService extends Context.Service<
  ProductService,
  { readonly list: () => Effect.Effect<ReadonlyArray<Product>> }
>()('ProductService') {
  static readonly layer: Layer.Layer<ProductService> = Layer.succeed(this, {
    list: () => Effect.succeed([{ id: 'product-1', name: 'Keyboard' }]),
  })
}
// ---cut---
describe('ProductService', () => {
  it.effect('lists the seeded products', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const all = yield* products.list()

      assert.strictEqual(all.length, 1)
      assert.strictEqual(all[0].name, 'Keyboard')
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
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
interface Product { readonly id: string; readonly name: string }
interface CreateProduct { readonly name: string; readonly price: number }
class ProductService extends Context.Service<
  ProductService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Product>>
    readonly create: (input: CreateProduct) => Effect.Effect<Product>
  }
>()('ProductService') {
  static readonly layer: Layer.Layer<ProductService> = Layer.succeed(this, {
    list: () => Effect.succeed([]),
    create: (input) => Effect.succeed({ id: 'product-3', name: input.name }),
  })
}
// ---cut---
describe('isolation', () => {
  it.effect('creates a product', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const created = yield* products.create({ name: 'Desk mat', price: 30 })

      assert.strictEqual(created.name, 'Desk mat')
    }).pipe(Effect.provide(ProductService.layer)),
  )

  it.effect('does not see the product from the previous test', () =>
    Effect.gen(function* () {
      const products = yield* ProductService
      const all = yield* products.list()

      assert.strictEqual(all.length, 0)
    }).pipe(Effect.provide(ProductService.layer)),
  )
})
```

The second test is worth writing even though it looks like it asserts nothing.
It is the test that fails the day somebody moves the state out of `make` and
into a module-level variable, and without it that change looks harmless.

When a whole suite should share one build of a layer, `it.layer(SomeLayer)`
wraps the suite and builds it once. Use it for expensive setup, not for
stateful services you want isolated.

## Asserting on a failure properly

`Effect.exit` turns a failing Effect into one that succeeds with an `Exit`, so
the failure becomes a value you can inspect instead of an exception you catch.

```ts twoslash
import { assert, describe, it } from '@effect/vitest'
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId, message: Schema.String },
) {}
interface Product { readonly id: ProductId; readonly name: string }
class ProductService extends Context.Service<
  ProductService,
  {
    readonly findById: (
      id: ProductId,
    ) => Effect.Effect<Product, ProductNotFoundError>
  }
>()('ProductService') {
  static readonly layer: Layer.Layer<ProductService> = Layer.succeed(this, {
    findById: (id) =>
      Effect.fail(
        new ProductNotFoundError({
          productId: id,
          message: `Product ${id} was not found`,
        }),
      ),
  })
}
// ---cut---
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
environment variable.

```ts twoslash
import { assert, it } from '@effect/vitest'
import { Cause, ConfigProvider, Context, Effect, Exit, Layer, Option, Schema } from 'effect'
interface CreateProduct { readonly name: string; readonly price: number }
interface Product { readonly id: string; readonly name: string }
class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  { maximum: Schema.Finite, message: Schema.String },
) {}
class ProductService extends Context.Service<
  ProductService,
  {
    readonly create: (
      input: CreateProduct,
    ) => Effect.Effect<Product, CatalogCapacityError>
  }
>()('ProductService') {
  static readonly layer: Layer.Layer<ProductService> = Layer.succeed(this, {
    create: () =>
      Effect.fail(
        new CatalogCapacityError({ maximum: 1, message: 'Catalog full' }),
      ),
  })
}
// ---cut---
const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ CATALOG_MAX_PRODUCTS: '1' }),
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
  }).pipe(Effect.provide(Layer.mergeAll(ProductService.layer, TestConfig))),
)
```

The provider is scoped to this program. Nothing is set globally, nothing has to
be unset afterwards, and two tests can use different limits at the same time.

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
