import { lazy, Suspense } from 'react'

/**
 * The one name-to-component map for ```demo fences. Each entry is a lazy
 * import, so a simulator's code loads only on a chapter that names it. The
 * remark plugin in source.config.ts reads `demoNames` to reject a typo at
 * build time.
 */
const demos = {
  lock: lazy(() => import('./lock-demo')),
  'many-at-once': lazy(() => import('./many-at-once-demo')),
  queue: lazy(() => import('./queue-demo')),
  semaphore: lazy(() => import('./semaphore-demo')),
}

export const demoNames: ReadonlyArray<string> = Object.keys(demos)

export function Demo({ name }: { name: keyof typeof demos }) {
  const Component = demos[name]
  return (
    <Suspense fallback={<div className="my-6 h-64 rounded-2xl border" />}>
      <Component />
    </Suspense>
  )
}
