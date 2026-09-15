import { createFileRoute } from "@tanstack/react-router";
import { Effect, Layer } from "effect";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useMemo, useRef, useState } from "react";
import { type Fault, faultLabels, fetcherLayer } from "@/effect-demo/faults";
import {
  type Attempt,
  Attempts,
  describe,
  type Product,
  ProductsApi,
  requestTimeout,
} from "@/effect-demo/products";
import { makeRuntime } from "@/effect-demo/runtime";
import { baseOptions } from "@/lib/layout.shared";
import { cn } from "@/lib/cn";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/demo")({
  head: () => pageHead({ title: "See it running", path: "/demo" }),
  component: Demo,
});

// The old app reached for its shadcn Button here. Two variants and one size is
// less than a component's worth, and the migration has no ui/ directory.
const button =
  "inline-flex items-center justify-center rounded-md font-medium text-sm transition-colors disabled:pointer-events-none disabled:opacity-50";
const small = "px-3 py-1.5";
const primary =
  "bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90";
const outline = "border border-fd-border hover:bg-fd-accent";

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "ok"; readonly products: ReadonlyArray<Product> }
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
  none: "Calls the real API. Decodes and shows what came back.",
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
  const [attempts, setAttempts] = useState<ReadonlyArray<Attempt>>([]);
  const log = useRef<Array<Attempt>>([]);

  // A different fault is a different Fetcher, which is a different layer, so
  // the runtime is rebuilt. Nothing in ProductsApi knows any of this happened.
  const runtime = useMemo(() => {
    const recording = Layer.succeed(Attempts)(
      Attempts.of({
        record: (attempt) =>
          Effect.sync(() => {
            log.current = [...log.current, attempt];
            setAttempts(log.current);
          }),
      }),
    );

    return makeRuntime(fetcherLayer(fault), recording);
  }, [fault]);

  const run = () => {
    log.current = [];
    setAttempts([]);
    setOutcome({ kind: "running" });

    void runtime
      .runPromise(
        ProductsApi.use((api) => api.list).pipe(
          Effect.map(
            (products): Outcome => ({
              kind: "ok",
              products: products.slice(0, 6),
            }),
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
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <header className="mb-8">
          <p className="text-fd-muted-foreground text-sm">Live demo</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Break it on purpose
          </h1>
          <p className="text-fd-muted-foreground mt-2 text-lg">
            The same service, the same call. Pick a way for it to go wrong and
            watch which branch handles it.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          {faults.map((option) => (
            <button
              type="button"
              key={option}
              className={cn(
                button,
                small,
                option === fault ? primary : outline,
              )}
              onClick={() => {
                setFault(option);
                setOutcome({ kind: "idle" });
                setAttempts([]);
              }}
            >
              {faultLabels[option]}
            </button>
          ))}
        </div>

        <p className="text-fd-muted-foreground mt-3 text-sm">
          {explanations[fault]}
        </p>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            className={cn(button, primary, "px-4 py-2")}
            onClick={run}
            disabled={outcome.kind === "running"}
          >
            {outcome.kind === "running" ? "Running" : "Run the call"}
          </button>
          <span className="text-fd-muted-foreground text-sm">
            Retries: {retryNote(fault)}
          </span>
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Attempts</h2>
          {attempts.length === 0 ? (
            <p className="text-fd-muted-foreground mt-2 text-sm">
              Nothing yet. Run the call.
            </p>
          ) : (
            <ol className="mt-2 space-y-1">
              {attempts.map((attempt, index) => (
                <li
                  key={`${attempt.n}-${attempt.at}`}
                  className="flex items-baseline gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="text-fd-muted-foreground tabular-nums">
                    #{attempt.n}
                  </span>
                  <span className="text-fd-muted-foreground tabular-nums text-xs">
                    {index === 0
                      ? "+0ms"
                      : `+${attempt.at - attempts[index - 1].at}ms`}
                  </span>
                  <span className="font-mono text-xs">{attempt.outcome}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Result</h2>
          {outcome.kind === "idle" ? (
            <p className="text-fd-muted-foreground mt-2 text-sm">
              Not run yet.
            </p>
          ) : outcome.kind === "running" ? (
            <p className="text-fd-muted-foreground mt-2 text-sm">
              Working on it.
            </p>
          ) : outcome.kind === "failed" ? (
            <div className="mt-2 rounded-md border p-4">
              <p className="font-mono text-sm font-semibold">{outcome.tag}</p>
              <p className="text-fd-muted-foreground mt-1 font-mono text-xs break-words">
                {outcome.detail}
              </p>
            </div>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {outcome.products.map((product) => (
                <li key={product.id} className="rounded-md border p-3">
                  <p className="line-clamp-2 text-sm font-medium">
                    {product.title}
                  </p>
                  <p className="text-fd-muted-foreground mt-1 text-xs">
                    {product.category} · ${product.price.toFixed(2)} ·{" "}
                    {product.rating.rate}/5
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
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
