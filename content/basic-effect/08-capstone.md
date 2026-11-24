---
title: The ProductService capstone
order: 8
slug: 08-capstone
summary: The whole catalog module in one file, from branded schemas to the layer that wires it, with each decision from the earlier chapters visible in one place.
---

The last four chapters each added one piece to the same catalog. Read apart,
they look like four separate techniques. Read together, they form one module
with a single shape.

This chapter prints that module from top to bottom. Almost nothing in it is
new. Two small things are. The repository starts with two seeded products, so
the tests in the next chapter have something to list. And `create` logs the
product it made.

The rest of the chapter shows where each earlier decision ended up, and which
ones the module depends on.

## The domain

The module opens with the values it works with. `ProductId` is a branded
string, so a function that needs an id will not accept an arbitrary string.

```ts twoslash
// product.ts, from chapter four
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
```

`Product` and `CreateProduct` are separate schemas because they describe
different moments. A product that exists has an id. A request to create one
has no id yet, because the repository allocates it.

The checks sit on the field schemas, not on `Product` itself. This lets
`CreateProduct` reuse them without repeating the rule that a price is
positive.

## The failures

Two things can go wrong that are not bugs. A caller can ask for a product that
does not exist. A caller can also create a product when the catalog is full.
Each case gets its own tag. Each error also carries the fields a handler needs.

```ts twoslash
export const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
export type ProductId = Schema.Schema.Type<typeof ProductId>
// ---cut---
// product.ts, below the schemas
import { Schema } from 'effect'
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

`ProductNotFoundError` carries the missing id as a field, not as a sentence.
A handler can log the id, or retry with a different one, without parsing text.

## The repository

The repository owns storage and nothing else. It keeps its products in a `Ref`, which is how Effect represents state that
several fibers may touch.

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
// product.ts, below the failures
import { Context, Effect, Layer, Option, Ref } from 'effect'
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

Three details matter here.

The state is created inside `make`, so each new repository gets its own `Ref`.
A module-level `let` would be shared by every test in the file. Then what the
second test writes could make the fourth test fail.

`findById` returns `Option<Product>`, not a failure. In an in-memory lookup, a
missing product is an ordinary answer. Whether a missing product is an error is
a business judgement, and the repository does not make it.

`insert` allocates the id and adds the product in one `Ref.modify`. A
`Ref.get` followed by a `Ref.update` would be two separate steps. Two callers
could both read the same `nextId` before either one updates it.

## The service

The service holds the catalog rules. It takes the repository as a dependency,
reads one setting from config, and turns storage answers into domain answers.

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
// product.ts, below ProductRepository
import { Config, Context, Effect, Layer } from 'effect'
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

The service reads the repository and the config once, when its layer builds it. `make` runs at that moment and
returns the three methods. Those methods keep using the values `make` already
has.

`Effect.fromOption` connects the repository's answer to the service's answer.
It takes the `Option` that the repository returned. When the `Option` is empty,
it fails with the error the domain uses. In the repository, a missing product
is a value. In the service, it is a typed failure with an id attached.

The capacity check sits in the service for the same reason. The repository can
store any number of products. Only the catalog has a limit, so the catalog owns
the rule and the error.

## The whole file

Here is everything above, in the order a file needs it. Save it as
`product.ts`. It adds the imports that the earlier fragments left out. The next
chapter tests this module.

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
```

## Wiring it up

`ProductService.layer` provides `ProductRepository.layer` to itself. A caller
that asks for the service gets the repository with it.

The edge of the program has two jobs. It decodes the input before it calls the
service, and it is the only place that runs an Effect. Save this as
`main.ts` next to `product.ts`:

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
// @filename: main.ts
// ---cut---
// main.ts
import { Effect, Schema } from 'effect'
import { CreateProduct, ProductService } from './product'

const decodeCreate = Schema.decodeUnknownEffect(CreateProduct)

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

main.then(console.log)
```

Run `main.ts` the way the setup page showed (`bun run main.ts` under bun). It prints the log line from `create`, then the product:

```
[11:54:56.750] INFO (#1): Product created {
  productId: "product-3",
}
{
  id: "product-3",
  name: "Desk mat",
  price: 30,
}
```

The service receives a `CreateProduct` that decoding has already checked. This
is why none of its methods has a parse failure in `E`, the error channel.

`Effect.runPromise` appears once, at the outermost edge. All the code below it
returns Effects and runs nothing. This keeps the module portable. To put it
behind an HTTP handler, a CLI, or a test, you change only the code that calls
`Effect.runPromise`.

## What people get wrong

The brand is a real check. `findById` takes a `ProductId`. A string from a
route parameter is not a `ProductId` until your code turns it into one. The
compiler rejects this call:

```ts twoslash
// @errors: 2345
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
// @filename: lookup.ts
// ---cut---
// lookup.ts
import { Effect } from 'effect'
import { ProductService } from './product'

const lookup = Effect.gen(function* () {
  const products = yield* ProductService
  return yield* products.findById('product-1')
})
```

The fix is to decode the string at the edge, where the creation input is also
decoded. `ProductId.make` is for values you already know are ids, such as the
seeded products inside the repository. If you use it on untrusted input, the
brand no longer protects you.

A second common mistake is to catch the service's failures inside the service.
`ProductNotFoundError` exists so that a caller can decide whether the case is a
404, a retry, or an empty state. If `findById` handles the error itself, the
caller loses that choice. The
[errors page in the anti-patterns track](/learn/anti-patterns/03-errors)
covers this in more detail.

## Next

The module is complete and it typechecks, but that does not show it works. The
next chapter, [Effect-native testing](/learn/basic-effect/09-testing), runs it.
The tests cover these cases:

- the seeded list
- a lookup that fails with the exact error and id
- a capacity limit set by a test config
- a check that no test leaks state into the next one
