/**
 * The bridge between React and Effect.
 *
 * ManagedRuntime turns a layer into something a component can call. Building
 * it is the expensive part, so it happens once per set of choices rather than
 * once per click.
 */
import { Layer, ManagedRuntime } from 'effect'
import type { Attempts, Fetcher } from './products'
import { ProductsApi } from './products'

/**
 * Builds a runtime for one set of choices. The demo page calls this again when
 * a toggle changes, because a different Fetcher is a different layer.
 */
export const makeRuntime = (
  fetcher: Layer.Layer<Fetcher>,
  attempts: Layer.Layer<Attempts>,
) =>
  ManagedRuntime.make(
    ProductsApi.layerNoDeps.pipe(
      Layer.provide(Layer.mergeAll(fetcher, attempts)),
    ),
  )
