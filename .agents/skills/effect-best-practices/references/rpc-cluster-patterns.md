# RPC and Cluster Patterns

> **Effect v4.** RPC modules live in `effect/rpc`. Cluster modules live in `effect/cluster`.
> Workflow modules live in `effect/workflow`. All three ship inside the `effect` package and are
> marked `@stability unstable`.

## RpcGroup for API Organization

**Use `Rpc.make` for each endpoint and `RpcGroup.make` to collect them:**

```typescript
import { Rpc, RpcGroup } from "effect/rpc"
import { Effect, Schema } from "effect"

export const UserRpcs = RpcGroup.make(
    Rpc.make("findById", {
        payload: { id: UserId },
        success: User,
        error: UserNotFoundError,
    }),

    Rpc.make("list", {
        payload: {
            organizationId: OrganizationId,
            limit: Schema.Number.pipe(Schema.withDecodingDefaultType(Effect.succeed(50))),
            offset: Schema.Number.pipe(Schema.withDecodingDefaultType(Effect.succeed(0))),
        },
        success: Schema.Array(User),
    }),

    Rpc.make("create", {
        payload: CreateUserInput,
        success: User,
        error: Schema.Union([UserCreateError, ValidationError]),
    }),

    Rpc.make("update", {
        payload: { id: UserId, data: UpdateUserInput },
        success: User,
        error: Schema.Union([UserNotFoundError, ValidationError]),
    }),

    Rpc.make("delete", {
        payload: { id: UserId },
        error: UserNotFoundError,
    }),
)
```

### Rpc.make Options

| Option       | Purpose                                                        |
| ------------ | -------------------------------------------------------------- |
| `payload`    | Request schema, a `Schema.Struct` or a bare fields object      |
| `success`    | Success schema, defaults to `Schema.Void`                      |
| `error`      | Error schema, defaults to `Schema.Never`                       |
| `stream`     | `true` for a streaming response                                |
| `primaryKey` | Derives a request identity, needed for deduplication           |
| `defect`     | Schema for defects, defaults to `Schema.Defect()`              |

`success` and `error` are optional. Omit `error` rather than writing `Schema.Never`, and omit
`success` for a void response.

Model read and write differences with annotations where the distinction matters operationally,
for example `Rpc.make(...).annotate(ClusterSchema.Persisted, true)` for a persisted cluster
message or `ClusterSchema.Uninterruptible` for one that must not be interrupted. Declare each
contract explicitly with `Rpc.make`.

`primaryKey` only works with a bare fields `payload`. `Rpc.make` then builds a `Schema.Class`
payload whose `PrimaryKey` comes from your function.

## Error Unions in RPC

**Always use explicit error unions.** `Schema.Union` takes one array:

```typescript
// Explicit union of possible errors
Rpc.make("create", {
    payload: CreateOrderInput,
    success: Order,
    error: Schema.Union([
        ValidationError,
        InsufficientInventoryError,
        PaymentFailedError,
        UserNotFoundError,
    ]),
})

// NOT a generic error type
Rpc.make("create", {
    payload: CreateOrderInput,
    success: Order,
    error: GenericError, // WRONG, loses type information
})
```

## RPC Middleware for Authentication

`RpcMiddleware.Service` is configured with `requires`, `provides`, and `error` type parameters
plus an options object:

```typescript
import { Rpc, RpcMiddleware } from "effect/rpc"
import { Context, Effect, Layer } from "effect"

// The authenticated user is a service key the middleware provides
export class CurrentUser extends Context.Service<
    CurrentUser,
    { id: UserId; role: UserRole; organizationId: OrganizationId }
>()("CurrentUser") {}

// Auth middleware
export class AuthMiddleware extends RpcMiddleware.Service<
    AuthMiddleware,
    { provides: CurrentUser }
>()("AuthMiddleware", {
    error: UnauthorizedError,
}) {}

// Middleware implementation. The value is a function that wraps the handler effect
export const AuthMiddlewareLive = Layer.effect(
    AuthMiddleware,
    Effect.gen(function* () {
        const authService = yield* AuthService

        return (effect, { headers }) =>
            Effect.gen(function* () {
                const token = headers["authorization"]?.replace("Bearer ", "")

                if (!token) {
                    return yield* Effect.fail(new UnauthorizedError({ message: "Missing token" }))
                }

                const user = yield* authService.validateToken(token).pipe(
                    Effect.catchTag("TokenExpiredError", () =>
                        Effect.fail(new UnauthorizedError({ message: "Token expired" }))
                    ),
                    Effect.catchTag("TokenInvalidError", () =>
                        Effect.fail(new UnauthorizedError({ message: "Invalid token" }))
                    ),
                )

                // Return the wrapped effect with the provided service attached
                return yield* Effect.provideService(effect, CurrentUser, user)
            })
    })
)

// Protected RPCs using middleware
export const ProtectedUserRpcs = UserRpcs.middleware(AuthMiddleware)
```

The implementation is a plain function, not an object with an `execute` method. Its signature is
`(effect, { client, requestId, rpc, payload, headers }) => Effect`, where `effect` is the wrapped
handler and `headers` is a `Headers` record read by key (`headers["authorization"]`), not a
`Headers` object with `.get()`. It must **return** the wrapped effect, which is how
`Effect.provideService` hands `CurrentUser` down to the handler.

Set `requiredForClient: true` in the options when the client must supply the middleware too, and
provide the client half with `RpcMiddleware.layerClient(AuthMiddleware, ({ rpc, request, next }) => next(request))`.
The middleware `provides` metadata removes that service from each handler requirements, so
handlers can yield `CurrentUser` without declaring it.

`HttpApiMiddleware` is a different shape. It is keyed by security scheme name, as in
`Layer.succeed(Authentication)({ bearer: (effect, { credential }) => ... })`. See
`http-api-patterns.md`.

## Workflow Definition

**Use `Workflow.make(tag, options)`.** The name is the first argument:

```typescript
import { Workflow } from "effect/workflow"
import { Schema } from "effect"

export const OrderFulfillmentWorkflow = Workflow.make("OrderFulfillmentWorkflow", {
    payload: {
        orderId: OrderId,
        userId: UserId,
        items: Schema.Array(OrderItem),
        shippingAddress: ShippingAddress,
    },
    // Idempotency key prevents duplicate processing
    idempotencyKey: ({ orderId }) => orderId,
    success: FulfillmentResult,
    // Every activity error must be a member of the workflow error schema
    error: Schema.Union([
        FulfillmentFailedError,
        InsufficientInventoryError,
        DatabaseError,
        PaymentFailedError,
        PaymentTimeoutError,
        ShippingError,
        AddressInvalidError,
        NotificationError,
    ]),
})

export const NotificationWorkflow = Workflow.make("NotificationWorkflow", {
    payload: {
        messageId: MessageId,
        channelId: ChannelId,
        authorId: UserId,
    },
    idempotencyKey: ({ messageId }) => messageId,
})
```

`idempotencyKey` is **required**. Use it for identity. `Workflow.make` values expose `_tag`,
`execute`, `poll`, `interrupt`, `resume`, `toLayer`, and `executionId(payload)`, which derives the
deterministic execution ID from the tag and the key.

Stable `4.0.0` length-prefixes the tag when it derives the execution ID, so executions persisted
by a release candidate are not found by the same payload after upgrading. Drain in-flight
workflows before you upgrade.

### Workflow Implementation

```typescript
import { Activity } from "effect/workflow"
import { Effect, Schema } from "effect"

export const OrderFulfillmentWorkflowLayer = OrderFulfillmentWorkflow.toLayer(
    // The second argument is the execution ID
    Effect.fn("OrderFulfillmentWorkflow")(function* (payload, executionId) {
        // Step 1: Reserve inventory
        const reservation = yield* Activity.make({
            name: "ReserveInventory",
            success: InventoryReservation,
            error: Schema.Union([InsufficientInventoryError, DatabaseError]),
            execute: Effect.gen(function* () {
                const inventory = yield* InventoryService
                return yield* inventory.reserve(payload.items)
            }),
        })

        // Step 2: Process payment
        const payment = yield* Activity.make({
            name: "ProcessPayment",
            success: PaymentResult,
            error: Schema.Union([PaymentFailedError, PaymentTimeoutError]),
            execute: Effect.gen(function* () {
                const payments = yield* PaymentService
                return yield* payments.charge(payload.userId, payload.items)
            }),
        })

        // Step 3: Create shipment
        const shipment = yield* Activity.make({
            name: "CreateShipment",
            success: Shipment,
            error: Schema.Union([ShippingError, AddressInvalidError]),
            execute: Effect.gen(function* () {
                const shipping = yield* ShippingService
                return yield* shipping.createShipment({
                    items: payload.items,
                    address: payload.shippingAddress,
                    reservationId: reservation.id,
                })
            }),
        })

        // Step 4: Send confirmation
        yield* Activity.make({
            name: "SendConfirmation",
            error: NotificationError,
            execute: Effect.gen(function* () {
                const notifications = yield* NotificationService
                yield* notifications.sendOrderConfirmation({
                    userId: payload.userId,
                    orderId: payload.orderId,
                    trackingNumber: shipment.trackingNumber,
                })
            }),
        })

        return { shipment, payment }
    })
)
```

## Activity Patterns

**Always include `success` and `error` schemas** when the activity produces or fails with a
value. The schemas are what survives a workflow restart:

```typescript
// CORRECT, schemas specified
yield* Activity.make({
    name: "SendEmail",
    success: EmailSentResult,
    error: Schema.Union([EmailDeliveryError, EmailTemplateError]),
    execute: Effect.gen(function* () {
        // Implementation
        const clock = yield* Clock.currentTimeMillis
        return { messageId: "msg-123", sentAt: clock }
    }),
})

// WRONG, result cannot be replayed across restarts
yield* Activity.make({
    name: "SendEmail",
    execute: Effect.gen(function* () {
        return { messageId: "msg-123" } // not serialized, lost on replay
    }),
})
```

`success` defaults to `Schema.Void` and `error` to `Schema.Never`, so omitting them is correct
for a void, infallible activity, and incorrect when the activity returns data.

`interruptRetryPolicy` controls retry on interrupt behavior per activity.

### Activity Error Handling with Retryable

```typescript
export class ExternalApiError extends Schema.TaggedError<ExternalApiError>()(
    "ExternalApiError",
    {
        message: Schema.String,
        statusCode: Schema.Number,
        retryable: Schema.Boolean,
    },
) {
    static fromStatus(status: number): ExternalApiError {
        return new ExternalApiError({
            message: `API error: ${status}`,
            statusCode: status,
            retryable: status >= 500, // 5xx errors are retryable
        })
    }
}

yield* Activity.make({
    name: "CallExternalApi",
    success: ApiResponse,
    error: ExternalApiError,
    execute: Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient
        // Transport and decode failures are not part of the declared error here, so make them defects
        const response = yield* client.get(url).pipe(Effect.orDie)
        if (response.status >= 400) {
            return yield* Effect.fail(ExternalApiError.fromStatus(response.status))
        }
        return yield* HttpIncomingMessage.schemaBodyJson(ApiResponse)(response).pipe(Effect.orDie)
    }),
})
```

## ClusterCron for Scheduled Jobs

`ClusterCron.make` returns a `Layer` directly and takes the work inline as `execute`. The
schedule is a parsed `Cron`:

```typescript
import { Cron, Effect } from "effect"
import { ClusterCron } from "effect/cluster"

export const DailyReportCronLayer = ClusterCron.make({
    name: "DailyReportCron",
    // Every day at 6 AM UTC. Without the zone argument the schedule uses the host time zone
    cron: Cron.parseUnsafe("0 6 * * *", "UTC"),
    execute: Effect.gen(function* () {
        yield* Effect.log("Starting daily report generation")

        const reports = yield* ReportService
        yield* reports.generateDailyReport()

        yield* Effect.log("Daily report generation complete")
    }),
})
```

Use `Cron.parse(expr, tz)` when you want the `Result` form. Other options include `shardGroup` to
pin the job to a shard group, `calculateNextRunFromPrevious`, and `skipIfOlderThan` (defaults
to `"1 day"`) to skip badly delayed runs.

The layer requires `Sharding`, so provide your cluster layer beneath it.

## Triggering Workflows

### From an HTTP Handler

```typescript
import { HttpApiBuilder, HttpApiEndpoint } from "effect/http-api"

const createOrder = HttpApiEndpoint.post("createOrder", "/orders", {
    payload: CreateOrderInput,
    success: Order,
    error: ValidationError,
})

const OrdersApiLive = HttpApiBuilder.group(Api, "orders", Effect.fn(function* (handlers) {
    const orders = yield* OrderService

    return handlers.handle("createOrder", ({ payload }) =>
        Effect.gen(function* () {
            // Create order in database
            const order = yield* orders.create(payload)

            // Start fulfillment without waiting for it to finish
            yield* OrderFulfillmentWorkflow.execute({
                orderId: order.id,
                userId: payload.userId,
                items: payload.items,
                shippingAddress: payload.shippingAddress,
            }, { discard: true })

            return order
        })
    )
}))
```

`execute` **waits for the workflow to finish** and returns its success value, failing with its
error. Pass `{ discard: true }` to start it and get the execution ID back immediately, which is
what a request handler that returns early wants. Use `OrderFulfillmentWorkflow.poll(executionId)`
later to read the result.

`execute` requires the `WorkflowEngine` service. A service yielded inside a handler body surfaces
as a requirement on `HttpRouter.serve`, so provide the engine at the application root, outside
`serve`. See `http-api-patterns.md` for why `OrderService` is acquired in the build effect.

### From a Backend Service

```typescript
export class MessageService extends Context.Service<MessageService>()("MessageService", {
    make: Effect.gen(function* () {
        const repo = yield* MessageRepo

        const create = Effect.fn("MessageService.create")(function* (input: CreateMessageInput) {
            const message = yield* repo.create(input)

            // Trigger notification workflow
            yield* NotificationWorkflow.execute({
                messageId: message.id,
                channelId: message.channelId,
                authorId: message.authorId,
            }, { discard: true })

            return message
        })

        return { create }
    }),
}) {
    static readonly layer = Layer.effect(this, this.make).pipe(
        Layer.provide(MessageRepo.layer),
    )
}
```

Both call sites require `WorkflowEngine` in the effect's requirements. Provide it once at the
root with `ClusterWorkflowEngine.layer` from `effect/cluster`. That layer needs `Sharding` and
`MessageStorage`, and registers the durable clock entity. Workflows registered with `toLayer` run
on it.

## Import Reference

| Module   | Path               | Exports                                                                                                |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| RPC      | `effect/rpc`       | `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`, `RpcMiddleware`, `RpcSerialization`, `RpcTest`            |
| Cluster  | `effect/cluster`   | `Sharding`, `Entity`, `Singleton`, `ClusterCron`, `ClusterSchema`, `ClusterWorkflowEngine`, `Runners`  |
| Workflow | `effect/workflow`  | `Workflow`, `Activity`, `WorkflowEngine`, `DurableClock`, `DurableDeferred`, `DurableQueue`            |

All three are `@stability unstable` modules inside the `effect` package. Pin your Effect version if
you depend on them heavily. See `v4-semantics.md`.
