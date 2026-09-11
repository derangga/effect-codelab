/**
 * The bridge between React and Effect.
 *
 * There is no process.env in a browser, so the default ConfigProvider has
 * nothing to read. This builds one over import.meta.env instead, which is
 * where Vite puts VITE_ prefixed values.
 *
 * Those values are inlined into the bundle at build time and are readable by
 * anyone with devtools. Fine for a base URL, never fine for a secret. See
 * chapter eight.
 */
import { ConfigProvider, Layer, ManagedRuntime } from 'effect'
import type { Attempts, Fetcher } from './products'
import { ProductsApi } from './products'

export const BrowserConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown(import.meta.env),
)

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
      Layer.provide(BrowserConfig),
    ),
  )
