---
title: Typed errors and recovery
order: 3
slug: 03-typed-errors
summary: The difference between a failure you expect and a bug you do not, how to define one failure type per reason, and how catchTag proves you handled them.
---

A `catch` block gives you `unknown`. Every line after it is a guess about what
you caught, usually written as a string check on a message somebody may
reword next week.

```ts twoslash
declare function loadProduct(id: string): { name: string }
// ---cut---
try {
  loadProduct('product-1')
} catch (error) {
  if (error instanceof Error && error.message.includes('not found')) {
    // a 404
  }
}
```

The function's signature said nothing about this. You found out what it throws
by reading its body, or by being paged. The `E` channel exists so that a
failure is part of the signature, and so that handling it is something the
compiler can check.

## Two kinds of failure

Effect separates them, and the distinction decides which channel you reach for.

An **expected failure** is a normal outcome the caller has to deal with. A
product is not in the catalog. A price is negative. These go in `E`. They are
values, they have types, and callers must handle them or pass them on.

A **defect** is a bug. An array index that cannot be out of range is. A
`switch` that is missing a case. These do not belong in `E`, because there is
no sensible handler for them and putting them there forces every caller to
pretend there is. They travel as defects, they crash the fiber, and they show
up in the `Cause`.

The test is simple. If a reasonable caller would write different code for this
failure than for success, it is expected. If the only honest response is to fix
the program, it is a defect.

`Effect.die` raises a defect on purpose. `Effect.orDie` takes an Effect whose
failure you have genuinely ruled out and moves it from `E` to a defect. Both
are fine when you mean them, and both are commonly used to silence a type error
somebody did not want to deal with.

## One type per reason

Define expected failures with `Schema.TaggedError`.

```ts twoslash
import { Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
// ---cut---
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  {
    productId: ProductId,
    message: Schema.String,
  },
) {}
```

Three properties of that declaration are doing work.

The tag, `'ProductNotFoundError'`, is a literal string on every instance. That
is what makes a union of errors discriminable, and it is what `catchTag`
matches on.

The fields are a schema, so the error is a real domain value. It carries the id
that was missing. A handler that wants to log it, or put it in a response body,
has it without parsing a sentence.

`message` is a field like any other, and it is for humans. It is not the place
to encode which error this is. That is the tag's job.

Name the type after the reason, not the response. `ProductNotFoundError` tells
you what happened. A shared `NotFoundError` used for products, orders, and
users tells the caller nothing and forces a second field to say which.

## Failing on purpose

A `Schema.TaggedError` instance is itself an Effect that fails, so you can
yield it directly.

```ts twoslash
import { Effect, Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId, message: Schema.String },
) {}
interface Product { readonly id: ProductId; readonly name: string }
declare const products: ReadonlyArray<Product>
// ---cut---
const findProduct = Effect.fn('ProductCatalog.findProduct')(function* (
  productId: ProductId,
) {
  const found = products.find((product) => product.id === productId)

  if (found === undefined) {
    return yield* new ProductNotFoundError({
      productId,
      message: `Product ${productId} was not found`,
    })
  }

  return found
})
```

`Effect.fail(error)` does the same thing and reads better in a `pipe`. Inside a
generator, yielding the error directly is the shorter form.

Look at what the caller now sees:

```ts twoslash
import { Effect, Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId, message: Schema.String },
) {}
interface Product { readonly id: ProductId; readonly name: string }
declare const findProduct: (
  id: ProductId,
) => Effect.Effect<Product, ProductNotFoundError>
// ---cut---
const lookup = findProduct(ProductId.make('product-9'))
//    ^?
```

The failure is in the type. Nobody has to read the body to discover it, and it
cannot be forgotten, because the next section is the only way to get rid of it.

## Recovering with catchTag

`Effect.catchTag` takes a tag and a handler, and removes exactly that failure
from `E`.

```ts twoslash
import { Effect, Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: ProductId, message: Schema.String },
) {}
interface Product { readonly id: ProductId; readonly name: string }
declare const findProduct: (
  id: ProductId,
) => Effect.Effect<Product, ProductNotFoundError>
// ---cut---
const label = findProduct(ProductId.make('product-9')).pipe(
  Effect.map((product) => product.name),
  Effect.catchTag('ProductNotFoundError', (error) =>
    Effect.succeed(`Unknown product ${error.productId}`),
  ),
)
```

`label` is `Effect<string, never, never>`. `E` is `never` now, and it got there
honestly: something produced a value for
the failing case. The `error` parameter is fully typed, so `error.productId` is
a `ProductId` rather than a property you hope exists.

When there are several failures, `catchTags` handles them in one object and the
compiler checks the keys against the union.

```ts twoslash
import { Effect, Schema } from 'effect'
class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()(
  'ProductNotFoundError',
  { productId: Schema.String, message: Schema.String },
) {}
class CatalogCapacityError extends Schema.TaggedError<CatalogCapacityError>()(
  'CatalogCapacityError',
  { maximum: Schema.Finite, message: Schema.String },
) {}
declare const createProduct: Effect.Effect<
  string,
  ProductNotFoundError | CatalogCapacityError
>
// ---cut---
const handled = createProduct.pipe(
  Effect.catchTags({
    ProductNotFoundError: (error) =>
      Effect.succeed(`Unknown product ${error.productId}`),
    CatalogCapacityError: (error) =>
      Effect.succeed(`Catalog full at ${error.maximum}`),
  }),
)
```

Handle only one of them and `E` still contains the other. That is the useful
part. Partial recovery is normal, and the type keeps track of what is left
rather than letting you believe you are done.

## Each layer translates what it received

A failure should be described in the vocabulary of the code that produces it.
A repository that talks to a database can fail with a connection error. The
service above it should not pass that upward, because its callers are about the
catalog, not about connections.

So each layer catches what it got and produces its own error. The service turns
a storage failure into a catalog failure. The HTTP handler turns a catalog
failure into a status code. A caller three levels up never learns that there
was a database at all, which is what lets you replace it later.

Chapter six builds exactly this seam between a repository and a service. For
now the rule is enough: catch what your layer understands, fail with a type
your layer owns.

## What people get wrong

The blanket catch. `Effect.catch` handles everything, so `E` becomes `never`
and every distinction you built disappears.

```ts twoslash
import { Effect } from 'effect'
declare const loadPort: Effect.Effect<number, 'NotFound' | 'BadFormat'>
// ---cut---
const port = loadPort.pipe(Effect.catch(() => Effect.succeed(8080)))
//    ^?
```

The type says this cannot fail, which is now a claim the compiler will defend
on your behalf. A missing config file and a corrupt one are the same thing to
every caller from here on, so nobody downstream can retry the one worth
retrying. Use `catchTag` and name what you are handling.

The second is catching too early. A helper that resolves its own failures looks
tidy and takes the decision away from the only code that can make it. Whether
a missing product is a 404, an empty state, or a reason to try a different id
depends on the caller. Let the failure travel and handle it at the edge.

The [anti-patterns track](/learn/anti-patterns/03-errors) has the longer
version of both, plus the trap of naming your errors after status codes.

## Next

Errors are typed, but the values moving through the catalog are still plain
strings and numbers. Any string is a product id, any number is a price.
[Schemas and domain modeling](/learn/basic-effect/04-schemas) fixes that:
branded ids, checked fields, and a decoder at the boundary that turns unknown
input into values the rest of the code can trust.
