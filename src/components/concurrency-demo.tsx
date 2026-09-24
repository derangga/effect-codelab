import { Duration, Effect, Layer } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Attempts,
  describe,
  Fetcher,
  liveRequest,
  ProductsApi,
  type ProductsError,
  requestTimeout,
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

/** `slot` is which lane of the gate a call ran in, for drawing only. */
type Lane =
  | { readonly status: 'waiting' }
  | { readonly status: 'skipped' }
  | { readonly status: 'running'; readonly slot: number; readonly start: number }
  | {
      readonly status: 'done';
      readonly slot: number;
      readonly start: number;
      readonly end: number;
      readonly title: string;
    }
  | {
      readonly status: 'failed' | 'interrupted';
      readonly slot: number;
      readonly start: number;
      readonly end: number;
    };

type Phase = 'idle' | 'running' | 'settled';

/**
 * The live Fetcher, except #6 comes back 404 after a real round trip. A 404 is
 * not retryable, so it fails on its first try and `Effect.all` stops the rest.
 */
const sixNotFound = Layer.succeed(Fetcher)(
  Fetcher.of({
    request: (url) =>
      url.endsWith('/products/6')
        ? liveRequest(url).pipe(Effect.as(new Response(null, { status: 404 })))
        : liveRequest(url),
  }),
);

/** Effect.all hands out no slot numbers, so a call takes the lowest free lane. */
const freeSlot = (board: ReadonlyArray<Lane>) => {
  const taken = new Set(board.flatMap((lane) => (lane.status === 'running' ? [lane.slot] : [])));
  let slot = 0;
  while (taken.has(slot)) slot++;
  return slot;
};

// The drawing's geometry. The stage is at least 760px wide and scrolls below
// that; horizontal positions are calc() against its width.
const top = 26;
const height = 328;
// Three 96px cells and two 8px gaps, flush right. The lanes stop 28px short.
const tray = 'calc(100% - 304px)';
const timeoutMs = Duration.toMillis(requestTimeout);

export function ConcurrencyDemo() {
  const [concurrency, setConcurrency] = useState<Concurrency>(1);
  const [breakSix, setBreakSix] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [lanes, setLanes] = useState<ReadonlyArray<Lane>>(() =>
    ids.map(() => ({ status: 'waiting' })),
  );
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const board = useRef<ReadonlyArray<Lane>>(lanes);
  const startedAt = useRef(0);

  // The live Fetcher, or one with a hole in it, and the no-op Attempts: nine
  // interleaved retry logs would be noise rather than a lesson.
  const runtime = useMemo(
    () => makeRuntime(breakSix ? sixNotFound : Fetcher.layer, Attempts.layer),
    [breakSix],
  );

  // A token's place in its lane is elapsed time, which nothing tells us about
  // except the clock. One frame loop drives all nine.
  useEffect(() => {
    if (phase !== 'running') return;

    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now() - startedAt.current);
      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const clear = () => {
    setPhase('idle');
    setLanes(ids.map(() => ({ status: 'waiting' })));
    setTotal(undefined);
    setFailure(undefined);
  };

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
        const slot = freeSlot(board.current);
        mark(index, { status: 'running', slot, start });

        return ProductsApi.use((api) => api.byId(id)).pipe(
          Effect.tap((product) =>
            Effect.sync(() =>
              mark(index, {
                status: 'done',
                slot,
                start,
                end: since(),
                title: product.title,
              }),
            ),
          ),
          Effect.tapError(() =>
            Effect.sync(() =>
              mark(index, { status: 'failed', slot, start, end: since() }),
            ),
          ),
          Effect.onInterrupt(() =>
            Effect.sync(() =>
              mark(index, { status: 'interrupted', slot, start, end: since() }),
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
        // than leaving tokens that look like they are still queued.
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

  const running = phase === 'running';
  const clock = total ?? (running ? now : 0);
  const busy = lanes.reduce(
    (sum, lane) =>
      sum + ('start' in lane ? ('end' in lane ? lane.end : now) - lane.start : 0),
    0,
  );
  const scale = Math.max(busy, clock, 1);
  const slots = concurrency === 'unbounded' ? ids.length : concurrency;
  const gap = slots > 3 ? 4 : 10;
  const laneHeight = (height - gap * (slots - 1)) / slots;
  const laneTop = (slot: number) => top + slot * (laneHeight + gap);
  const queued = lanes.flatMap((lane, i) => (lane.status === 'waiting' ? [i] : []));

  return (
    <section id="together" className="mt-20 scroll-mt-20 border-fd-border border-t pt-12">
      <p className="font-mono font-semibold text-fd-primary text-sm">02 · nine calls, one option</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight">Run them together</h2>
      <p className="text-fd-muted-foreground mt-2 max-w-2xl text-lg">
        Nine products, fetched by id. The gate decides how many are in flight
        at once, and the service underneath never learns which you picked.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              type="button"
              key={String(choice.value)}
              aria-pressed={choice.value === concurrency}
              className={cn(
                button,
                small,
                choice.value === concurrency ? primary : outline,
              )}
              onClick={() => {
                setConcurrency(choice.value);
                clear();
              }}
              disabled={running}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={breakSix}
          className={cn(
            button,
            small,
            outline,
            'gap-2',
            breakSix && 'border-demo-error text-demo-error',
          )}
          onClick={() => {
            setBreakSix(!breakSix);
            clear();
          }}
          disabled={running}
        >
          <span
            aria-hidden
            className={cn(
              'size-3.5 rounded border-2 transition-colors',
              breakSix ? 'border-demo-error bg-demo-error' : 'border-fd-muted-foreground/50',
            )}
          />
          Make #6 fail
        </button>
        <button
          type="button"
          className={cn(button, primary, 'ml-auto h-12 px-5')}
          onClick={run}
          disabled={running}
        >
          {running ? <Dots /> : 'Run all nine'}
        </button>
      </div>

      <pre className="bg-fd-muted text-fd-foreground mt-4 overflow-x-auto rounded-md p-4 font-mono text-xs leading-relaxed">
        {'Effect.all(\n  ids.map((id) => api.byId(id)),\n  { concurrency: '}
        <span className="rounded bg-fd-primary px-1.5 py-0.5 font-bold text-fd-primary-foreground">
          {concurrency === 'unbounded' ? "'unbounded'" : concurrency}
        </span>
        {' },\n)'}
      </pre>

      <div className="mt-6 overflow-x-auto rounded-2xl border bg-fd-card px-5 py-5 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)] sm:px-7">
        <div className="@container relative h-[360px] min-w-[760px] font-mono">
          <span className="absolute top-0 left-4 font-semibold text-[11px] text-fd-muted-foreground uppercase tracking-wider">
            Queued
          </span>
          <span className="absolute top-0 left-[120px] font-semibold text-[11px] text-fd-muted-foreground uppercase tracking-wider">
            In flight · {concurrency === 'unbounded' ? 'no limit' : `${slots} ${slots === 1 ? 'slot' : 'slots'}`}
          </span>
          <span
            className="absolute top-0 -translate-x-full pr-2 text-[11px] text-fd-muted-foreground"
            style={{ left: 'calc(100% - 332px)' }}
          >
            {requestTimeout} timeout
          </span>
          <span
            className="absolute top-0 font-semibold text-[11px] text-fd-muted-foreground uppercase tracking-wider"
            style={{ left: tray }}
          >
            Done
          </span>

          {/* The lane is as long as the request timeout: a token that reaches
              the far end has been waiting long enough to be cut off. */}
          {Array.from({ length: slots }, (_, slot) => {
            const occupant = lanes.find(
              (lane) => lane.status === 'running' && lane.slot === slot,
            );
            const progress =
              occupant?.status === 'running' ? Math.min(1, (now - occupant.start) / timeoutMs) : 0;
            return (
              <div key={slot}>
                <div
                  className="gate-lane absolute left-[120px] overflow-hidden rounded-lg"
                  style={{ top: laneTop(slot), height: laneHeight, right: 332 }}
                >
                  <span
                    className="gate-fill absolute inset-y-0 left-0"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <div
                  className="gate-notch absolute left-[104px] w-1.5 rounded-full"
                  data-busy={occupant ? true : undefined}
                  style={{ top: laneTop(slot), height: laneHeight }}
                />
              </div>
            );
          })}

          {lanes.map((lane, i) => {
            const state = lane.status === 'waiting' || lane.status === 'running' ? undefined : lane.status;
            return (
              <div
                key={ids[i]}
                className="gate-cell absolute flex h-[104px] w-24 flex-col gap-0.5 rounded-lg px-2 pt-[42px] pb-1.5"
                data-state={state}
                style={{
                  left: `calc(${tray} + ${(i % 3) * 104}px)`,
                  top: top + Math.floor(i / 3) * 112,
                }}
              >
                <span className="line-clamp-2 shrink-0 font-sans text-[11px] leading-snug">
                  {lane.status === 'done' ? lane.title : ''}
                </span>
                <span className="text-[10px] text-fd-muted-foreground">{cellNote(lane)}</span>
              </div>
            );
          })}

          {lanes.map((lane, i) => {
            // Where the token sits is `left` and `top`, which change a few
            // times a run and so can transition. Progress along a lane is
            // `translate`, which changes every frame and so must not.
            let left: string;
            let at: number;
            let shift = '0 0';
            let transition: string;
            const ease = 'cubic-bezier(.2,.8,.2,1)';
            if (lane.status === 'waiting') {
              left = '16px';
              at = top + queued.indexOf(i) * 32;
              transition = `left .4s ${ease}, top .4s ${ease}`;
            } else if (lane.status === 'running') {
              const progress = Math.min(1, Math.max(0, (now - lane.start) / timeoutMs));
              left = '124px';
              at = laneTop(lane.slot) + laneHeight / 2 - 14;
              shift = `calc((100cqw - 524px) * ${progress.toFixed(4)}) 0`;
              transition = `left .35s ${ease}, top .4s ${ease}`;
            } else {
              left = `calc(${tray} + ${(i % 3) * 104 + 16}px)`;
              at = top + Math.floor(i / 3) * 112 + 8;
              transition = `left .6s ${ease}, top .6s ${ease}, translate .6s ${ease}`;
            }
            return (
              <div
                key={ids[i]}
                className="gate-token absolute flex h-7 w-16 items-center justify-center rounded-lg font-bold text-xs"
                data-state={lane.status}
                style={{ left, top: at, translate: shift, transition }}
              >
                #{ids[i]}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="font-bold font-mono text-2xl tabular-nums">{ms(clock)}</span>
          <span className="text-fd-muted-foreground text-xs">on the clock</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-bold font-mono text-2xl text-fd-muted-foreground tabular-nums">{ms(busy)}</span>
          <span className="text-fd-muted-foreground text-xs">API busy, added up</span>
        </div>
        <div className="flex min-w-48 grow flex-col gap-1.5">
          <span className="h-2.5 rounded-full bg-fd-primary" style={{ width: `${Math.max(1, (clock / scale) * 100)}%` }} />
          <span className="h-2.5 rounded-full bg-fd-muted-foreground/40" style={{ width: `${Math.max(1, (busy / scale) * 100)}%` }} />
          <span className="font-mono text-fd-muted-foreground text-xs">
            {phase !== 'settled'
              ? 'Blue is the wait you feel. Grey is the work the API did.'
              : failure !== undefined
                ? 'Stopped early.'
                : busy - clock > 40
                  ? `Concurrency bought you ${ms(busy - clock)}.`
                  : 'One at a time, the clock is the sum of every call.'}
          </span>
        </div>
      </div>

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
          ? 'The clock is how long you waited. The other number is how long the API was busy, added up across every call. The gap between them is what concurrency bought.'
          : 'At one, each call waits at the gate until the last one lands. Raise the limit and more of them go through together.'}
      </p>
    </section>
  );
}

function cellNote(lane: Lane) {
  switch (lane.status) {
    case 'done':
      return ms(lane.end - lane.start);
    case 'failed':
      return 'failed';
    case 'interrupted':
      return 'interrupted';
    case 'skipped':
      return 'never ran';
    default:
      return '';
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
