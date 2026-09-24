import { Duration } from "effect";
import { Fragment, useEffect, useRef, useState } from "react";
import { requestTimeout } from "@/effect-demo/products";

/**
 * The fault demo's diagram: one call to `ProductsApi.list` drawn as two
 * tracks. The top one is the success channel, the bottom one the error
 * channel, and a failed attempt drops from the stage that raised it to a gate
 * that asks whether it is worth another go.
 *
 * Unlike the home hero this is driven by the real run. The page records when
 * each attempt's request goes out and how the attempt ended, and `advance`
 * replays that trace at a pace a person can follow. The replay lags the run:
 * a 500 retried three times is over in about a second and a half, and the
 * drawing takes longer than that to tell it.
 */

/** One attempt as the page saw it: when the request left, and how it ended. */
export interface Step {
  readonly n: number;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly outcome?: string;
}

export type Trace = ReadonlyArray<Step>;

type Phase =
  | "idle"
  | "run"
  | "fail"
  | "judge"
  | "back"
  | "climb"
  | "ok"
  | "caught"
  | "failed";

export interface View {
  readonly phase: Phase;
  readonly attempt: number;
  /** 0 to 3 are the stages below, 4 is the success value. */
  readonly stage: number;
  readonly verdict?: "retry" | "no" | "spent";
  /** How long the retry schedule really waited before the next attempt. */
  readonly wait?: number;
  /** The first request's start time, which tells one run from the next. */
  readonly run?: number;
}

export const idle: View = { phase: "idle", attempt: 0, stage: 0 };

/** `Schedule.upTo({ times: 3 })` in products.ts: the first try plus three. */
export const maxAttempts = 4;

const stepMs = 480;

const stages = [
  { title: "Send the request", code: "fetcher.request(url)", error: "NetworkError" },
  { title: "Check the status", code: "response.ok", error: "ResponseError" },
  { title: "Parse the body", code: "response.json()", error: "MalformedJson" },
  { title: "Decode the shape", code: "decodeProducts(body)", error: "SchemaMismatch" },
];

/** The timeout wraps the whole attempt, but a slow call is stuck at the first stage. */
const raisedAt: Record<string, number> = {
  NetworkError: 0,
  RequestTimeout: 0,
  ResponseError: 1,
  MalformedJson: 2,
  SchemaMismatch: 3,
};

/** `describe` writes every failure as `Tag: detail`, and a success as `ok`. */
const tagOf = (outcome: string) => outcome.slice(0, outcome.indexOf(":"));

export const stageOf = (outcome: string) =>
  outcome === "ok" ? 4 : (raisedAt[tagOf(outcome)] ?? 0);

/**
 * The next frame of the replay and how long to hold the current one, or
 * nothing when the frame has to wait for the run to say what happened.
 */
export function advance(
  view: View,
  trace: Trace,
  settled: boolean,
): { readonly view: View; readonly after: number } | undefined {
  const first = trace[0];
  if (first === undefined || (view.phase !== "idle" && view.run !== first.startedAt)) {
    return view.phase === "idle" ? undefined : { view: idle, after: 0 };
  }

  const current = trace[view.attempt - 1];

  switch (view.phase) {
    case "idle":
      return { view: { phase: "run", attempt: 1, stage: 0, run: first.startedAt }, after: 0 };
    case "run": {
      // Still in flight, so there is nothing to draw past the first stage yet.
      if (current?.outcome === undefined) return undefined;
      const target = stageOf(current.outcome);
      if (view.stage < Math.min(target, 3)) {
        return { view: { ...view, stage: view.stage + 1 }, after: stepMs };
      }
      return target === 4
        ? { view: { ...view, phase: "ok", stage: 4 }, after: stepMs }
        : { view: { ...view, phase: "fail" }, after: stepMs };
    }
    case "fail": {
      // The gate only answers once the run has: either another request went
      // out, or the whole thing settled.
      const next = trace[view.attempt];
      if (next !== undefined) {
        const wait = next.startedAt - (current?.endedAt ?? next.startedAt);
        return { view: { ...view, phase: "judge", verdict: "retry", wait }, after: 650 };
      }
      if (!settled) return undefined;
      const verdict = view.attempt >= maxAttempts ? "spent" : "no";
      return { view: { ...view, phase: "judge", verdict }, after: 650 };
    }
    case "judge":
      return {
        view: { ...view, phase: view.verdict === "retry" ? "back" : "caught" },
        after: 700,
      };
    case "back":
      return { view: { ...view, phase: "climb" }, after: 950 };
    case "climb":
      return {
        view: { phase: "run", attempt: view.attempt + 1, stage: 0, run: view.run },
        after: 350,
      };
    case "caught":
      return { view: { ...view, phase: "failed" }, after: 600 };
    default:
      return undefined;
  }
}

export function useTrackView(trace: Trace, settled: boolean) {
  const [view, setView] = useState(idle);
  // A hold counts from when its frame appeared, so news from the run arriving
  // mid-hold does not start the hold over.
  const entered = useRef(0);

  useEffect(() => {
    const step = advance(view, trace, settled);
    if (step === undefined) return;
    const left = step.after - (performance.now() - entered.current);
    const id = setTimeout(() => {
      entered.current = performance.now();
      setView(step.view);
    }, Math.max(0, left));
    return () => clearTimeout(id);
  }, [view, trace, settled]);

  return view;
}

/** The drawing has reached the end of this run, not the one before it. */
export const finished = (view: View, trace: Trace) =>
  (view.phase === "ok" || view.phase === "failed") && view.run === trace[0]?.startedAt;

// Positions across the track, in percent, so the drawing stretches with the
// page. Heights stay in pixels because the text beside them does.
const x = { start: 7, stages: [17.5, 36, 54.5, 73], gate: 80, end: 94 };
const y = { top: 64, error: 184 };
const timeoutMs = Duration.toMillis(requestTimeout);

export function FaultTracks({
  view,
  trace,
  count,
}: {
  readonly view: View;
  readonly trace: Trace;
  /** How many products the successful call decoded. */
  readonly count?: number;
}) {
  const { phase, stage, attempt } = view;
  const current = trace[attempt - 1];
  const backing = phase === "back" || phase === "climb";
  const onError = ["fail", "judge", "caught", "failed"].includes(phase);
  const judged = onError && phase !== "fail";
  const waiting = phase === "run" && stage === 0 && current?.outcome === undefined;
  const tag = current?.outcome === undefined ? "" : tagOf(current.outcome);

  let px = x.start;
  let py = y.top;
  if (phase === "run") px = x.stages[stage];
  if (phase === "ok") px = x.end;
  if (phase === "fail") [px, py] = [x.stages[stage], y.error];
  if (phase === "judge") [px, py] = [x.gate, y.error];
  if (phase === "caught" || phase === "failed") [px, py] = [x.end, y.error];

  const tone = phase === "ok" ? "var(--tr-ok)" : onError ? "var(--tr-bad)" : "var(--tr-p)";
  const shown = phase !== "idle" && !backing;
  const topTrail =
    phase === "run" || phase === "ok" ? px - x.start : onError ? x.stages[stage] - x.start : 0;

  const node = (i: number) => {
    if (backing) return i === stage ? "spent" : undefined;
    if (phase === "idle") return undefined;
    if (phase === "ok") return "done";
    if (i < stage) return "pass";
    if (i === stage) return phase === "run" ? "active" : "fail";
    return undefined;
  };

  return (
    <div className="tracks rounded-2xl border bg-fd-card shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)]">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-7">
        <span className="font-mono font-semibold text-sm">
          ProductsApi.list
          <span className="hidden font-normal text-fd-muted-foreground md:inline">
            {" "}
            : Effect&lt;ReadonlyArray&lt;Product&gt;, ProductsError&gt;
          </span>
        </span>
        <Pill view={view} />
      </div>

      <div className="overflow-x-auto px-5 pt-3 pb-4 sm:px-7">
        <div className="relative h-[300px] min-w-[760px]">
          <span className="absolute top-[22px] left-0 font-mono text-[11px] text-demo-ok">success</span>
          <span className="absolute top-[150px] left-0 font-mono text-[11px] text-demo-error">failure</span>

          <div className="absolute top-[63px] h-0.5 bg-fd-border" style={{ left: `${x.start}%`, right: `${100 - x.end}%` }} />
          <div className="absolute top-[183px] h-0.5 bg-fd-border" style={{ left: `${x.stages[0]}%`, right: `${100 - x.end}%` }} />
          <div
            className="tracks-trail absolute top-[62px] h-1 rounded-full"
            style={{
              left: `${x.start}%`,
              width: `${topTrail}%`,
              background: onError ? "color-mix(in oklab, var(--tr-bad) 45%, transparent)" : tone,
            }}
          />
          <div
            className="tracks-trail absolute top-[182px] h-1 rounded-full bg-demo-error"
            style={{
              left: `${onError ? x.stages[stage] : x.stages[0]}%`,
              width: `${onError ? px - x.stages[stage] : 0}%`,
            }}
          />

          {/* The retry lane: down from the gate, back along the bottom, up to the start. */}
          <svg
            aria-hidden
            className="absolute inset-0 size-full overflow-visible"
            viewBox="0 0 100 300"
            preserveAspectRatio="none"
          >
            <path
              className="tracks-lane"
              data-live={backing || undefined}
              d={`M ${x.gate} 198 L ${x.gate} 262 L ${x.start} 262 L ${x.start} 78`}
            />
          </svg>
          <span
            className="tracks-lane-label absolute top-[251px] -translate-x-1/2 whitespace-nowrap rounded-md bg-fd-card px-2 py-1 font-mono text-[11px]"
            data-live={backing || undefined}
            style={{ left: `${(x.gate + x.start) / 2}%` }}
          >
            Effect.retry ·{" "}
            {backing && view.wait !== undefined
              ? `waited ${Math.round(view.wait)}ms`
              : "Schedule.exponential"}
          </span>

          <div
            className="absolute top-[58px] size-3 -translate-x-1/2 rounded-full bg-fd-muted-foreground/40"
            style={{ left: `${x.start}%` }}
          />

          {stages.map((s, i) => {
            const hot = onError && i === stage;
            return (
              <Fragment key={s.title}>
                <div
                  className="absolute top-0 flex w-[150px] -translate-x-1/2 flex-col items-center gap-0.5 text-center"
                  style={{ left: `${x.stages[i]}%` }}
                >
                  <span className="font-semibold text-sm">{s.title}</span>
                  <span className="font-mono text-[11px] text-fd-muted-foreground">{s.code}</span>
                </div>
                <div
                  className="tracks-drop absolute top-20 h-[103px]"
                  data-hot={hot || undefined}
                  style={{ left: `${x.stages[i]}%` }}
                />
                <span
                  className="tracks-chip absolute top-[98px] -translate-x-1/2 whitespace-nowrap rounded-md border px-2.5 py-1 font-mono text-xs"
                  data-hot={hot || undefined}
                  style={{ left: `${x.stages[i]}%` }}
                >
                  {hot && tag !== "" ? tag : s.error}
                </span>
                <div
                  className="tracks-node absolute top-[50px] size-7 -translate-x-1/2 rounded-full"
                  data-state={node(i)}
                  style={{ left: `${x.stages[i]}%` }}
                />
                {i === 0 && waiting ? (
                  // The deadline, drawn. A call that closes the ring times out.
                  <svg
                    key={attempt}
                    aria-hidden
                    width="44"
                    height="44"
                    className="tracks-timer absolute top-[42px] -translate-x-1/2 -rotate-90 overflow-visible"
                    style={{ left: `${x.stages[0]}%`, animationDuration: `${timeoutMs}ms` }}
                  >
                    <circle cx="22" cy="22" r="21" />
                  </svg>
                ) : null}
              </Fragment>
            );
          })}

          <div
            className="tracks-gate absolute top-[172px] size-6 -translate-x-1/2 rotate-45"
            data-verdict={judged ? (view.verdict === "retry" ? "yes" : "no") : undefined}
            style={{ left: `${x.gate}%` }}
          />
          <span
            className="tracks-verdict absolute top-[134px] whitespace-nowrap rounded-full px-2.5 py-1 font-mono font-semibold text-[11px]"
            data-verdict={judged || backing ? (view.verdict === "retry" ? "yes" : "no") : undefined}
            style={{ left: `${x.gate}%` }}
          >
            {view.verdict === "retry"
              ? "retryable: go again"
              : view.verdict === "spent"
                ? "out of retries"
                : "not retryable"}
          </span>
          <span
            className="absolute top-[208px] -translate-x-1/2 whitespace-nowrap bg-fd-card px-1 font-mono text-[11px] text-fd-muted-foreground"
            style={{ left: `${x.gate}%` }}
          >
            while: isRetryable
          </span>

          <div
            className="tracks-catch absolute top-[168px] size-8 -translate-x-1/2 rounded-[9px]"
            data-hot={phase === "caught" || phase === "failed" || undefined}
            style={{ left: `${x.end}%` }}
          />
          <span
            className="absolute top-[208px] -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-fd-muted-foreground"
            style={{ left: `${x.end}%` }}
          >
            Effect.catch
          </span>

          <div className="absolute top-0 right-0 flex flex-col items-end gap-0.5 text-right">
            <span className="font-mono font-semibold text-[13px]">ReadonlyArray&lt;Product&gt;</span>
            <span className="font-mono text-[11px] text-fd-muted-foreground">
              {phase === "ok" ? "decoded" : "the success value"}
            </span>
          </div>
          <div
            className="tracks-goal absolute top-12 flex size-8 -translate-x-1/2 items-center justify-center rounded-full"
            data-ok={phase === "ok" || undefined}
            style={{ left: `${x.end}%` }}
          >
            <svg
              aria-hidden
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>

          <div
            aria-hidden
            className="tracks-packet absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${px}%`,
              top: py,
              opacity: shown ? 1 : 0,
              background: tone,
              boxShadow: `0 0 0 4px var(--tr-card), 0 0 16px 3px color-mix(in oklab, ${tone} 60%, transparent)`,
              // Hidden while it rides the retry lane, so it jumps home unseen.
              transition: shown
                ? "left .5s cubic-bezier(.65,0,.35,1), top .45s cubic-bezier(.65,0,.35,1), background-color .2s, opacity .2s"
                : "opacity .12s",
            }}
          />
          {backing ? (
            <div
              key={attempt}
              aria-hidden
              className="tracks-return absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            />
          ) : null}
        </div>
      </div>

      <Log view={view} trace={trace} count={count} />
    </div>
  );
}

function Pill({ view }: { readonly view: View }) {
  const { phase, attempt } = view;
  let tone = "";
  let text = "ready";

  if (phase === "run") [tone, text] = ["p", `attempt ${attempt} of ${maxAttempts}`];
  if (phase === "fail" || phase === "judge") [tone, text] = ["bad", `attempt ${attempt} failed`];
  if (phase === "back" || phase === "climb") [tone, text] = ["wait", "backing off"];
  if (phase === "ok") {
    [tone, text] = ["ok", attempt === 1 ? "ok on the first try" : `ok after ${attempt} attempts`];
  }
  if (phase === "caught" || phase === "failed") {
    [tone, text] = ["bad", attempt === 1 ? "failed, not retried" : `gave up after ${attempt} attempts`];
  }

  return (
    <span
      className="tracks-pill shrink-0 rounded-full px-2.5 py-1 font-medium font-mono text-[11px]"
      data-tone={tone || undefined}
    >
      {text}
    </span>
  );
}

/**
 * The attempts as a terminal would print them. A line only appears once the
 * drawing has reached it, so the log never gives away the ending.
 */
function Log({
  view,
  trace,
  count,
}: {
  readonly view: View;
  readonly trace: Trace;
  readonly count?: number;
}) {
  const seen = trace.filter(
    (step) =>
      step.outcome !== undefined &&
      (step.n < view.attempt || (step.n === view.attempt && view.phase !== "run")),
  );
  const origin = trace[0]?.startedAt ?? 0;

  return (
    <div
      aria-live="polite"
      className="tracks-term flex min-h-32 flex-col gap-1 overflow-x-auto rounded-b-2xl px-5 py-3.5 font-mono text-xs leading-5 sm:px-7"
    >
      {view.phase === "idle" ? (
        <span className="tracks-dim">Pick a way for it to fail, then run the call.</span>
      ) : null}
      {seen.map((step) => {
        const next = trace[step.n];
        const ok = step.outcome === "ok";
        return (
          <div key={step.n} className="tracks-line whitespace-pre">
            <span className="tracks-dim">
              #{step.n} +{Math.round((step.endedAt ?? origin) - origin)}ms
            </span>
            {"  "}
            <span className={ok ? "tracks-ok" : "tracks-bad"}>{step.outcome}</span>
            {next !== undefined && step.endedAt !== undefined ? (
              <span className="tracks-dim">{`  retry after ${next.startedAt - step.endedAt}ms`}</span>
            ) : null}
          </div>
        );
      })}
      {view.phase === "failed" ? (
        <div className="tracks-line whitespace-pre">
          <span className="tracks-wait">{"->"} Effect.catch</span>
          <span className="tracks-dim">{"  turns the error into a value the page can render"}</span>
        </div>
      ) : null}
      {view.phase === "ok" ? (
        <div className="tracks-line whitespace-pre">
          <span className="tracks-ok">{"->"} decoded</span>
          <span className="tracks-dim">
            {count === undefined
              ? ""
              : `  fetched ${count} products, every one matched the Product schema`}
          </span>
        </div>
      ) : null}
      {view.phase !== "idle" && view.phase !== "ok" && view.phase !== "failed" ? (
        <span aria-hidden className="tracks-caret h-3.5 w-[7px]" />
      ) : null}
    </div>
  );
}
