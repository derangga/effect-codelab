import { Effect } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Attempts,
  describe,
  Fetcher,
  ProductsApi,
  type ProductsError,
} from '@/effect-demo/products';
import { makeRuntime } from '@/effect-demo/runtime';
import { cn } from '@/lib/cn';
import { button, outline, primary, small } from '@/lib/demo-ui';

/**
 * Nine real requests, and a dial for how many may be in flight at once.
 *
 * The only thing that changes between runs is one option on `Effect.all`. The
 * service below it is the same `byId` either way, with the same timeout and the
 * same retry policy, which is the point: concurrency is a property of how you
 * combine effects, not something each effect has to know about.
 *
 * Nine rather than a rounder number: it divides by the middle setting, so
 * `concurrency: 3` draws three clean waves instead of two and a stub.
 */
const ids = Array.from({ length: 9 }, (_, i) => i + 1);

type Concurrency = number | 'unbounded';

const choices: ReadonlyArray<{
  readonly value: Concurrency;
  readonly label: string;
}> = [
  { value: 1, label: 'One at a time' },
  { value: 3, label: 'Three at a time' },
  { value: 'unbounded', label: 'All nine' },
];

type Lane =
  | { readonly status: 'waiting' }
  | { readonly status: 'skipped' }
  | { readonly status: 'running'; readonly start: number }
  | {
      readonly status: 'done';
      readonly start: number;
      readonly end: number;
      readonly title: string;
    }
  | { readonly status: 'failed'; readonly start: number; readonly end: number }
  | {
      readonly status: 'interrupted';
      readonly start: number;
      readonly end: number;
    };

type Phase = 'idle' | 'running' | 'settled';

export function ConcurrencyDemo() {
  const [concurrency, setConcurrency] = useState<Concurrency>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [lanes, setLanes] = useState<ReadonlyArray<Lane>>(() =>
    ids.map(() => ({ status: 'waiting' })),
  );
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const board = useRef<ReadonlyArray<Lane>>(lanes);
  const startedAt = useRef(0);

  // Nothing varies here, so unlike the fault demo above this runtime is built
  // once. The live Fetcher, and the no-op Attempts: nine interleaved retry
  // logs would be noise rather than a lesson.
  const runtime = useMemo(() => makeRuntime(Fetcher.layer, Attempts.layer), []);

  // A bar's width is elapsed time, which nothing tells us about except the
  // clock. One frame loop drives all nine; each lane derives its own width.
  useEffect(() => {
    if (phase !== 'running') return;

    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now() - startedAt.current);
      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const run = () => {
    startedAt.current = performance.now();
    board.current = ids.map(() => ({ status: 'waiting' }));
    setLanes(board.current);
    setNow(0);
    setTotal(undefined);
    setFailure(undefined);
    setPhase('running');

    const since = () => performance.now() - startedAt.current;

    const mark = (index: number, lane: Lane) => {
      board.current = board.current.map((prev, i) =>
        i === index ? lane : prev,
      );
      setLanes(board.current);
    };

    /**
     * `byId` knows nothing about lanes. Start and finish are both visible from
     * out here, so they are observed at the call site instead of pushed into
     * the service. The suspend matters: it runs when the fiber picks this work
     * up, which at `concurrency: 1` is eight requests later than the map that
     * built it.
     */
    const lane = (id: number, index: number) =>
      Effect.suspend(() => {
        const start = since();
        mark(index, { status: 'running', start });

        return ProductsApi.use((api) => api.byId(id)).pipe(
          Effect.tap((product) =>
            Effect.sync(() =>
              mark(index, {
                status: 'done',
                start,
                end: since(),
                title: product.title,
              }),
            ),
          ),
          Effect.tapError(() =>
            Effect.sync(() =>
              mark(index, { status: 'failed', start, end: since() }),
            ),
          ),
          Effect.onInterrupt(() =>
            Effect.sync(() =>
              mark(index, { status: 'interrupted', start, end: since() }),
            ),
          ),
        );
      });

    void runtime
      .runPromise(
        Effect.all(ids.map(lane), { concurrency }).pipe(
          Effect.map(() => undefined as string | undefined),
          Effect.catch((error: ProductsError) =>
            Effect.succeed<string | undefined>(describe(error)),
          ),
        ),
      )
      .then((error) => {
        // Whatever the first failure stopped never ran at all. Say so, rather
        // than leaving rows that look like they are still going.
        board.current = board.current.map((entry) =>
          entry.status === 'waiting' ? { status: 'skipped' } : entry,
        );
        setLanes(board.current);
        setTotal(since());
        setFailure(error);
        setPhase('settled');
      })
      .catch((cause: unknown) => {
        setTotal(since());
        setFailure(String(cause));
        setPhase('settled');
      });
  };

  const elapsed = total ?? now;
  // The axis grows with the run. Nine sequential calls take several times what
  // nine parallel ones do, so no fixed width can serve both.
  const axis = Math.max(1200, elapsed * 1.04);
  const waited = lanes.reduce(
    (sum, lane) => sum + ('end' in lane ? lane.end - lane.start : 0),
    0,
  );
  const running = phase === 'running';

  return (
    <section className="mt-16 border-fd-border border-t pt-10">
      <h2 className="text-2xl font-bold tracking-tight">Run them together</h2>
      <p className="text-fd-muted-foreground mt-2">
        Nine products, fetched one by one. How many may be in flight at once
        is a single option, and the service underneath never learns which you
        picked.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            type="button"
            key={String(choice.value)}
            className={cn(
              button,
              small,
              choice.value === concurrency ? primary : outline,
            )}
            onClick={() => {
              setConcurrency(choice.value);
              setPhase('idle');
              setLanes(ids.map(() => ({ status: 'waiting' })));
              setTotal(undefined);
              setFailure(undefined);
            }}
            disabled={running}
          >
            {choice.label}
          </button>
        ))}
      </div>

      <pre className="bg-fd-muted text-fd-foreground mt-4 overflow-x-auto rounded-md p-4 font-mono text-xs leading-relaxed">
        {`Effect.all(
  ids.map((id) => api.byId(id)),
  { concurrency: ${concurrency === 'unbounded' ? "'unbounded'" : concurrency} },
)`}
      </pre>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          className={cn(button, primary, 'px-4 py-2')}
          onClick={run}
          disabled={running}
        >
          {running ? <Dots /> : 'Run all nine'}
        </button>
        {phase === 'settled' ? (
          <span className="text-fd-muted-foreground text-sm tabular-nums">
            {ms(total ?? 0)} on the clock, {ms(waited)} spent waiting
          </span>
        ) : (
          <span className="text-fd-muted-foreground text-sm">
            {running ? 'Watch where the bars start.' : 'Real calls, real time.'}
          </span>
        )}
      </div>

      <ol className="mt-6 space-y-1.5">
        {ids.map((id, index) => (
          <Row
            key={id}
            id={id}
            lane={lanes[index]}
            index={index}
            axis={axis}
            now={now}
          />
        ))}
      </ol>

      {failure === undefined ? null : (
        <div className="animate-shake border-demo-error/30 bg-demo-error/5 mt-4 rounded-md border p-4">
          <p className="text-demo-error font-mono text-sm">{failure}</p>
          <p className="text-fd-muted-foreground mt-2 text-sm">
            One call failed, so <code className="font-mono">Effect.all</code>{' '}
            stopped. Everything already in flight was interrupted, and anything
            still queued never started. That is the default: the first failure
            ends the whole thing.
          </p>
        </div>
      )}

      <p className="text-fd-muted-foreground mt-6 text-sm">
        {phase === 'settled' && failure === undefined
          ? 'The clock is how long you waited. The other number is how long the API was busy, added up across every lane. The gap between them is what concurrency bought.'
          : 'At one, each bar starts where the last one ended. Raise the limit and they stack up instead.'}
      </p>
    </section>
  );
}

function Row({
  id,
  lane,
  index,
  axis,
  now,
}: {
  readonly id: number;
  readonly lane: Lane;
  readonly index: number;
  readonly axis: number;
  readonly now: number;
}) {
  const end = 'end' in lane ? lane.end : now;
  const started = 'start' in lane;

  return (
    <li
      className="animate-pop grid grid-cols-[2rem_1fr_4.5rem] items-center gap-3 sm:grid-cols-[2rem_9rem_1fr_4.5rem]"
      style={{ animationDelay: `${index * 25}ms` }}
    >
      <span className="text-fd-muted-foreground font-mono text-xs tabular-nums">
        #{id}
      </span>
      <span
        className={cn(
          'text-fd-muted-foreground hidden truncate text-xs sm:block',
          lane.status === 'interrupted' && 'line-through',
        )}
      >
        {lane.status === 'done' ? lane.title : ''}
      </span>
      <span className="bg-fd-muted relative h-2.5 overflow-hidden rounded-full">
        {started ? (
          <span
            className={cn(
              'absolute inset-y-0 rounded-full transition-colors',
              barColor(lane.status),
            )}
            style={{
              left: `${(lane.start / axis) * 100}%`,
              width: `${Math.max(0.8, ((end - lane.start) / axis) * 100)}%`,
            }}
          />
        ) : null}
      </span>
      <span
        className={cn(
          'text-right font-mono text-xs tabular-nums',
          lane.status === 'failed' ? 'text-demo-error' : 'text-fd-muted-foreground',
        )}
      >
        {label(lane, now)}
      </span>
    </li>
  );
}

function barColor(status: Lane['status']) {
  switch (status) {
    case 'done':
      return 'bg-demo-ok';
    case 'failed':
      return 'bg-demo-error';
    case 'interrupted':
      return 'bg-demo-error/40';
    default:
      return 'bg-fd-primary';
  }
}

function label(lane: Lane, now: number) {
  switch (lane.status) {
    case 'waiting':
      return 'queued';
    case 'skipped':
      return '—';
    case 'running':
      return ms(now - lane.start);
    case 'interrupted':
      return 'cut';
    case 'failed':
      return 'failed';
    case 'done':
      return ms(lane.end - lane.start);
  }
}

/**
 * Three of them, out of step. Waiting, without claiming to know how long.
 *
 * The h-5 is the line box of `text-sm`, which is what this replaces. Without
 * it the button loses ten pixels of height the moment you press it.
 */
export function Dots() {
  return (
    <span className="flex h-5 items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-dot size-1.5 rounded-full bg-current"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

export const ms = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
