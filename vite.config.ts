import { readdirSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { oldBasicEffectPaths } from "./src/lib/basic-effect-redirects.ts";

const contentDir = join(import.meta.dirname, "content");

/**
 * Every page the build must emit, globbed rather than listed, so adding a
 * chapter does not mean remembering to add it here too.
 *
 * crawlLinks would find most of these from the sidebar, but the three data
 * routes are not linked from any page, and a list that is partly crawled and
 * partly declared is a list nobody can check. This one is the whole set.
 */
function prerenderPages() {
  const paths = ["/", "/demo", "/404"];

  for (const track of readdirSync(contentDir, { withFileTypes: true })) {
    if (!track.isDirectory()) continue;
    for (const file of readdirSync(join(contentDir, track.name))) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      paths.push(
        slug === "index"
          ? `/learn/${track.name}`
          : `/learn/${track.name}/${slug}`,
      );
    }
  }

  paths.push(
    ...oldBasicEffectPaths,
    "/api/search.json",
    "/llms.txt",
    "/llms-full.txt",
    "/sitemap.xml",
    "/robots.txt",
  );

  return paths.map((path) => ({ path, prerender: { enabled: true } }));
}

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        failOnError: true,
        // Off, so `pages` below is the whole set rather than a starting point
        // that is partly crawled and partly declared.
        crawlLinks: false,
      },
      pages: prerenderPages(),
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.js",
    },
  },
});
