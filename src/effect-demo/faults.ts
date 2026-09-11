/**
 * Demo scaffolding: a Fetcher that breaks on purpose.
 *
 * This is chapter seven's payoff made concrete. ProductsApi asks for a
 * Fetcher and does not care where it came from, so swapping this one in
 * exercises every branch of the error handling without a server that
 * cooperates.
 */
import { Effect, Layer } from 'effect'
import { Fetcher, liveRequest } from './products'

export type Fault =
  | 'none'
  | 'bad-host'
  | 'server-error'
  | 'not-found'
  | 'malformed-json'
  | 'wrong-shape'
  | 'slow'

export const faultLabels: Record<Fault, string> = {
  none: 'Healthy',
  'bad-host': 'Bad host',
  'server-error': 'HTTP 500',
  'not-found': 'HTTP 404',
  'malformed-json': 'Not JSON',
  'wrong-shape': 'Wrong shape',
  slow: 'Too slow',
}

/** Longer than the service's timeout, so the timeout branch actually fires. */
const tooSlow = '4 seconds'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export const fetcherLayer = (fault: Fault): Layer.Layer<Fetcher> =>
  Layer.succeed(Fetcher)(
    Fetcher.of({
      request: (url) => {
        switch (fault) {
          case 'none':
            return liveRequest(url)
          case 'bad-host':
            return liveRequest('https://host.invalid.example/products')
          case 'server-error':
            return Effect.succeed(json({ message: 'boom' }, 500))
          case 'not-found':
            return Effect.succeed(json({ message: 'nope' }, 404))
          case 'malformed-json':
            return Effect.succeed(
              new Response('<html>gateway error</html>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
              }),
            )
          case 'wrong-shape':
            return Effect.succeed(json([{ id: 'one', title: 42 }]))
          case 'slow':
            // Effect.sleep rather than setTimeout, so a test can drive this
            // with a fake clock instead of actually waiting.
            return Effect.sleep(tooSlow).pipe(Effect.as(json([])))
        }
      },
    }),
  )
