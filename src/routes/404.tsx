import { createFileRoute } from "@tanstack/react-router";
import { NotFound } from "@/components/not-found";
import { pageHead } from "@/lib/seo";

/**
 * The page Cloudflare serves for a path that was never prerendered, wired up
 * by `not_found_handling` in wrangler.jsonc.
 *
 * A miss during client-side navigation already renders `NotFound` through the
 * router's `defaultNotFoundComponent`. This route is the same component for a
 * cold load, so both paths look the same. It is noindex because a 404 that
 * gets indexed is a 404 someone finds in search results.
 */
const head = pageHead({ title: "Page not found", path: "/404" });

export const Route = createFileRoute("/404")({
  head: () => ({
    ...head,
    meta: [...head.meta, { name: "robots", content: "noindex" }],
  }),
  component: NotFound,
});
