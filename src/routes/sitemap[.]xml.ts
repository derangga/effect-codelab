import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

/**
 * One entry per prerendered page: home, the demo playground and every doc
 * page the source loader knows. The old basic-effect redirect targets are
 * left out; they 301 to real pages and search engines should not index them.
 */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = [
          "/",
          "/demo",
          ...source.getPages().map((page) => page.url),
        ];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${siteUrl}${url}</loc></url>`).join("\n")}
</urlset>`;

        return new Response(body, {
          headers: { "content-type": "application/xml" },
        });
      },
    },
  },
});
