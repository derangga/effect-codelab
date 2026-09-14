---
title: Schemas and domain modeling
order: 4
slug: 04-schemas
summary: Describe a value once and get its type, its validation, and its decoder from the same declaration, then brand ids so the compiler stops treating every string as interchangeable.
---

This signature is a lie by omission.

```ts twoslash
interface Product { readonly id: string }
// ---cut---
declare function createProduct(name: string, price: number): Product
```

It accepts an empty name and a price of `-5`. It accepts the name and the price
swapped, if someone writes `createProduct(price, name)` and the price happens
to be a string. And when the input arrives from a request body rather than from
your own code, you do not even have a `string` and a `number`. You have
`unknown`, and most codebases turn that into a type with a cast and hope.

A schema is one declaration that fixes all of it. It gives you the TypeScript
type, the runtime validation, and a decoder for untrusted input, and they
cannot drift apart because they are the same thing.

## Describing a value

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  price: Schema.Finite,
})

type Product = Schema.Schema.Type<typeof Product>
```

`Product` is now two things with one name, which is deliberate. The value is
the schema, usable at runtime. The type is what TypeScript sees. Declaring the
type with `Schema.Schema.Type` rather than writing an interface is what keeps
them in agreement when a field changes.

`Schema.Finite` rather than `Schema.Number` because `Number` admits `NaN` and
`Infinity`, and a price of `NaN` will ruin a quiet afternoon much later.

## Checks narrow what is allowed

A check is a predicate attached to a schema.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
```

Put checks on the field schemas rather than on the struct. `ProductName` is now
a thing you can name, reuse, and read. Every struct that uses it gets the rule,
and the rule is written once.

```ts twoslash
import { Schema } from 'effect'
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
// ---cut---
const Product = Schema.Struct({
  id: Schema.String,
  name: ProductName,
  price: ProductPrice,
})
```

The checks run when something decodes. They are not a compile-time guarantee
that a hand-written object literal is valid, and they are not meant to be. Use
them at the boundary, which is where values you did not construct arrive.

## Branded ids

`id: Schema.String` still leaves every string in the program interchangeable
with every product id. A brand fixes that without changing the runtime value.

```ts twoslash
import { Schema } from 'effect'
// ---cut---
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
type ProductId = Schema.Schema.Type<typeof ProductId>
```

At runtime a `ProductId` is a string, with no wrapper and no cost. At compile
time it is `string & Brand<'@Catalog/ProductId'>`, which no plain string
satisfies. Pass a raw string where a `ProductId` is wanted and the call does not
compile.

The namespace prefix keeps brands from colliding. Two modules that both brand
`'ProductId'` would produce the same type, which is exactly the accident
branding exists to prevent.

`ProductId.make(value)` is the constructor. Use it for values you already know
are ids, such as fixtures and seeds. For anything that arrived from outside,
decode it instead, and the next section is how.

## One schema per moment

A product that exists and a request to create one are different shapes, so they
are different schemas.

```ts twoslash
import { Schema } from 'effect'
const ProductId = Schema.String.pipe(Schema.brand('@Catalog/ProductId'))
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
// ---cut---
const Product = Schema.Struct({
  id: ProductId,
  name: ProductName,
  price: ProductPrice,
})
type Product = Schema.Schema.Type<typeof Product>

const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
```

`CreateProduct` has no id, because the caller does not have one. Whatever
stores the product allocates it. Modelling both with one optional-id type would
mean every read of `product.id` has to handle a missing case that cannot
actually happen after creation.

The two share `ProductName` and `ProductPrice`, so the rule that a price is
positive is stated once and enforced on both paths.

## Decoding unknown input

`Schema.decodeUnknownEffect` turns a schema into a function from `unknown` to
an Effect.

```ts twoslash
import { Schema } from 'effect'
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
// ---cut---
const decodeCreateProduct = Schema.decodeUnknownEffect(CreateProduct)

const parsed = decodeCreateProduct({ name: 'Desk mat', price: 30 })
//    ^?
```

The failure channel is `SchemaError`, and it carries what failed and where
rather than a boolean. Success gives you a `CreateProduct`, and by the time you
hold one, the name is non-empty and the price is positive. Nothing downstream
has to check again.

This is the one place `unknown` should appear. Decode at the edge, where a
request body or a file arrives, and pass typed values inward. A service that
takes `CreateProduct` cannot be handed junk, which is why none of the service
methods later in this course carry `SchemaError` in their signatures.

## Optional means Option

For a field that genuinely may be absent, model the absence rather than leaving
a `null` in the type.

```ts twoslash
import { Schema } from 'effect'
const ProductName = Schema.String.check(Schema.isMinLength(1))
// ---cut---
const Product = Schema.Struct({
  name: ProductName,
  description: Schema.Option(Schema.String),
})
type Product = Schema.Schema.Type<typeof Product>
```

`description` is an `Option<string>`. Reading it means saying what happens when
it is absent, through `Option.match` or `Option.getOrElse`, rather than
remembering a null check that is easy to skip and impossible to see in a
signature.

## What people get wrong

Casting at the boundary. It is the habit schemas replace, and it survives the
introduction of schemas in most codebases because it still compiles.

```ts twoslash
import { Schema } from 'effect'
const ProductName = Schema.String.check(Schema.isMinLength(1))
const ProductPrice = Schema.Finite.check(Schema.isGreaterThan(0))
const CreateProduct = Schema.Struct({
  name: ProductName,
  price: ProductPrice,
})
type CreateProduct = Schema.Schema.Type<typeof CreateProduct>
declare const body: unknown
// ---cut---
const input = body as CreateProduct
```

Nothing ran. `as` is a note to the compiler, not a check, so `input.price` may
well be `undefined` or `-5`. Everything downstream now believes a guarantee
that was never established, and the failure surfaces somewhere far away from
the cast.

The same mistake wearing a brand is `ProductId.make(someRequestParam)`. That
constructor asserts the value is already an id. On untrusted input it hands you
exactly the false confidence branding was supposed to remove. Decode it.

The [anti-patterns track](/learn/anti-patterns/01-at-the-boundary) has the
longer version, alongside the other two ways a boundary leaks.

## Next

You have typed values, typed failures, and a way to build programs out of both.
The catalog is still a pile of loose functions. [Design the product
service](/learn/basic-effect/05-design) works out the shape before any of it
becomes a service: what calls what, which failures exist, and which layer is
responsible for each one.
