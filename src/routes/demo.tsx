import { createFileRoute } from "@tanstack/react-router";
import { Clock, Effect, Layer } from "effect";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useMemo, useRef, useState } from "react";
import { ConcurrencyDemo, Dots } from "@/components/concurrency-demo";
import { FaultTracks, finished, type Trace, useTrackView } from "@/components/fault-tracks";
import { type Fault, faultLabels, fetcherLayer } from "@/effect-demo/faults";
import {
  Attempts,
  describe,
  Fetcher,
  ProductsApi,
  requestTimeout,
} from "@/effect-demo/products";
import { makeRuntime } from "@/effect-demo/runtime";
import { baseOptions } from "@/lib/layout.shared";
import { cn } from "@/lib/cn";
import { button, outline, primary, small } from "@/lib/demo-ui";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/demo")({
  head: () => pageHead({ title: "See it running", path: "/demo" }),
  component: Demo,
});

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "ok"; readonly count: number }
  | { readonly kind: "failed"; readonly tag: string; readonly detail: string };

const faults: ReadonlyArray<Fault> = [
  "none",
  "server-error",
  "not-found",
  "malformed-json",
  "wrong-shape",
  "bad-host",
  "slow",
];

const explanations: Record<Fault, string> = {
  none: "Calls the real API and decodes what comes back.",
  "server-error":
    "Answers 500. Retryable, so you get backoff, then the failure.",
  "not-found":
    "Answers 404. Not retryable: asking the same wrong question again cannot help.",
  "malformed-json":
    "Answers 200 with HTML. The body is not JSON, so it fails before the schema runs.",
  "wrong-shape":
    "Answers valid JSON in the wrong shape. The schema catches it.",
  "bad-host": "Points at a host that does not exist. The request never lands.",
  slow: `Answers, eventually. Each attempt is cut off after ${requestTimeout}.`,
};

function Demo() {
  const [fault, setFault] = useState<Fault>("none");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [trace, setTrace] = useState<Trace>([]);
  const log = useRef<Trace>([]);

  // A different fault is a different Fetcher, which is a different layer, so
  // the runtime is rebuilt. Nothing in ProductsApi knows any of this happened.
  const runtime = useMemo(() => {
    const note = (next: Trace) => {
      log.current = next;
      setTrace(next);
    };

    // The drawing needs to know when each attempt starts as well as how it
    // ends. Attempts only reports the end, and every attempt makes exactly one
    // request, so the Fetcher is where the start shows.
    const watched = Layer.effect(
      Fetcher,
      Effect.gen(function* () {
        const inner = yield* Fetcher;
        return Fetcher.of({
          request: (url) =>
            Clock.currentTimeMillis.pipe(
              Effect.tap((startedAt) =>
                Effect.sync(() =>
                  note([...log.current, { n: log.current.length + 1, startedAt }]),
                ),
              ),
              Effect.flatMap(() => inner.request(url)),
            ),
        });
      }),
    ).pipe(Layer.provide(fetcherLayer(fault)));

    const recording = Layer.succeed(Attempts)(
      Attempts.of({
        record: ({ n, at, outcome }) =>
          Effect.sync(() =>
            note(
              log.current.map((step) =>
                step.n === n ? { ...step, endedAt: at, outcome } : step,
              ),
            ),
          ),
      }),
    );

    return makeRuntime(watched, recording);
  }, [fault]);

  const view = useTrackView(trace, outcome.kind === "ok" || outcome.kind === "failed");

  // The call is over well before the drawing has told it, so the buttons
  // wait for the drawing. A defect has no drawing to wait for.
  const defect = outcome.kind === "failed" && outcome.tag === "Defect";
  const busy =
    outcome.kind === "running" ||
    (outcome.kind !== "idle" && !defect && !finished(view, trace));

  const reset = () => {
    log.current = [];
    setTrace([]);
  };

  const run = () => {
    reset();
    setOutcome({ kind: "running" });

    void runtime
      .runPromise(
        ProductsApi.use((api) => api.list).pipe(
          Effect.map(
            (products): Outcome => ({ kind: "ok", count: products.length }),
          ),
          Effect.catch((error) =>
            Effect.succeed<Outcome>({
              kind: "failed",
              tag: error._tag,
              detail: describe(error),
            }),
          ),
        ),
      )
      .then(setOutcome)
      .catch((cause: unknown) => {
        // The layer cannot fail, so this only catches a defect: a bug in the
        // demo rather than one of the faults it is showing off.
        setOutcome({
          kind: "failed",
          tag: "Defect",
          detail: String(cause),
        });
      });
  };

  return (
    <HomeLayout {...baseOptions()}>
      <div className="relative">
        <div aria-hidden className="hero-dots pointer-events-none absolute inset-0" />
        <header className="relative mx-auto grid w-full max-w-5xl items-center gap-10 px-4 pt-12 pb-10 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pt-16">
          <div className="flex flex-col gap-5">
            <p className="hero-rise font-mono font-semibold text-fd-primary text-sm">Live demo</p>
            <h1
              className="hero-rise font-extrabold text-4xl tracking-tight sm:text-5xl"
              style={{ animationDelay: "80ms" }}
            >
              Push it around
            </h1>
            <p
              className="hero-rise text-fd-muted-foreground text-lg leading-relaxed"
              style={{ animationDelay: "160ms" }}
            >
              The same service twice. First break it on purpose and watch which
              branch catches it. Then run nine calls at once and change how many
              are allowed to go.
            </p>
            <div className="hero-rise flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
              {[
                { href: "#break", n: "01", label: "Break it on purpose" },
                { href: "#together", n: "02", label: "Run them together" },
              ].map((jump) => (
                <a
                  key={jump.href}
                  href={jump.href}
                  className="inline-flex h-12 items-center gap-3 rounded-lg border bg-fd-card px-4 font-semibold text-sm transition-[colors,transform] hover:border-fd-primary active:scale-95"
                >
                  <span className="rounded bg-fd-primary/10 px-1.5 py-1 font-mono text-fd-primary text-xs">
                    {jump.n}
                  </span>
                  {jump.label}
                </a>
              ))}
            </div>
          </div>

          <div
            className="hero-rise rounded-2xl border bg-fd-card px-6 pt-5 pb-2 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)]"
            style={{ animationDelay: "200ms" }}
          >
            <p className="pb-3 font-semibold text-sm">What changes between runs</p>
            {[
              {
                n: "01 · the layer",
                code: "makeRuntime(fetcherLayer(fault), ...)",
                text: "A different Fetcher for each failure. ProductsApi asks for a Fetcher and never learns which one it got.",
              },
              {
                n: "02 · one option",
                code: "Effect.all(..., { concurrency })",
                text: "Same byId, same timeout, same retry policy. Concurrency belongs to how effects are combined, not to the effects.",
              },
            ].map((row) => (
              <div
                key={row.n}
                className="grid gap-1.5 border-t py-3.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4"
              >
                <span className="font-mono font-semibold text-fd-primary text-xs">{row.n}</span>
                <div className="flex min-w-0 flex-col gap-1">
                  <code className="truncate font-mono text-[13px]">{row.code}</code>
                  <span className="text-fd-muted-foreground text-sm leading-relaxed">
                    {row.text}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </header>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
        <section id="break" className="scroll-mt-20">
          <p className="font-mono font-semibold text-fd-primary text-sm">01 · one call, two channels</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Break it on purpose</h2>
          <p className="text-fd-muted-foreground mt-2 max-w-2xl text-lg">
            Every stage can drop the call onto the error track. What happens
            next depends on one question: is this error worth another try?
          </p>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4 sm:flex-nowrap">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-1">
              <div className="flex flex-wrap gap-2">
                {faults.map((option) => (
                  <button
                    type="button"
                    key={option}
                    aria-pressed={option === fault}
                    className={cn(
                      button,
                      small,
                      option === fault ? primary : outline,
                    )}
                    onClick={() => {
                      setFault(option);
                      setOutcome({ kind: "idle" });
                      reset();
                    }}
                    disabled={busy}
                  >
                    {faultLabels[option]}
                  </button>
                ))}
              </div>
              <p className="text-fd-muted-foreground text-sm">
                {explanations[fault]}{" "}
                <span className="font-mono text-xs">Retries: {retryNote(fault)}.</span>
              </p>
            </div>
            <button
              type="button"
              className={cn(button, primary, "h-12 shrink-0 px-5")}
              onClick={run}
              disabled={busy}
            >
              {busy ? <Dots /> : "Run the call"}
            </button>
          </div>

          <div className="mt-6">
            <FaultTracks
              view={view}
              trace={trace}
              count={outcome.kind === "ok" ? outcome.count : undefined}
            />
          </div>

          {defect ? (
            <p className="text-demo-error mt-3 font-mono text-sm break-words">
              {outcome.detail}
            </p>
          ) : null}
        </section>

        <ConcurrencyDemo />
      </div>
    </HomeLayout>
  );
}

function retryNote(fault: Fault) {
  switch (fault) {
    case "server-error":
    case "bad-host":
    case "slow":
      return "up to 3 times, with backoff";
    case "none":
      return "not needed";
    default:
      return "not attempted, the request itself was wrong";
  }
}
