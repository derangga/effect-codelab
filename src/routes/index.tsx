import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight, Clock } from "lucide-react";
import { RetryPipeline } from "@/components/retry-pipeline";
import { TrackIcon } from "@/components/track-icon";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { homeJsonLd, jsonLdScript, pageHead } from "@/lib/seo";
import themes from "../../content/themes.json";

/**
 * The catalog: themes in themes.json order, tracks ordered within their theme.
 *
 * A track's total counts its own index.md alongside its chapters, which is
 * what the old home page showed. Every page carries `minutes` on its data
 * eagerly, so nothing here compiles a chapter to add up a card.
 */
function catalog() {
  const pages = source.getPages();

  return themes.flatMap((theme) => {
    const tracks = pages
      // a track page is the index.md of a track folder, one slug deep
      .filter((page) => page.slugs.length === 1)
      .filter((page) => page.data.theme === theme.slug)
      .map((page) => ({
        url: page.url,
        title: page.data.title,
        summary: page.data.summary ?? "",
        prereq: page.data.prereq ?? "",
        level: page.data.level ?? "",
        icon: page.data.icon ?? "",
        order: page.data.order ?? 999,
        minutes: pages
          .filter((each) => each.slugs[0] === page.slugs[0])
          .reduce((total, each) => total + each.data.minutes, 0),
      }))
      .sort((a, b) => a.order - b.order);

    // A theme with no tracks yet is left out rather than rendered as an empty
    // heading, so themes.json can name one before it has content.
    return tracks.length > 0 ? [{ ...theme, tracks }] : [];
  });
}

const loadCatalog = createServerFn({ method: "GET" })
  .middleware([staticFunctionMiddleware])
  .handler(() => catalog());

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => loadCatalog(),
  head: () => ({
    ...pageHead(),
    scripts: [jsonLdScript(homeJsonLd[0]), jsonLdScript(homeJsonLd[1])],
  }),
});

function Home() {
  const themed = Route.useLoaderData();
  const tracks = themed.flatMap((theme) => theme.tracks);
  const first = tracks[0];
  const hours = (tracks.reduce((total, t) => total + t.minutes, 0) / 60).toFixed(1);

  return (
    <HomeLayout {...baseOptions()}>
      <div className="relative">
        <div aria-hidden className="hero-dots pointer-events-none absolute inset-0" />
        <header className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-12 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:gap-16 lg:pt-16">
          <div className="flex flex-col gap-7">
            <div className="hero-rise inline-flex items-center gap-2.5 self-start rounded-full border bg-fd-card py-1.5 pr-3.5 pl-3 font-mono text-fd-muted-foreground text-xs">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-demo-ok opacity-60" />
                <span className="relative size-2 rounded-full bg-demo-ok" />
              </span>
              Every snippet compiled by the build
            </div>
            <h1
              className="hero-rise font-bold text-5xl leading-[1.04] tracking-tight sm:text-6xl"
              style={{ animationDelay: "90ms" }}
            >
              Learn Effect by reading code that{" "}
              <span className="relative inline-block text-fd-primary">
                runs.
                <svg
                  aria-hidden
                  viewBox="0 0 160 18"
                  preserveAspectRatio="none"
                  className="absolute -bottom-2.5 left-0 h-[18px] w-full overflow-visible"
                >
                  <path
                    className="hero-ul"
                    d="M3 11 C 30 4, 52 15, 80 9 S 130 4, 157 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray="230"
                  />
                </svg>
              </span>
            </h1>
            <p
              className="hero-rise max-w-lg text-fd-muted-foreground text-lg leading-relaxed"
              style={{ animationDelay: "180ms" }}
            >
              Short tracks on the Effect library for TypeScript. New here? Read
              Mental Model first, then Basic Effect front to back.
            </p>
            <div
              className="hero-rise flex flex-wrap items-center gap-3"
              style={{ animationDelay: "270ms" }}
            >
              {first ? (
                <Link
                  to={first.url}
                  className="inline-flex h-12 items-center gap-2 rounded-lg bg-fd-primary px-5 font-semibold text-fd-primary-foreground text-sm shadow-fd-primary/40 shadow-lg transition-transform active:scale-95"
                >
                  Start with {first.title}
                  <ArrowRight className="size-4" />
                </Link>
              ) : null}
              <Link
                to="/demo"
                className="inline-flex h-12 items-center rounded-lg border bg-fd-card px-5 font-semibold text-sm transition-colors hover:bg-fd-accent"
              >
                See it running
              </Link>
            </div>
            <div
              className="hero-rise flex flex-wrap gap-x-7 gap-y-2 font-mono text-fd-muted-foreground text-sm"
              style={{ animationDelay: "360ms" }}
            >
              <span>
                <b className="font-semibold text-fd-foreground">{tracks.length}</b> tracks
              </span>
              <span>
                <b className="font-semibold text-fd-foreground">{hours} h</b> of reading
              </span>
              <span>beginner → intermediate</span>
            </div>
          </div>
          <div className="hero-rise" style={{ animationDelay: "200ms" }}>
            <RetryPipeline />
          </div>
        </header>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6">
        {themed.map((theme) => (
          <section key={theme.slug} className="mt-12">
            <h2 className="font-medium text-sm uppercase tracking-wide">
              {theme.title}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {theme.tracks.map((track) => (
                <li key={track.url}>
                  <Link
                    to={track.url}
                    className="flex h-full flex-col rounded-lg border p-5 transition-colors hover:bg-fd-accent"
                  >
                    <div className="flex items-center gap-2.5">
                      <TrackIcon
                        name={track.icon}
                        className="size-4 shrink-0 text-fd-muted-foreground"
                      />
                      <span className="font-medium">{track.title}</span>
                    </div>
                    <p className="mt-2 grow text-fd-muted-foreground text-sm">
                      {track.summary}
                    </p>
                    <p className="mt-2 text-fd-muted-foreground text-xs">
                      {track.prereq}
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <span className="rounded-md bg-fd-secondary px-2 py-0.5 font-medium text-fd-secondary-foreground text-xs">
                        {track.level}
                      </span>
                      <span className="flex items-center gap-1 text-fd-muted-foreground text-xs">
                        <Clock className="size-3" />
                        {`${track.minutes} min`}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </HomeLayout>
  );
}
