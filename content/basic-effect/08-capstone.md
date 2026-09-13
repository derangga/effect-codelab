---
title: The ProductService capstone
order: 8
slug: 08-capstone
summary: The whole catalog module in one file, from branded schemas through the layer that wires it, with every decision from the earlier chapters visible in one place.
---

Seven chapters have each added one piece to the same catalog. Read separately
they look like seven techniques. Read together they are one module with a
single shape, and the shape is the point.

This chapter prints that module top to bottom. Nothing here is new. What is
new is seeing where each earlier decision ended up, and which of them are load
bearing.

## The domain

The module opens with the values it traffics in. `ProductId` is a branded
string, so a function that wants an id cannot be handed any string that
happens to be lying around.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
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
```

`Product` and `CreateProduct` are separate schemas because they describe
different moments. A product that exists has an id. A request to create one
does not, and cannot, because the repository allocates it.

The checks are on the field schemas rather than on `Product` itself. That is
what lets `CreateProduct` reuse them without restating the rule that a price
is positive.

## The failures

Two things can go wrong that are not bugs. A caller can ask for a product that
is not there, and a caller can create one when the catalog is full. Each gets
its own tag and carries the fields a handler would need.

```ts twoslash
import { Schema } from 'effect'
export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>
// ---cut---
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
```

`ProductNotFoundError` carries the id that was missing, rather than a sentence
describing it. A handler that wants to log the id, or retry with a different one,
has it without parsing prose.

## The repository

The repository owns storage and nothing else. It holds its products in a
`Ref`, which is how Effect represents state that several fibers may touch.

```ts twoslash
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
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
```

Three things here are worth naming.

The state lives inside `make`, so every construction of the repository gets a
fresh `Ref`. A module level `let` would be shared by every test in the file,
and the fourth test would fail because of what the second one wrote.

`findById` returns `Option<Product>`, not a failure. For an in memory lookup,
absence is an ordinary answer. Deciding that absence is an error is a business
judgement, and the repository is not the layer that makes it.

`insert` allocates the id and appends in one `Ref.modify`. A `Ref.get`
followed by a `Ref.update` would be two separate steps, and two callers
running between them would both read the same `nextId`.

## The service

The service is where catalog rules live. It takes the repository as a
dependency, reads one setting from config, and turns storage answers into
domain answers.

```ts twoslash
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
      const state = yield* Ref.make<RepositoryState>({ nextId: 1, products: [] })
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
            { nextId: current.nextId + 1, products: [...current.products, product] },
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
```

The repository and the config are read once, during construction, not on every
call. `make` runs when the layer is built. What it returns is the three
methods, and those close over the values `make` already has.

`Effect.fromOption` is the seam between the two services. It takes the
`Option` the repository returned and, when it is empty, fails with the error
the domain cares about. On one side of that line absence is a value. On the
other it is a typed failure with an id attached.

The capacity check sits in the service for the same reason. The repository can
store any number of products. It is the catalog that has a limit, so the
catalog owns the rule and the error.

## Wiring it up

`ProductService.layer` provides `ProductRepository.layer` to itself. A caller
asks for the service and gets the whole tree.

```ts twoslash
import { Schema } from 'effect'
const CreateProduct = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  price: Schema.Finite.check(Schema.isGreaterThan(0)),
})
// ---cut---
const decodeCreate = Schema.decodeUnknownEffect(CreateProduct)
```

Decoding happens at the edge, before the service is called. The service takes
a `CreateProduct` that has already been proven to be one, which is why none of
its methods carry a parse failure in `E`.

Only the edge runs the Effect:

```ts twoslash
import { Context, Effect, Layer, Schema } from 'effect'
export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>
export const CreateProduct = Schema.Struct({
  name: Schema.String,
  price: Schema.Finite,
})
export type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.succeed({
      create: (input: CreateProduct) =>
        Effect.succeed({ id: ProductId.make('product-1'), ...input }),
      findById: (id: ProductId) =>
        Effect.succeed({ id, name: 'Desk mat', price: 30 }),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
const decodeCreate = Schema.decodeUnknownEffect(CreateProduct)
// ---cut---
const program = Effect.gen(function* () {
  const products = yield* ProductService
  const input = yield* decodeCreate({ name: 'Desk mat', price: 30 })
  const created = yield* products.create(input)
  return yield* products.findById(created.id)
})

const main = program.pipe(
  Effect.provide(ProductService.layer),
  Effect.runPromise,
)
```

`Effect.runPromise` appears once, at the outermost edge. Every layer beneath
it returns descriptions. That is what makes the module portable: put it behind
an HTTP handler, a CLI, or a test, and only this last line changes.

## What people get wrong

The brand is not decoration. `findById` takes a `ProductId`, and a string from
a route parameter is not one until something says so.

```ts twoslash
// @errors: 2345
import { Context, Effect, Layer, Schema } from 'effect'
export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>
export class ProductService extends Context.Service<ProductService>()(
  'ProductService',
  {
    make: Effect.succeed({
      findById: (id: ProductId) =>
        Effect.succeed({ id, name: 'Desk mat', price: 30 }),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
// ---cut---
const lookup = Effect.gen(function* () {
  const products = yield* ProductService
  return yield* products.findById('product-1')
})
```

The fix is to decode the string at the edge, the same place the creation input
gets decoded. `ProductId.make` is the escape hatch for values you already
know are ids, such as the seeds inside the repository. Reaching for it on
untrusted input gives back exactly what the brand was for.

The other habit worth naming is catching the service's failures inside the
service. `ProductNotFoundError` exists so a caller can decide whether it is a
404, a retry, or an empty state. Handling it in `findById` throws that
decision away before anyone can make it. The
[anti-patterns track](/learn/anti-patterns/03-errors) has the longer version.

## Next

The module is complete and it typechecks, which is not the same as working.
[Effect-native testing](/learn/basic-effect/09-testing) runs it: seeded lists,
a lookup that fails with the exact error and id, a capacity limit supplied by
a test config, and proof that no test leaks state into the next one.
