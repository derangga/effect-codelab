import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { docs, source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { baseOptions } from "@/lib/layout.shared";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense, use } from "react";
import { Clock } from "lucide-react";
import { useMDXComponents } from "@/components/mdx";
import { redirectBasicEffectPath } from "@/lib/basic-effect-redirects";
import { siteDescription } from "@/lib/shared";
import { chapterJsonLd, jsonLdScript, pageHead } from "@/lib/seo";

export const Route = createFileRoute("/learn/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const redirectTo = redirectBasicEffectPath(slugs);
    if (redirectTo !== undefined) {
      throw redirect({ href: redirectTo, statusCode: 301 });
    }

    const data = await serverLoader({ data: slugs });
    await docs.getPage(data.path)?.preload();
    return data;
  },
  // head() runs after the loader on both prerender and client navigation.
  // The slugs come from params rather than loaderData.path, because source
  // pages carry the url, title and description the meta tags need and the
  // docs collection entries do not.
  head: ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const page = source.getPage(slugs);
    if (!page) return {};

    // A chapter is one slug deep under its track; track index pages are the
    // depth-one pages themselves.
    const track = slugs.length > 1 ? source.getPage([slugs[0]]) : undefined;
    const description = page.data.description ?? siteDescription;
    const ld = chapterJsonLd({
      title: page.data.title,
      description,
      url: page.url,
      trackTitle: track?.data.title,
      trackUrl: track?.url,
    });

    return {
      ...pageHead({
        title: page.data.title,
        description,
        path: page.url,
        ogType: "article",
      }),
      scripts: [jsonLdScript(ld[0]), jsonLdScript(ld[1])],
    };
  },
});

// The site is static, so there is no server left to answer this on a client
// side navigation. The middleware runs it during prerender instead and writes
// the result next to the html, keyed by the slugs, which is why every chapter
// gets its own cache file rather than one shared page tree.
const serverLoader = createServerFn({
  method: "GET",
})
  .middleware([staticFunctionMiddleware])
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

function Content({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);

  const { toc } = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      {!path.endsWith("index.md") ? (
        <div className="mt-3 flex items-center gap-1.5 text-fd-muted-foreground text-sm">
          <Clock className="size-3.5" aria-hidden="true" />
          <span>{`${page.minutes} min read`}</span>
        </div>
      ) : null}
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const { path, pageTree } = useFumadocsLoader(Route.useLoaderData());

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      <Suspense>
        <Content path={path} />
      </Suspense>
    </DocsLayout>
  );
}
