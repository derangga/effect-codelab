import { cn } from "@/lib/cn";

/**
 * The home page hero's diagram: one call to `ProductsApi.list` from the Basic
 * Effect track, drawn as a line of stations. Attempt one gets a 500, the retry
 * policy waits 200 ms and goes again, attempt two decodes 20 products.
 *
 * Nothing here runs Effect. It is a 10 second CSS loop (the `hero-*` keyframes
 * in app.css), and every element's keyframes are cut from that one timeline, so
 * the percentages there are the script. The stage names and error tags are the
 * real ones from src/effect-demo/products.ts, which is why a reader meets them
 * again in chapter one.
 */
const stages = [
  { title: "Send the request", code: "fetcher.request(url)", error: "NetworkError" },
  { title: "Check the status", code: "response.ok", error: "ResponseError 500" },
  { title: "Parse the body", code: "response.json()", error: "MalformedJson" },
  { title: "Decode the shape", code: "decodeProducts(body)", error: "SchemaMismatch" },
];

// One tile per decoded product. fakestoreapi's /products answers with 20.
const tiles = Array.from({ length: 20 }, (_, i) => i);

const chip =
  "shrink-0 self-start rounded-md border bg-fd-card px-2.5 py-1 font-mono text-fd-muted-foreground text-xs";

export function RetryPipeline() {
  return (
    <figure className="hero-pipeline m-0 flex flex-col gap-3">
      <div className="rounded-2xl border bg-fd-card px-5 pt-5 pb-4 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)] sm:px-7">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono font-semibold text-sm">ProductsApi.list</span>
          {/* Four labels stacked in one cell, each shown for its slice of the loop. */}
          <div aria-hidden className="grid font-medium font-mono text-[11px]">
            <span className="hero-p1 col-start-1 row-start-1 justify-self-end rounded-full bg-fd-primary/10 px-2.5 py-1 text-fd-primary opacity-0">
              attempt 1 of 4
            </span>
            <span className="hero-pf col-start-1 row-start-1 justify-self-end rounded-full bg-demo-error/10 px-2.5 py-1 text-demo-error opacity-0">
              attempt 1 failed
            </span>
            <span className="hero-p2 col-start-1 row-start-1 justify-self-end rounded-full bg-fd-primary/10 px-2.5 py-1 text-fd-primary opacity-0">
              attempt 2 of 4
            </span>
            <span className="hero-pok col-start-1 row-start-1 justify-self-end rounded-full bg-demo-ok/15 px-2.5 py-1 text-demo-ok">
              ok after 2 attempts
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-3.5 pb-5 font-mono text-[11px] text-fd-muted-foreground">
          <span>timeout 2s</span>
          <div className="h-1 grow overflow-hidden rounded-full bg-fd-muted">
            <div className="hero-tbar h-full w-[36%] origin-left rounded-full bg-demo-ok" />
          </div>
        </div>

        <div className="relative h-[440px]">
          <div className="absolute top-3.5 left-[69px] h-[400px] w-0.5 bg-fd-border" />
          <div className="hero-trail absolute top-3.5 left-[69px] h-[400px] w-0.5 origin-top rounded-full bg-demo-ok" />

          <svg
            aria-hidden
            width="60"
            height="130"
            viewBox="0 0 60 130"
            className="absolute top-0 left-0 overflow-visible"
          >
            <path
              className="hero-loop"
              d="M56 114 C 16 114, 16 14, 56 14"
              fill="none"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
            <path
              className="hero-loop"
              d="M50 9 L56 14 L50 19"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="-16" y="60" className="fill-fd-muted-foreground font-mono text-[10px]">
              retry
            </text>
          </svg>
          <span
            aria-hidden
            className="hero-bo absolute top-[68px] -left-5 rounded bg-fd-primary/10 px-1 py-0.5 font-mono text-[10px] text-fd-primary opacity-0"
          >
            200ms
          </span>

          <div
            aria-hidden
            className="hero-rip hero-rip2 absolute top-[100px] left-14 size-7 rounded-full border-2 border-demo-error opacity-0"
          />

          {stages.map((stage, i) => (
            <div
              key={stage.title}
              className={cn(
                "absolute right-0 left-0 flex items-start gap-4 pl-14",
                i === 1 && "hero-shake",
              )}
              style={{ top: i * 100 }}
            >
              <div
                className={cn(
                  `hero-n${i + 1}`,
                  "size-7 shrink-0 rounded-full border-2 bg-fd-card",
                )}
              />
              <div className="flex min-w-0 grow flex-col gap-2 sm:flex-row sm:gap-4">
                <div className="flex flex-col gap-0.5 pt-0.5 sm:w-52 sm:shrink-0">
                  <span className="font-semibold text-[15px]">{stage.title}</span>
                  <span className="font-mono text-fd-muted-foreground text-xs">{stage.code}</span>
                </div>
                <div
                  className={cn(
                    "mt-3.5 hidden grow border-t border-dashed sm:block",
                    i === 1 && "hero-c2",
                  )}
                />
                <span className={cn(chip, i === 1 && "hero-e2")}>{stage.error}</span>
              </div>
            </div>
          ))}

          <div
            aria-hidden
            className="hero-rip hero-rip5 absolute top-[400px] left-14 size-7 rounded-full border-2 border-demo-ok opacity-0"
          />
          <div className="absolute top-[400px] right-0 left-0 flex items-start gap-4 pl-14">
            <div className="hero-n5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-demo-ok bg-demo-ok text-fd-card">
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
            <div className="flex min-w-0 flex-col gap-2 pt-0.5">
              <span className="font-semibold text-[15px]">ReadonlyArray&lt;Product&gt;</span>
              <div aria-hidden className="flex flex-wrap gap-[3px]">
                {tiles.map((i) => (
                  <span
                    key={i}
                    className="hero-tile size-[9px] rounded-[2px] bg-demo-ok"
                    style={{ animationDelay: `${i * 35}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div
            aria-hidden
            className="hero-pkt absolute top-2 left-16 size-3 rounded-full bg-demo-ok"
          />
          <div
            aria-hidden
            className="hero-arcpkt absolute top-0 left-0 size-3 rounded-full bg-fd-primary opacity-0"
          />
        </div>

        <div className="mt-3.5 flex flex-col gap-1.5 border-t pt-3.5 font-mono text-fd-muted-foreground text-xs">
          <div className="flex">
            <span className="hero-type1 block w-[40ch] overflow-hidden whitespace-pre">
              <span className="opacity-60">#1</span>
              {"  "}
              <span className="text-demo-error">ResponseError</span>
              {"  500, retry in ~200 ms"}
            </span>
          </div>
          <div className="flex items-center">
            <span className="hero-type2 block w-[28ch] overflow-hidden whitespace-pre">
              <span className="opacity-60">#2</span>
              {"  "}
              <span className="text-demo-ok">ok</span>
              {"  20 products decoded"}
            </span>
            <span aria-hidden className="hero-caret h-3.5 w-[7px] bg-fd-foreground" />
          </div>
        </div>
      </div>

      <figcaption className="px-1 font-mono text-fd-muted-foreground text-xs leading-relaxed">
        Effect&lt;
        <span className="hero-ua rounded px-1 text-fd-primary">ReadonlyArray&lt;Product&gt;</span>, NetworkError |{" "}
        <span className="hero-u2 rounded px-1">ResponseError</span> | MalformedJson | SchemaMismatch |
        RequestTimeout&gt;
      </figcaption>
    </figure>
  );
}
