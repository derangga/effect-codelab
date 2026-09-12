import { createFileRoute, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Clock } from 'lucide-react';
import { TrackIcon } from '@/components/track-icon';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import themes from '../../../../content/themes.json';

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
        summary: page.data.summary ?? '',
        prereq: page.data.prereq ?? '',
        level: page.data.level ?? '',
        icon: page.data.icon ?? '',
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

const loadCatalog = createServerFn({ method: 'GET' }).handler(() => catalog());

export const Route = createFileRoute('/')({
  component: Home,
  loader: () => loadCatalog(),
});

function Home() {
  const themed = Route.useLoaderData();
  const first = themed[0]?.tracks[0];

  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <header className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight">Learning Effect</h1>
          <p className="mt-3 text-lg text-fd-muted-foreground">
            Short tracks on the Effect library for TypeScript. Every snippet on
            this site is compiled by the build, so the code you read is code
            that runs.
          </p>
          <p className="mt-3 text-fd-muted-foreground">
            If you are new here, read Mental Model first, then Basic Effect
            front to back. Anti-patterns is worth a pass once the basics stick,
            and Fullstack Monorepo is where it all gets wired into an app.
          </p>
          {first ? (
            <Link
              to={first.url}
              className="mt-6 inline-flex rounded-lg bg-fd-primary px-3 py-2 font-medium text-fd-primary-foreground text-sm"
            >
              Start with {first.title}
            </Link>
          ) : null}
        </header>

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
